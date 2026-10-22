/**
 * 上传队列测试（Wave1-A5；Lane G1 扩展：暂停/恢复/重试 + 冲突探测确认）。
 * rejected 分类/直传 put/multipart（分片数、etag 顺序、进度累计）/文件级与分片级并发上限/
 * 失败清理/abort（排队中+分片中）/前缀拼接 + pause/resume（排队中/multipart 在途）/retry
 * （multipart 复用 uploadId 续传、直传整重传）/pauseAll/resumeAll/onConflict 探测裁决。
 * FakeS3Client：内存 Map 存对象 + 调用序列 + 在途并发峰值观测。
 */
import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import type { S3Client, S3ListResult } from '@/sdk/types'
import { UPLOAD_ABORTED_CODE, UPLOAD_CONFLICT_CODE, UploadQueue } from '@/files/upload-queue'
import type { UploadParams } from '@/files/upload-queue'

const tick = () => new Promise<void>(r => setTimeout(r, 0))
const file = (name: string, size: number, type?: string) =>
  type === undefined
    ? new File([new Uint8Array(size)], name)
    : new File([new Uint8Array(size)], name, { type })

/** 内存 S3：记录调用序列与在途峰值；putPeak/partPeak/headPeak 断言并发上限 */
class FakeUploadClient implements S3Client {
  bodies = new Map<string, number>()
  types = new Map<string, string>()
  parts = new Map<string, Map<number, number>>()
  completed: { key: string; uploadId: string; parts: { partNumber: number; etag: string }[] }[] = []
  calls: string[] = []
  putInflight = 0; putPeak = 0
  partInflight = 0; partPeak = 0
  failParts = new Set<string>()
  failPuts = new Set<string>()
  /** 已 abort 的 key（模拟 S3 NoSuchUpload：再传分片报错） */
  abortedKeys = new Set<string>()
  /** 非空时 uploadPart 挂起直到放行（测 abort/pause 竞态） */
  partGate: Promise<void> | null = null
  /** Lane G1：head 探测观测（冲突探测并发峰值用） */
  heads: string[] = []
  headInflight = 0; headPeak = 0
  headFailKeys = new Set<string>()
  async put(key: string, body: Blob | ArrayBuffer, contentType?: string): Promise<{ etag: string }> {
    this.calls.push(`put:${key}`)
    this.putInflight++
    this.putPeak = Math.max(this.putPeak, this.putInflight)
    try {
      await tick()
      if (this.failPuts.has(key)) throw new SdkError(ERROR_CODES.S3_ERROR, 'put boom', key)
      this.bodies.set(key, body instanceof Blob ? body.size : body.byteLength)
      this.types.set(key, contentType ?? '')
      return { etag: `etag-${key}` }
    } finally {
      this.putInflight--
    }
  }
  async uploadPart(key: string, _uploadId: string, partNumber: number, body: Blob): Promise<{ etag: string }> {
    this.calls.push(`part:${key}#${partNumber}`)
    this.partInflight++
    this.partPeak = Math.max(this.partPeak, this.partInflight)
    try {
      if (this.partGate) await this.partGate
      await tick()
      if (this.abortedKeys.has(key)) throw new SdkError(ERROR_CODES.S3_ERROR, 'NoSuchUpload', key)
      if (this.failParts.has(`${key}#${partNumber}`)) {
        throw new SdkError(ERROR_CODES.S3_ERROR, `part boom #${partNumber}`, partNumber)
      }
      let m = this.parts.get(key)
      if (!m) { m = new Map(); this.parts.set(key, m) }
      m.set(partNumber, body.size)
      return { etag: `etag-${partNumber}` }
    } finally {
      this.partInflight--
    }
  }
  async createMultipart(key: string): Promise<{ uploadId: string }> {
    this.calls.push(`create:${key}`)
    return { uploadId: `up-${key}` }
  }
  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    this.calls.push(`complete:${key}`)
    const m = this.parts.get(key)
    this.bodies.set(key, parts.reduce((sum, p) => sum + (m?.get(p.partNumber) ?? 0), 0))
    this.parts.delete(key)
    this.completed.push({ key, uploadId, parts })
  }
  async abortMultipart(key: string, _uploadId: string): Promise<void> {
    this.calls.push(`abort:${key}`)
    this.abortedKeys.add(key)
    this.parts.delete(key)
  }
  async list(prefix: string): Promise<S3ListResult> { return { prefix, dirs: [], files: [] } }
  async get(): Promise<Response> { throw new Error('未实现') }
  async head(key: string): Promise<{ exists: boolean }> {
    this.heads.push(key)
    this.headInflight++
    this.headPeak = Math.max(this.headPeak, this.headInflight)
    try {
      await tick()
      if (this.headFailKeys.has(key)) throw new SdkError(ERROR_CODES.S3_ERROR, 'head boom', key)
      return { exists: this.bodies.has(key) }
    } finally {
      this.headInflight--
    }
  }
  async copy(): Promise<void> { throw new Error('未实现') }
  async remove(): Promise<void> { throw new Error('未实现') }
}

/** 组装队列 + 回调记录 */
function makeQueue(client: FakeUploadClient, params: UploadParams = {}) {
  const done: { id: string; key: string }[] = []
  const failed: { id: string; err: unknown }[] = []
  const progress: { id: string; loaded: number; total: number }[] = []
  const q = new UploadQueue({
    client,
    params,
    hooks: {
      onProgress: (id, loaded, total) => progress.push({ id, loaded, total }),
      onDone: (id, key) => done.push({ id, key }),
      onFailed: (id, err) => failed.push({ id, err }),
    },
  })
  return { q, done, failed, progress }
}

describe('上传队列', () => {
  it('enqueue 拒绝分类（ext/size）：denyExts 忽略大小写与前导点，不抛整批错误', async () => {
    const client = new FakeUploadClient()
    const { q, done } = makeQueue(client, { denyExts: ['.EXE', 'zip'], uploadMaxBytes: 100 })
    const res = q.enqueue([
      file('a.exe', 1), file('b.ExE', 1), file('c.ZIP', 1), file('big.bin', 101),
      file('ok.txt', 10), file('noext', 5), file('eq.bin', 100), // 边界：等于上限不拒
    ])
    expect(res.rejected).toEqual([
      { name: 'a.exe', reason: 'ext' },
      { name: 'b.ExE', reason: 'ext' },
      { name: 'c.ZIP', reason: 'ext' },
      { name: 'big.bin', reason: 'size' },
    ])
    const ids = res.accepted.map(a => a.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3) // id 唯一
    await vi.waitFor(() => expect(done).toHaveLength(3))
  })

  it('小文件（≤multipartThreshold）直传 put：onDone/onProgress/类型兜底/前缀拼接', async () => {
    const client = new FakeUploadClient()
    const { q, done, progress } = makeQueue(client, { multipartThreshold: 5 })
    const res = q.enqueue([file('a.txt', 4, 'text/plain'), file('raw.bin', 5)], 'docs/') // 5=阈值边界仍走 put
    await vi.waitFor(() => expect(done).toHaveLength(2))
    expect(done.map(d => d.key).sort()).toEqual(['docs/a.txt', 'docs/raw.bin']) // 前缀自动补尾斜杠
    expect(client.calls.some(c => c.startsWith('create:'))).toBe(false)
    expect(client.bodies.get('docs/a.txt')).toBe(4)
    expect(client.types.get('docs/a.txt')).toBe('text/plain')
    expect(client.types.get('docs/raw.bin')).toBe('application/octet-stream') // 无 type 兜底
    expect(progress.filter(p => p.id === res.accepted[0]!.id).map(p => [p.loaded, p.total]))
      .toEqual([[0, 4], [4, 4]])
    expect(q.status(res.accepted[0]!.id)).toBe('done')
    expect(q.status('unknown')).toBeUndefined()
  })

  it('大文件 multipart：分片数、etag 按 partNumber 升序、onProgress 分片累计、分片并发≤2', async () => {
    const client = new FakeUploadClient()
    const { q, done, progress } = makeQueue(client, { partSize: 10, multipartThreshold: 5 })
    const res = q.enqueue([file('big.bin', 25, 'application/octet-stream')]) // 10+10+5 → 3 片
    await vi.waitFor(() => expect(done).toHaveLength(1))
    expect(client.calls.filter(c => c.startsWith('part:')).length).toBe(3)
    expect(client.completed[0]?.parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ])
    expect(client.bodies.get('big.bin')).toBe(25) // 分片按序拼回，总长不丢
    const p = progress.filter(x => x.id === res.accepted[0]!.id)
    expect(p.map(x => x.loaded)).toEqual([10, 20, 25]) // 每片必调、累计
    expect(p.every(x => x.total === 25)).toBe(true)
    expect(client.partPeak).toBe(2)
  })

  it('文件级并发上限 uploadConcurrency', async () => {
    const client = new FakeUploadClient()
    const { q, done } = makeQueue(client, { uploadConcurrency: 2, multipartThreshold: 1024 })
    const res = q.enqueue([1, 2, 3, 4, 5].map(n => file(`f${n}.txt`, 1)))
    expect(res.accepted).toHaveLength(5)
    await vi.waitFor(() => expect(done).toHaveLength(5))
    expect(client.putPeak).toBe(2) // 同时在途峰值恰为并发上限
  })

  // Lane G1 断言修订（原：expect(calls).toContain('abort:f.bin')）：业务失败不再 abortMultipart——
  // retry(id) 需复用 uploadId + 已落定分片续传，失败时保留服务端分片（abort 清理仅保留给用户取消）。
  it('失败路径：分片失败保留 uploadId/分片供 retry（不 abort 不 complete）；put 失败透传 SdkError', async () => {
    const client = new FakeUploadClient()
    const { q, done, failed } = makeQueue(client, { partSize: 10, multipartThreshold: 5 })
    client.failParts.add('f.bin#2')
    client.failPuts.add('x.txt')
    const res = q.enqueue([file('f.bin', 25), file('x.txt', 1)])
    await vi.waitFor(() => expect(failed).toHaveLength(2))
    expect(done).toHaveLength(0)
    expect(client.calls).not.toContain('abort:f.bin') // 语义修订：分片残留保留，retry 复用 uploadId 续传
    expect(client.calls).not.toContain('complete:f.bin')
    expect(client.bodies.has('f.bin')).toBe(false)
    expect(q.status(res.accepted[0]!.id)).toBe('failed')
    expect(q.status(res.accepted[1]!.id)).toBe('failed')
    for (const f of failed) {
      expect(f.err).toBeInstanceOf(SdkError)
      expect((f.err as SdkError).code).toBe(ERROR_CODES.S3_ERROR) // SdkError 原样透传
    }
    // 失败原因可查（errorOf → 面板失败行展示，不再只给「失败」两字）：格式 `(code) message`
    for (const r of res.accepted) {
      expect(q.errorOf(r.id)).toMatch(/^\(\d+\) .+/)
    }
  })

  it('abort：排队中任务直接取消（不发起任何请求）', async () => {
    const client = new FakeUploadClient()
    const { q, done, failed } = makeQueue(client, { uploadConcurrency: 1, multipartThreshold: 100 })
    const res = q.enqueue([file('1.txt', 1), file('2.txt', 1), file('3.txt', 1)])
    const id3 = res.accepted[2]!.id
    expect(q.abort(id3)).toBe(true)
    expect(q.abort(id3)).toBe(false) // 重复取消
    expect(q.abort('nope')).toBe(false) // 未知 id
    await vi.waitFor(() => expect(done).toHaveLength(2))
    expect(client.calls.some(c => c === 'put:3.txt')).toBe(false)
    expect(failed).toHaveLength(1)
    expect((failed[0]?.err as SdkError).code).toBe(UPLOAD_ABORTED_CODE)
    expect(q.status(id3)).toBe('aborted')
  })

  it('abort：分片上传中 → abortMultipart 清理 + 不 complete', async () => {
    const client = new FakeUploadClient()
    const { q, done, failed } = makeQueue(client, { partSize: 10, multipartThreshold: 5 })
    let release!: () => void
    client.partGate = new Promise<void>(r => { release = r })
    const res = q.enqueue([file('g.bin', 25)])
    await vi.waitFor(() =>
      expect(client.calls.filter(c => c.startsWith('part:g.bin#')).length).toBe(2),
    )
    const id = res.accepted[0]!.id
    expect(q.abort(id)).toBe(true)
    expect(client.calls).toContain('abort:g.bin') // 服务端分片残留被清理
    release()
    await vi.waitFor(() => expect(failed).toHaveLength(1))
    expect(done).toHaveLength(0)
    expect(client.calls).not.toContain('complete:g.bin')
    expect((failed[0]?.err as SdkError).code).toBe(UPLOAD_ABORTED_CODE) // 取消语义不被 NoSuchUpload 掩盖
    expect(q.status(id)).toBe('aborted')
    expect(client.bodies.has('g.bin')).toBe(false)
    expect(client.parts.has('g.bin')).toBe(false)
  })
})

// ───────── Lane G1：单文件暂停/恢复/重试 ─────────

describe('上传队列：pause/resume/retry（Lane G1）', () => {
  it('pause/resume：排队中项暂停（不发起请求）→ 恢复后上传；幂等与未知 id 返回 false', async () => {
    const client = new FakeUploadClient()
    const { q, done } = makeQueue(client, { uploadConcurrency: 1, multipartThreshold: 100 })
    const res = q.enqueue([file('1.txt', 1), file('2.txt', 1)])
    const id2 = res.accepted[1]!.id
    expect(q.pause(id2)).toBe(true)
    expect(q.pause(id2)).toBe(false) // 已暂停幂等
    expect(q.pause('nope')).toBe(false) // 未知 id
    expect(q.status(id2)).toBe('paused')
    await vi.waitFor(() => expect(done).toHaveLength(1)) // 1.txt 不受影响
    await tick()
    expect(client.calls.some(c => c === 'put:2.txt')).toBe(false) // 暂停中不发起
    expect(q.resume(id2)).toBe(true)
    expect(q.resume(id2)).toBe(false) // 已恢复幂等
    await vi.waitFor(() => expect(done).toHaveLength(2))
    expect(q.status(id2)).toBe('done')
  })

  it('pause/resume：multipart 在途分片落定后停止调度（保留 uploadId，不 complete 不 abort）→ resume 补传续走', async () => {
    const client = new FakeUploadClient()
    const { q, done, failed, progress } = makeQueue(client, { partSize: 10, multipartThreshold: 5 })
    let release!: () => void
    client.partGate = new Promise<void>(r => { release = r })
    const res = q.enqueue([file('p.bin', 25)])
    const id = res.accepted[0]!.id
    await vi.waitFor(() => expect(client.calls.filter(c => c.startsWith('part:p.bin#')).length).toBe(2))
    expect(q.pause(id)).toBe(true)
    release()
    await vi.waitFor(() => expect(q.status(id)).toBe('paused'))
    expect(done).toHaveLength(0)
    expect(failed).toHaveLength(0) // 暂停非失败：不触发 onFailed
    expect(client.calls).not.toContain('complete:p.bin')
    expect(client.calls).not.toContain('abort:p.bin') // uploadId 保留供续传
    expect(client.calls.filter(c => c === 'part:p.bin#3').length).toBe(0) // 后续分片不再调度
    expect(client.calls.filter(c => c.startsWith('create:p.bin')).length).toBe(1)

    client.partGate = null
    expect(q.resume(id)).toBe(true)
    await vi.waitFor(() => expect(done).toHaveLength(1))
    expect(client.calls.filter(c => c.startsWith('create:p.bin')).length).toBe(1) // 复用 uploadId，不二次 create
    expect(client.calls.filter(c => c === 'part:p.bin#1').length).toBe(1) // 已落定分片不重传
    expect(client.calls.filter(c => c === 'part:p.bin#3').length).toBe(1) // 只补缺失分片
    expect(client.completed[0]?.parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ])
    expect(client.bodies.get('p.bin')).toBe(25)
    expect(progress.filter(x => x.id === id).map(x => x.loaded)).toEqual([10, 20, 25]) // 断点续累计
  })

  it('pause：直传在途项不可中断（诚实口径）——put 落定即 done，resume 幂等 false', async () => {
    const client = new FakeUploadClient()
    const { q, done } = makeQueue(client, { multipartThreshold: 1024 })
    const res = q.enqueue([file('s.txt', 1)])
    const id = res.accepted[0]!.id
    expect(q.pause(id)).toBe(true) // 已在途：仅标记，无法中断
    await vi.waitFor(() => expect(done).toHaveLength(1))
    expect(q.status(id)).toBe('done') // 文件已在服务端，不谎报暂停
    expect(q.resume(id)).toBe(false)
  })

  it('retry：failed multipart 复用 uploadId 续传（不二次 create，已落定分片不重传）', async () => {
    const client = new FakeUploadClient()
    const { q, done, failed } = makeQueue(client, { partSize: 10, multipartThreshold: 5 })
    client.failParts.add('r.bin#2')
    const res = q.enqueue([file('r.bin', 25)])
    const id = res.accepted[0]!.id
    await vi.waitFor(() => expect(failed).toHaveLength(1))
    expect(client.calls).not.toContain('abort:r.bin') // 失败保留分片
    expect(client.calls.filter(c => c.startsWith('create:r.bin')).length).toBe(1)

    client.failParts.clear()
    expect(q.retry(id)).toBe(true)
    expect(q.retry(id)).toBe(false) // 非 failed 幂等
    await vi.waitFor(() => expect(done).toHaveLength(1))
    expect(client.calls.filter(c => c.startsWith('create:r.bin')).length).toBe(1) // 复用 uploadId
    expect(client.calls.filter(c => c === 'part:r.bin#1').length).toBe(1) // 已落定分片不重传
    expect(client.calls.filter(c => c === 'part:r.bin#2').length).toBe(2) // 失败分片重传
    expect(client.calls.filter(c => c === 'part:r.bin#3').length).toBe(2) // 首轮被取消竞态丢弃，重试补传
    expect(client.completed).toHaveLength(1)
    expect(client.completed[0]?.parts).toHaveLength(3)
    expect(client.bodies.get('r.bin')).toBe(25)
  })

  it('retry：failed 直传项=整重传；aborted 项不可 retry', async () => {
    const client = new FakeUploadClient()
    const { q, done, failed } = makeQueue(client, { multipartThreshold: 1024 })
    client.failPuts.add('x.txt')
    const res = q.enqueue([file('x.txt', 1), file('y.txt', 1)])
    await vi.waitFor(() => expect(failed).toHaveLength(1))
    client.failPuts.clear()
    expect(q.retry(res.accepted[0]!.id)).toBe(true)
    await vi.waitFor(() => expect(done).toHaveLength(2))
    expect(client.calls.filter(c => c === 'put:x.txt').length).toBe(2) // 整重传

    const idY = res.accepted[1]!.id
    await vi.waitFor(() => expect(q.status(idY)).toBe('done'))
    expect(q.retry(idY)).toBe(false) // 终态不可 retry
  })

  it('pauseAll/resumeAll：queued 项全部暂停/恢复；在途直传项落定即 done（诚实口径）', async () => {
    const client = new FakeUploadClient()
    const { q, done } = makeQueue(client, { uploadConcurrency: 1, multipartThreshold: 1024 })
    const res = q.enqueue([1, 2, 3].map(n => file(`f${n}.txt`, 1)))
    q.pauseAll()
    await vi.waitFor(() => expect(done).toHaveLength(1)) // f1 已在途：落定即完成
    await tick()
    expect(q.status(res.accepted[1]!.id)).toBe('paused')
    expect(q.status(res.accepted[2]!.id)).toBe('paused')
    expect(client.calls.some(c => c === 'put:f2.txt')).toBe(false)
    q.resumeAll()
    await vi.waitFor(() => expect(done).toHaveLength(3))
    expect(q.status(res.accepted[2]!.id)).toBe('done')
  })
})

// ───────── Lane G1：冲突探测确认（onConflict） ─────────

describe('上传队列：onConflict 冲突确认（Lane G1）', () => {
  it('缺省不探测：无 onConflict 时零 head 调用（现行为不变，同 key 直传覆盖）', async () => {
    const client = new FakeUploadClient()
    client.bodies.set('docs/a.txt', 9) // 服务端已有同名
    const { q, done } = makeQueue(client)
    const res = q.enqueue([file('a.txt', 1)], 'docs/')
    expect(res.rejected).toEqual([])
    await vi.waitFor(() => expect(done).toHaveLength(1))
    expect(client.heads).toHaveLength(0)
    expect(client.calls).toContain('put:docs/a.txt')
  })

  it('命中重名 → 回调裁决：skip 进 rejected{conflict}，overwrite 照传', async () => {
    const client = new FakeUploadClient()
    client.bodies.set('old.txt', 9)
    const { q, done } = makeQueue(client)

    const skip = vi.fn(async (): Promise<'skip'> => 'skip')
    const res = await q.enqueue([file('old.txt', 1), file('new.txt', 1)], '', { onConflict: skip })
    expect(skip).toHaveBeenCalledTimes(1)
    expect(skip).toHaveBeenCalledWith(['old.txt'])
    expect(res.rejected).toEqual([{ name: 'old.txt', reason: 'conflict', code: UPLOAD_CONFLICT_CODE }])
    expect(res.accepted).toHaveLength(1)
    await vi.waitFor(() => expect(done).toHaveLength(1))
    expect(client.calls).toContain('put:new.txt')
    expect(client.calls).not.toContain('put:old.txt') // skip 不上传

    const overwrite = vi.fn(async (): Promise<'overwrite'> => 'overwrite')
    const res2 = await q.enqueue([file('old.txt', 2)], '', { onConflict: overwrite })
    expect(res2.rejected).toEqual([])
    expect(res2.accepted).toHaveLength(1)
    await vi.waitFor(() => expect(done).toHaveLength(2))
    expect(client.calls).toContain('put:old.txt') // overwrite 照传（S3 同 key 覆盖）
  })

  it('无重名不回调；head 探测异常按不存在处理（不阻断上传）', async () => {
    const client = new FakeUploadClient()
    client.headFailKeys.add('boom.txt')
    const { q, done } = makeQueue(client)
    const onConflict = vi.fn(async (): Promise<'skip'> => 'skip')
    const res = await q.enqueue([file('ok.txt', 1), file('boom.txt', 1)], '', { onConflict })
    expect(onConflict).not.toHaveBeenCalled() // 无命中不回调
    expect(res.rejected).toEqual([])
    await vi.waitFor(() => expect(done).toHaveLength(2))
    expect(client.calls).toContain('put:boom.txt') // 探测失败回退直传
  })

  it('回调抛错（取消整批）→ enqueue reject 4901 语义，零入队零上传', async () => {
    const client = new FakeUploadClient()
    client.bodies.set('dup.txt', 3)
    const { q } = makeQueue(client)
    const onConflict = vi.fn(async (): Promise<'overwrite'> => {
      throw new SdkError(UPLOAD_ABORTED_CODE, '用户取消整批', null)
    })
    await expect(q.enqueue([file('dup.txt', 1)], '', { onConflict })).rejects.toMatchObject({
      code: UPLOAD_ABORTED_CODE,
    })
    expect(client.calls.some(c => c.startsWith('put:'))).toBe(false)
  })

  it('探测并发 ≤8：20 个重名文件 head 峰值不超上限，回调一次性收到全部重名', async () => {
    const client = new FakeUploadClient()
    const names = Array.from({ length: 20 }, (_, i) => `dup${i}.txt`)
    for (const n of names) client.bodies.set(n, 1)
    const { q, done } = makeQueue(client)
    const onConflict = vi.fn(async (): Promise<'overwrite'> => 'overwrite')
    const res = await q.enqueue(names.map(n => file(n, 1)), '', { onConflict })
    expect(client.heads).toHaveLength(20)
    expect(client.headPeak).toBeLessThanOrEqual(8)
    expect(onConflict).toHaveBeenCalledWith(expect.arrayContaining(['dup0.txt', 'dup19.txt']))
    expect(res.rejected).toEqual([])
    await vi.waitFor(() => expect(done).toHaveLength(20))
  })
})
