/**
 * 下载队列测试（Lane G1 传输任务中心下载侧）：顺序并发=1（峰值观测）/done 断点游标/
 * 失败即止 + retry 从断点续传/cancel（在途复核丢弃 + 等待中即时）/clearTerminal 终态清除。
 * triggerDownload 以 vi.mock 拦截（jsdom 无下载语义）；URL.createObjectURL 打桩。
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import { DownloadQueue } from '@/files/download-queue'
import { triggerDownload } from '@/utils/download'

vi.mock('@/utils/download', () => ({ triggerDownload: vi.fn() }))

class FakeGetClient {
  bodies = new Map<string, ArrayBuffer>()
  failKeys = new Set<string>()
  gets: string[] = []
  inflight = 0
  peak = 0
  gate: Promise<void> | null = null
  async get(key: string): Promise<Response> {
    this.gets.push(key)
    this.inflight++
    this.peak = Math.max(this.peak, this.inflight)
    try {
      if (this.gate) await this.gate
      if (this.failKeys.has(key)) throw new SdkError(ERROR_CODES.S3_ERROR, 'get boom', key)
      return new Response(this.bodies.get(key) ?? new ArrayBuffer(0))
    } finally {
      this.inflight--
    }
  }
}

const KEY = (name: string): string => `sessions/test/${name}`

describe('下载队列（Lane G1）', () => {
  beforeAll(() => {
    // jsdom 未实现 createObjectURL：打桩为稳定假 URL（triggerDownload 已 mock，不真消费）
    ;(URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock'
  })

  beforeEach(() => {
    vi.mocked(triggerDownload).mockClear() // 模块级 mock：清跨用例调用历史
  })

  it('enqueue：逐键 get→blob→triggerDownload，并发=1，终态 done + done/total 计数', async () => {
    const client = new FakeGetClient()
    const q = new DownloadQueue({ client })
    const id = q.enqueue([KEY('a.txt'), KEY('b.txt')])!
    expect(id).toBeTruthy()
    expect(q.enqueue([])).toBeNull() // 空批不建任务
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id)?.status).toBe('done'))
    const task = q.tasks.find((t) => t.id === id)!
    expect(task.done).toBe(2)
    expect(task.total).toBe(2)
    expect(client.gets).toEqual([KEY('a.txt'), KEY('b.txt')])
    expect(client.peak).toBe(1) // 顺序并发=1（浏览器多下载并发限制）
    expect(vi.mocked(triggerDownload).mock.calls.map((c) => c[1])).toEqual(['a.txt', 'b.txt'])
  })

  it('多任务串行：第二个任务等首个完成后才开始', async () => {
    const client = new FakeGetClient()
    const q = new DownloadQueue({ client })
    const id1 = q.enqueue([KEY('1.txt')])!
    const id2 = q.enqueue([KEY('2.txt')])!
    expect(q.tasks.find((t) => t.id === id2)?.status).toBe('active') // 等待中同显 active
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id1)?.status).toBe('done'))
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id2)?.status).toBe('done'))
    expect(client.gets).toEqual([KEY('1.txt'), KEY('2.txt')])
  })

  it('失败即止：get 失败 → failed + error，剩余键不再取；retry 从断点续传（已完成不重复）', async () => {
    const client = new FakeGetClient()
    client.failKeys.add(KEY('bad.txt'))
    const q = new DownloadQueue({ client })
    const id = q.enqueue([KEY('ok1.txt'), KEY('bad.txt'), KEY('ok2.txt')])!
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id)?.status).toBe('failed'))
    const task = q.tasks.find((t) => t.id === id)!
    expect(task.done).toBe(1) // 断点游标
    expect(task.error).toBe('get boom')
    expect(client.gets).toEqual([KEY('ok1.txt'), KEY('bad.txt')])

    expect(q.retry(id)).toBe(true)
    expect(q.retry(id)).toBe(false) // 已 active，幂等 false
    client.failKeys.clear()
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id)?.status).toBe('done'))
    // 断点续传：失败文件自身也重下（断点=首个未完成项），ok1 不重复
    expect(client.gets).toEqual([KEY('ok1.txt'), KEY('bad.txt'), KEY('bad.txt'), KEY('ok2.txt')])
    expect(vi.mocked(triggerDownload).mock.calls.filter((c) => c[1] === 'ok1.txt')).toHaveLength(1)
  })

  it('cancel：在途取流完成但不触发保存（复核丢弃）；retry 重新下载未完成文件', async () => {
    const client = new FakeGetClient()
    let release!: () => void
    client.gate = new Promise<void>((r) => { release = r })
    const q = new DownloadQueue({ client })
    const id = q.enqueue([KEY('slow.txt'), KEY('next.txt')])!
    await vi.waitFor(() => expect(client.gets).toHaveLength(1))
    expect(q.cancel(id)).toBe(true)
    expect(q.cancel(id)).toBe(false) // 终态幂等
    release()
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id)?.status).toBe('cancelled'))
    expect(q.tasks.find((t) => t.id === id)?.done).toBe(0)
    expect(vi.mocked(triggerDownload)).not.toHaveBeenCalled() // 已取流未触发，丢弃
    expect(client.gets).toEqual([KEY('slow.txt')]) // 后续键不再取

    expect(q.retry(id)).toBe(true)
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id)?.status).toBe('done'))
    expect(client.gets).toEqual([KEY('slow.txt'), KEY('next.txt')])
  })

  it('cancel：等待中任务即时取消（串行链到达时直接跳过）', async () => {
    const client = new FakeGetClient()
    const q = new DownloadQueue({ client })
    const id1 = q.enqueue([KEY('1.txt')])!
    const id2 = q.enqueue([KEY('2.txt')])!
    expect(q.cancel(id2)).toBe(true)
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id1)?.status).toBe('done'))
    expect(client.gets).toEqual([KEY('1.txt')]) // 已取消任务不执行
    expect(q.tasks.find((t) => t.id === id2)?.status).toBe('cancelled')
    expect(q.cancel('nope')).toBe(false)
    expect(q.retry(id1)).toBe(false) // done 不可 retry
  })

  it('clearTerminal：终态清除，active/等待中保留', async () => {
    const client = new FakeGetClient()
    let release!: () => void
    client.gate = new Promise<void>((r) => { release = r })
    const q = new DownloadQueue({ client })
    const id1 = q.enqueue([KEY('1.txt')])! // 在途（gate 挂起，active）
    const id2 = q.enqueue([KEY('2.txt')])! // 等待中
    const id3 = q.enqueue([KEY('3.txt')])! // 等待中
    expect(q.cancel(id3)).toBe(true) // 等待中取消（终态）
    expect(q.tasks).toHaveLength(3)
    q.clearTerminal()
    expect(q.tasks.map((t) => t.id)).toEqual([id1, id2]) // 终态 id3 清除；active/等待中保留
    release()
    await vi.waitFor(() => expect(q.tasks.find((t) => t.id === id2)?.status).toBe('done'))
  })
})
