/**
 * 文件树 store 测试（Wave1-A5）：空目录/CommonPrefixes/翻页聚合/缓存与 force/mkdir/
 * rename（文件+目录+续跑）/remove/onFileChanged/错误透传/pinia 薄壳；Lane F3：
 * applyChange（外部 fileChanged → 缓存最小维护：put 插入/已存保留、delete、rename、未缓存跳过）。
 * 内存 Fake，不依赖 A3。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import type { S3Client, S3ListResult, S3ObjectSummary } from '@/sdk/types'
import { createFileTree, useFileTreeStore } from '@/files/tree-store'
import type { FileChangedEvent } from '@/files/tree-store'

/** 内存 S3：key→size；树模式模拟 delimiter='/'，delimiter='' 为平铺；pageSize 模拟翻页 */
class FakeTreeClient implements S3Client {
  objects = new Map<string, { size: number; etag: string }>()
  calls: string[] = []
  copyFailKeys = new Set<string>()
  listFailPrefixes = new Set<string>()
  /** 抛裸 Error 的 prefix（验证非 SdkError 包装） */
  listRawFailPrefixes = new Set<string>()
  /** 每页条数；0 = 单页全部 */
  pageSize = 0

  async put(key: string): Promise<{ etag: string }> {
    this.calls.push(`put:${key}`)
    this.objects.set(key, { size: 0, etag: `etag-${key}` })
    return { etag: `etag-${key}` }
  }
  async list(prefix: string, opts?: { continuationToken?: string; delimiter?: string }): Promise<S3ListResult> {
    this.calls.push(`list:${prefix}|${opts?.delimiter ?? '/'}|${opts?.continuationToken ?? '-'}`)
    if (this.listFailPrefixes.has(prefix)) throw new SdkError(ERROR_CODES.S3_ERROR, 'list boom', 500)
    if (this.listRawFailPrefixes.has(prefix)) throw new Error('raw boom')
    const flat = opts?.delimiter === ''
    const dirs = new Map<string, S3ObjectSummary>()
    const files: S3ObjectSummary[] = []
    // 真实 S3 会把目录标记对象（key === prefix）列入 Contents，如实模拟，由 store 过滤
    for (const k of [...this.objects.keys()].filter(k => k.startsWith(prefix)).sort()) {
      const rest = k.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (!flat && slash >= 0) {
        const dirKey = prefix + rest.slice(0, slash + 1)
        if (!dirs.has(dirKey)) dirs.set(dirKey, { key: dirKey, name: rest.slice(0, slash), size: 0, isDir: true })
        continue
      }
      files.push({ key: k, name: rest, size: this.objects.get(k)?.size ?? 0, isDir: false })
    }
    // 合并后统一翻页（近似 S3 对 Contents+CommonPrefixes 联合分页）
    const all: S3ObjectSummary[] = [...dirs.values(), ...files]
    const size = this.pageSize > 0 ? this.pageSize : Math.max(all.length, 1)
    const start = opts?.continuationToken ? Number(opts.continuationToken) : 0
    const page = all.slice(start, start + size)
    return {
      prefix,
      dirs: page.filter(s => s.isDir),
      files: page.filter(s => !s.isDir),
      continuationToken: start + size < all.length ? String(start + size) : undefined,
    }
  }

  async copy(from: string, to: string): Promise<void> {
    this.calls.push(`copy:${from}->${to}`)
    if (this.copyFailKeys.has(from)) throw new SdkError(ERROR_CODES.S3_ERROR, 'copy boom', from)
    const src = this.objects.get(from)
    if (!src) throw new SdkError(ERROR_CODES.NOT_FOUND, `源不存在：${from}`)
    this.objects.set(to, { ...src })
  }
  async remove(keys: string[]): Promise<void> {
    this.calls.push(`remove:${keys.join(',')}`)
    for (const k of keys) this.objects.delete(k)
  }
  async head(key: string): Promise<{ exists: boolean; size?: number }> {
    return { exists: this.objects.has(key), size: this.objects.get(key)?.size }
  }
  async get(): Promise<Response> { throw new Error('未实现') }
  async createMultipart(): Promise<{ uploadId: string }> { throw new Error('未实现') }
  async uploadPart(): Promise<{ etag: string }> { throw new Error('未实现') }
  async completeMultipart(): Promise<void> { throw new Error('未实现') }
  async abortMultipart(): Promise<void> { throw new Error('未实现') }
}

describe('文件树 store', () => {
  let client: FakeTreeClient
  let events: FileChangedEvent[]
  const makeTree = () => createFileTree({ client, onFileChanged: e => events.push(e) })
  const listCalls = () => client.calls.filter(c => c.startsWith('list')).length
  const seed = (key: string, size = 1) => client.objects.set(key, { size, etag: `e-${key}` })

  beforeEach(() => {
    client = new FakeTreeClient()
    events = []
  })

  it('空目录（仅目录标记对象）加载后 files 为空且 loaded', async () => {
    seed('empty/', 0)
    const tree = makeTree()
    await tree.loadDir('empty') // 无尾斜杠也应规范化
    expect(tree.currentPath).toBe('empty/')
    const node = tree.nodes.get('empty/')
    expect(node?.loaded).toBe(true)
    expect(node?.dirs).toEqual([])
    expect(node?.files).toEqual([]) // 标记对象被过滤
  })

  it('含子目录（CommonPrefixes）的树构建', async () => {
    seed('a/b.txt', 3)
    seed('a/c/d.txt', 5)
    seed('a/e.txt', 0)
    const tree = makeTree()
    await tree.loadDir('a/')
    const node = tree.nodes.get('a/')
    expect(node?.dirs).toEqual([{ key: 'a/c/', name: 'c', size: 0, isDir: true }])
    expect(node?.files.map(f => f.name).sort()).toEqual(['b.txt', 'e.txt'])
    expect(node?.files.find(f => f.key === 'a/b.txt')?.size).toBe(3)
  })

  it('continuationToken 翻页聚合到尽', async () => {
    for (let i = 1; i <= 5; i++) seed(`p/f${i}.txt`)
    client.pageSize = 2
    const tree = makeTree()
    await tree.loadDir('p/')
    expect(tree.nodes.get('p/')?.files).toHaveLength(5)
    expect(client.calls.filter(c => c.startsWith('list'))).toEqual([
      'list:p/|/|-',
      'list:p/|/|2',
      'list:p/|/|4',
    ])
  })

  it('缓存命中不重复拉取；force 刷新；同 prefix 并发去重', async () => {
    seed('a/b.txt')
    const tree = makeTree()
    await tree.loadDir('a/')
    expect(listCalls()).toBe(1)
    await tree.loadDir('a/') // 缓存命中
    expect(listCalls()).toBe(1)
    await tree.loadDir('a/', { force: true })
    expect(listCalls()).toBe(2)
    await Promise.all([tree.loadDir('a/', { force: true }), tree.loadDir('a/', { force: true })])
    expect(listCalls()).toBe(3) // 在途去重
  })

  it('mkdir：put 目录标记 + 刷新父目录 + fileChanged(put)；非法名拒绝', async () => {
    seed('a/old.txt')
    const tree = makeTree()
    await tree.loadDir('a/')
    client.calls.length = 0
    const key = await tree.mkdir('a/', 'new')
    expect(key).toBe('a/new/')
    expect(client.calls).toContain('put:a/new/')
    expect(listCalls()).toBe(1) // 父目录被强制刷新
    expect(tree.nodes.get('a/')?.dirs.map(d => d.name)).toContain('new')
    expect(events).toEqual([{ key: 'a/new/', action: 'put' }])
    await expect(tree.mkdir('a/', '')).rejects.toMatchObject({ code: ERROR_CODES.BAD_PARAM })
    await expect(tree.mkdir('a/', 'x/y')).rejects.toMatchObject({ code: ERROR_CODES.BAD_PARAM })
  })

  it('文件 rename：copy+remove+缓存更新+fileChanged(rename)', async () => {
    seed('a/b.txt', 7)
    const tree = makeTree()
    await tree.loadDir('a/')
    client.calls.length = 0
    await tree.rename('a/b.txt', 'a/z.txt')
    expect(client.calls).toContain('copy:a/b.txt->a/z.txt')
    expect(client.calls).toContain('remove:a/b.txt')
    expect(client.objects.has('a/z.txt')).toBe(true)
    expect(client.objects.has('a/b.txt')).toBe(false)
    expect(tree.nodes.get('a/')?.files.map(f => f.name)).toEqual(['z.txt'])
    expect(events).toEqual([{ key: 'a/z.txt', action: 'rename', from: 'a/b.txt' }])
  })

  it('目录 rename：逐对象 copy + 批量 remove + 子树缓存失效 + fileChanged(rename)', async () => {
    seed('a/c/', 0)
    seed('a/c/d.txt', 2)
    seed('a/c/e/f.txt', 4)
    const tree = makeTree()
    await tree.loadDir('a/')
    client.calls.length = 0
    await tree.rename('a/c/', 'x/')
    expect(client.calls).toContain('copy:a/c/->x/') // 目录标记一并搬运（空目录语义）
    expect(client.calls).toContain('copy:a/c/d.txt->x/d.txt')
    expect(client.calls).toContain('copy:a/c/e/f.txt->x/e/f.txt')
    expect(client.calls).toContain('remove:a/c/,a/c/d.txt,a/c/e/f.txt')
    expect(client.objects.has('x/d.txt')).toBe(true)
    expect(client.objects.has('a/c/d.txt')).toBe(false)
    expect(tree.nodes.has('a/c/')).toBe(false)
    expect(tree.nodes.get('a/')?.dirs).toEqual([]) // 父目录已刷新
    expect(events).toEqual([{ key: 'x/', action: 'rename', from: 'a/c/' }])
  })

  it('目录 rename 失败：抛 SdkError 且 detail 携带已完成进度（续跑信息）', async () => {
    seed('a/c/', 0)
    seed('a/c/d.txt', 2)
    seed('a/c/e.txt', 3)
    client.copyFailKeys.add('a/c/d.txt')
    const tree = makeTree()
    const err = await tree.rename('a/c/', 'x/').then(() => null, (e: unknown) => e as SdkError)
    expect(err).toBeInstanceOf(SdkError)
    expect(err?.code).toBe(ERROR_CODES.S3_ERROR)
    expect(err?.detail).toMatchObject({ from: 'a/c/', to: 'x/', done: ['a/c/'], total: 3 })
    expect(client.objects.has('x/')).toBe(true) // 已完成部分保留在目标
    expect(client.objects.has('x/d.txt')).toBe(false)
  })

  it('remove：文件与目录混合展开 + 缓存失效 + 逐 key fileChanged(delete)', async () => {
    seed('a/b.txt', 2)
    seed('a/c/', 0)
    seed('a/c/d.txt', 3)
    const tree = makeTree()
    await tree.loadDir('a/')
    client.calls.length = 0
    await tree.remove(['a/b.txt', 'a/c/'])
    expect(client.calls).toContain('remove:a/b.txt,a/c/,a/c/d.txt') // 目录平铺展开后批量删
    expect(client.objects.has('a/c/d.txt')).toBe(false)
    expect(tree.nodes.has('a/c/')).toBe(false)
    expect(events).toEqual([
      { key: 'a/b.txt', action: 'delete' },
      { key: 'a/c/', action: 'delete' },
    ])
  })

  it('错误路径：list 抛 SdkError → error 态记录且原样 rethrow；非 SdkError 包装为 S3_ERROR', async () => {
    client.listFailPrefixes.add('bad/')
    client.listRawFailPrefixes.add('raw/')
    const tree = makeTree()
    const err = await tree.loadDir('bad/').then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(SdkError)
    expect((err as SdkError).message).toBe('list boom')
    expect(tree.error).toBe(err) // 同一实例透传
    expect(tree.nodes.has('bad/')).toBe(false)
    await expect(tree.loadDir('raw/')).rejects.toMatchObject({
      code: ERROR_CODES.S3_ERROR,
      message: 'raw boom',
    })
  })

  // ── Lane F3：applyChange（外部 fileChanged → 树缓存最小维护，不发网络请求） ──

  describe('applyChange（外部 fileChanged → 缓存最小维护）', () => {
    it('put：已缓存目录插入最小条目；已存在 key 保留原条目且不重复', async () => {
      seed('a/b.txt', 7)
      const tree = makeTree()
      await tree.loadDir('a/')
      tree.applyChange({ key: 'a/new.txt', action: 'put' })
      const files = tree.nodes.get('a/')?.files ?? []
      expect(files.map(f => f.key)).toEqual(['a/b.txt', 'a/new.txt'])
      expect(files.find(f => f.key === 'a/new.txt')).toMatchObject({
        key: 'a/new.txt', name: 'new.txt', size: 0, isDir: false,
      })
      // 已存在：size 等字段以 list 为权威，不覆盖、不重复插入
      tree.applyChange({ key: 'a/b.txt', action: 'put' })
      const again = tree.nodes.get('a/')?.files ?? []
      expect(again.filter(f => f.key === 'a/b.txt')).toHaveLength(1)
      expect(again.find(f => f.key === 'a/b.txt')?.size).toBe(7)
    })

    it('put：未缓存目录跳过（不创建半截 bucket）', () => {
      const tree = makeTree()
      tree.applyChange({ key: 'never-loaded/x.txt', action: 'put' })
      expect(tree.nodes.has('never-loaded/')).toBe(false)
      expect(tree.nodes.size).toBe(0)
    })

    it('put 目录标记 key（尾 /）→ 进父目录 dirs 不混入 files', async () => {
      seed('a/b.txt')
      const tree = makeTree()
      await tree.loadDir('a/')
      tree.applyChange({ key: 'a/sub/', action: 'put' })
      expect(tree.nodes.get('a/')?.dirs.map(d => d.key)).toEqual(['a/sub/'])
      expect(tree.nodes.get('a/')?.files.map(f => f.key)).toEqual(['a/b.txt'])
      expect(tree.nodes.get('a/')?.dirs[0]).toMatchObject({ name: 'sub', size: 0, isDir: true })
    })

    it('delete：从已缓存父目录移除条目；目录 delete 失效子树缓存', async () => {
      seed('a/b.txt', 2)
      seed('a/c/', 0)
      seed('a/c/d.txt', 3)
      const tree = makeTree()
      await tree.loadDir('a/')
      await tree.loadDir('a/c/')
      tree.applyChange({ key: 'a/b.txt', action: 'delete' })
      expect(tree.nodes.get('a/')?.files.map(f => f.key)).toEqual([])
      tree.applyChange({ key: 'a/c/', action: 'delete' })
      expect(tree.nodes.get('a/')?.dirs.map(d => d.key)).toEqual([])
      expect(tree.nodes.has('a/c/')).toBe(false) // 子树缓存已失效
    })

    it('delete：未缓存目录 → 空操作', () => {
      const tree = makeTree()
      tree.applyChange({ key: 'nope/x.txt', action: 'delete' })
      expect(tree.nodes.size).toBe(0)
    })

    it('rename：同目录换名（来源条目移除 + 目标条目插入）', async () => {
      seed('a/b.txt', 5)
      const tree = makeTree()
      await tree.loadDir('a/')
      tree.applyChange({ key: 'a/z.txt', action: 'rename', from: 'a/b.txt' })
      expect(tree.nodes.get('a/')?.files.map(f => f.key)).toEqual(['a/z.txt'])
    })

    it('rename：跨目录移动——来源移除；目标父目录未缓存则不插入', async () => {
      seed('a/b.txt')
      const tree = makeTree()
      await tree.loadDir('a/')
      tree.applyChange({ key: 'x/b.txt', action: 'rename', from: 'a/b.txt' })
      expect(tree.nodes.get('a/')?.files).toEqual([])
      expect(tree.nodes.has('x/')).toBe(false)
    })

    it('rename 目录：from 子树缓存失效 + 目标条目插入父目录 dirs', async () => {
      seed('a/c/', 0)
      seed('a/c/d.txt', 1)
      seed('a/x/', 0)
      seed('a/x/keep.txt', 1)
      const tree = makeTree()
      await tree.loadDir('a/')
      await tree.loadDir('a/c/')
      tree.applyChange({ key: 'a/y/', action: 'rename', from: 'a/c/' })
      expect(tree.nodes.has('a/c/')).toBe(false) // from 子树失效
      expect(tree.nodes.get('a/')?.dirs.map(d => d.name).sort()).toEqual(['x', 'y'])
    })

    it('rename 非法（缺 from / from===to）→ 整体忽略', async () => {
      seed('a/b.txt')
      const tree = makeTree()
      await tree.loadDir('a/')
      tree.applyChange({ key: 'a/z.txt', action: 'rename' })
      tree.applyChange({ key: 'a/b.txt', action: 'rename', from: 'a/b.txt' })
      expect(tree.nodes.get('a/')?.files.map(f => f.key)).toEqual(['a/b.txt'])
    })
  })

  it('pinia 薄壳：init 注入依赖并可重建控制器', async () => {
    setActivePinia(createPinia())
    const store = useFileTreeStore()
    expect(store.controller).toBeNull()
    seed('a/b.txt')
    const ctrl = store.init({ client, onFileChanged: e => events.push(e) })
    expect(store.controller).not.toBeNull()
    await store.controller!.loadDir('a/')
    expect(store.controller?.nodes.get('a/')?.loaded).toBe(true)
    expect(store.init({ client })).not.toBe(ctrl) // 重建后为新控制器
  })
})

// ───────────────────── ui.initialPath（复审 #7 消费）─────────────────────

describe('initialPath', () => {
  it('提供 initialPath 时 currentPath 以其为初值（相对 rootPrefix 的规范化 prefix）', () => {
    const tree = createFileTree({
      client: new FakeTreeClient(),
      rootPrefix: 'sessions/abc/',
      initialPath: 'sessions/abc/reports/2026/',
    })
    expect(tree.currentPath).toBe('sessions/abc/reports/2026/')
  })

  it('未提供时回落 rootPrefix（既有口径不变）', () => {
    const tree = createFileTree({ client: new FakeTreeClient(), rootPrefix: 'sessions/abc/' })
    expect(tree.currentPath).toBe('sessions/abc/')
  })
})
