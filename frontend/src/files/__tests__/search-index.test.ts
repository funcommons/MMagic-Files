/**
 * 客户端元数据索引测试（P0 Lane G2）：
 * - scan：平铺翻页聚合（continuationToken 口径）、字段/rootPrefix 透传、目录标记排除、
 *   cap 截断（恰满不算截断 / 超 cap 停止且部分入库）、onProgress 逐页回调、重扫整体替换；
 * - search：glob（无通配=包含/前后缀/? 单字符/\* 转义，大小写不敏感）、size 边界（含等号）、
 *   type 扩展名分类、rootPrefix 过滤、lastModified 降序 + limit（默认 200）截断、组合 AND；
 * - stats：lastScanAt 内存态（实例隔离）；
 * - MetaStore：内存实现 upsert 语义；createIdbMetaStore 在 jsdom（无 indexedDB）降级内存，
 *   并以降级 store 跑通 scan→search 全链路。
 * 内存 Fake，不依赖 A3。
 */
import { describe, expect, it } from 'vitest'
import type { S3Client, S3ListResult } from '@/sdk/types'
import {
  SearchIndex,
  classifyType,
  compileGlob,
  createIdbMetaStore,
  createMemoryMetaStore,
} from '../search-index'
import type { MetaRow } from '../search-index'

/** 平铺 S3 Fake：key→{size,lastModified}；delimiter 忽略（scan 恒 delimiter=''）；pageSize 模拟翻页 */
class FakeListClient implements S3Client {
  objects = new Map<string, { size: number; lastModified?: number }>()
  pageSize = 0
  calls: { prefix: string; token?: string }[] = []

  async list(prefix: string, opts?: { continuationToken?: string; delimiter?: string }): Promise<S3ListResult> {
    this.calls.push({ prefix, token: opts?.continuationToken })
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort()
    const size = this.pageSize > 0 ? this.pageSize : Math.max(keys.length, 1)
    const start = opts?.continuationToken ? Number(opts.continuationToken) : 0
    const page = keys.slice(start, start + size)
    return {
      prefix,
      dirs: [],
      files: page.map((k) => {
        const meta = this.objects.get(k)
        return {
          key: k,
          name: k.slice(prefix.length),
          size: meta?.size ?? 0,
          lastModified: meta?.lastModified,
          isDir: false,
        }
      }),
      continuationToken: start + size < keys.length ? String(start + size) : undefined,
    }
  }

  // 其余 S3 面不被索引消费，显式抛错防误用
  async get(): Promise<Response> { throw new Error('未实现') }
  async put(): Promise<{ etag: string }> { throw new Error('未实现') }
  async head(): Promise<{ exists: boolean }> { throw new Error('未实现') }
  async copy(): Promise<void> { throw new Error('未实现') }
  async remove(): Promise<void> { throw new Error('未实现') }
  async createMultipart(): Promise<{ uploadId: string }> { throw new Error('未实现') }
  async uploadPart(): Promise<{ etag: string }> { throw new Error('未实现') }
  async completeMultipart(): Promise<void> { throw new Error('未实现') }
  async abortMultipart(): Promise<void> { throw new Error('未实现') }
}

describe('SearchIndex.scan', () => {
  it('平铺翻页聚合入库：字段透传、rootPrefix 规范化补尾斜杠、翻页到尽', async () => {
    const client = new FakeListClient()
    client.pageSize = 2
    client.objects.set('root/a.txt', { size: 1, lastModified: 100 })
    client.objects.set('root/sub/b.pdf', { size: 2, lastModified: 200 })
    client.objects.set('root/c.mp3', { size: 3 })
    client.objects.set('root/d/1.png', { size: 4, lastModified: 400 })
    client.objects.set('root/e', { size: 5 })

    const store = createMemoryMetaStore()
    const idx = new SearchIndex(store)
    const r = await idx.scan('root', client) // 无尾斜杠也应规范化
    expect(r).toEqual({ count: 5, truncated: false })
    expect(client.calls.length).toBeGreaterThan(1) // 确实翻页
    expect(client.calls[0]).toEqual({ prefix: 'root/', token: undefined })
    const rows = await store.loadAll()
    expect(rows).toHaveLength(5)
    const b = rows.find((x) => x.key === 'root/sub/b.pdf')
    expect(b).toEqual({
      key: 'root/sub/b.pdf', name: 'sub/b.pdf', size: 2, lastModified: 200, rootPrefix: 'root/',
    })
  })

  it('目录标记对象（key 以 / 结尾）不入索引', async () => {
    const client = new FakeListClient()
    client.objects.set('root/dir/', { size: 0 }) // mkdir 占位
    client.objects.set('root/dir/f.txt', { size: 1 })
    const store = createMemoryMetaStore()
    const idx = new SearchIndex(store)
    const r = await idx.scan('root/', client)
    expect(r.count).toBe(1)
    expect((await store.loadAll())[0]?.key).toBe('root/dir/f.txt')
  })

  it('cap 截断：超过 cap 即停（truncated:true），已取部分入库；恰好 cap 且无后续页不算截断', async () => {
    const client = new FakeListClient()
    for (let i = 0; i < 5; i++) client.objects.set(`root/f${i}.txt`, { size: i })
    const store = createMemoryMetaStore()
    const idx = new SearchIndex(store)

    const truncated = await idx.scan('root/', client, { cap: 3 })
    expect(truncated).toEqual({ count: 3, truncated: true })
    expect(await store.count()).toBe(3) // 部分索引可用

    const exact = await idx.scan('root/', client, { cap: 5 })
    expect(exact).toEqual({ count: 5, truncated: false }) // 恰满且有后续页标记时才可能截断
    expect(await store.count()).toBe(5)
  })

  it('onProgress：0 起点先发一次，随后逐页累计', async () => {
    const client = new FakeListClient()
    client.pageSize = 2
    for (let i = 0; i < 5; i++) client.objects.set(`root/f${i}.txt`, { size: i })
    const seen: number[] = []
    const idx = new SearchIndex(createMemoryMetaStore())
    await idx.scan('root/', client, { onProgress: (n) => seen.push(n) })
    expect(seen).toEqual([0, 2, 4, 5])
  })

  it('重扫整体替换：旧 key 清除、不重复累积', async () => {
    const client = new FakeListClient()
    client.objects.set('root/a.txt', { size: 1 })
    client.objects.set('root/b.txt', { size: 2 })
    const store = createMemoryMetaStore()
    const idx = new SearchIndex(store)
    await idx.scan('root/', client)

    client.objects.delete('root/a.txt')
    client.objects.set('root/c.txt', { size: 3 })
    const r = await idx.scan('root/', client)
    expect(r.count).toBe(2)
    const keys = (await store.loadAll()).map((x) => x.key).sort()
    expect(keys).toEqual(['root/b.txt', 'root/c.txt'])
  })
})

describe('search：glob', () => {
  const seedIdx = async (names: string[]): Promise<{ idx: SearchIndex; store: ReturnType<typeof createMemoryMetaStore> }> => {
    const store = createMemoryMetaStore()
    const rows: MetaRow[] = names.map((n, i) => ({
      key: `root/${n}`, name: n, size: i, lastModified: i, rootPrefix: 'root/',
    }))
    await store.put(rows)
    return { idx: new SearchIndex(store), store }
  }

  it('无通配符=包含匹配（大小写不敏感）', async () => {
    const { idx } = await seedIdx(['q3-Report.PDF', 'report.txt', 'summary.md', 'my.reports.zip'])
    const hits = await idx.search({ glob: 'report' })
    expect(hits.map((h) => h.name).sort()).toEqual(['my.reports.zip', 'q3-Report.PDF', 'report.txt'])
  })

  it('通配：前缀 rep* / 后缀 *.pdf / ? 单字符 / * 全匹配', async () => {
    const { idx } = await seedIdx(['report.txt', 'reports.zip', 'a.pdf', 'ab.pdf', 'x.md'])
    expect((await idx.search({ glob: 'rep*' })).map((h) => h.name).sort())
      .toEqual(['report.txt', 'reports.zip'])
    expect((await idx.search({ glob: '*.pdf' })).map((h) => h.name).sort())
      .toEqual(['a.pdf', 'ab.pdf'])
    expect((await idx.search({ glob: 'a?c.txt' })).map((h) => h.name)).toEqual([]) // ? 不匹配空/多字符
    const { idx: idx2 } = await seedIdx(['abc.txt', 'ac.txt', 'abcc.txt'])
    expect((await idx2.search({ glob: 'a?c.txt' })).map((h) => h.name)).toEqual(['abc.txt'])
    expect((await idx2.search({ glob: '*' })).length).toBe(3)
  })

  it('转义：\\* 匹配字面量星号，不当作通配', async () => {
    const { idx } = await seedIdx(['a*star.txt', 'axstar.txt', 'normal.txt'])
    expect((await idx.search({ glob: 'a\\*star.txt' })).map((h) => h.name)).toEqual(['a*star.txt'])
    // 同一仓名，? 通配两者皆中（* 也是一个字符）
    expect((await idx.search({ glob: 'a?star.txt' })).map((h) => h.name).sort())
      .toEqual(['a*star.txt', 'axstar.txt'])
    // 正则元字符（. 等）按字面量处理：'st.r' 不匹配 'star'
    expect((await idx.search({ glob: 'a\\*st.r.txt' })).map((h) => h.name)).toEqual([])
  })

  it('glob 缺省/空白=不过滤；正则元字符按字面量处理', async () => {
    const { idx } = await seedIdx(['a.txt', 'a(b).txt'])
    expect(await idx.search({})).toHaveLength(2)
    expect(await idx.search({ glob: '   ' })).toHaveLength(2)
    expect((await idx.search({ glob: 'a(b' })).map((h) => h.name)).toEqual(['a(b).txt'])
  })
})

describe('search：size / type / rootPrefix / 排序与 limit', () => {
  const store = createMemoryMetaStore()
  const idx = new SearchIndex(store)

  const row = (key: string, size: number, lastModified?: number, rootPrefix = 'root/'): MetaRow => ({
    key,
    name: key.slice(key.lastIndexOf('/') + 1),
    size,
    lastModified,
    rootPrefix,
  })

  it('size 过滤：min/max 边界含等号，缺省不限制', async () => {
    await store.clear()
    await store.put([row('a.txt', 100), row('b.txt', 2000), row('c.txt', 5000)])
    expect((await idx.search({ sizeMin: 2000 })).map((r) => r.name)).toEqual(['b.txt', 'c.txt'])
    expect((await idx.search({ sizeMax: 2000 })).map((r) => r.name)).toEqual(['a.txt', 'b.txt'])
    expect((await idx.search({ sizeMin: 100, sizeMax: 5000 })).length).toBe(3)
    expect((await idx.search({ sizeMin: 2001 })).map((r) => r.name)).toEqual(['c.txt'])
  })

  it('type 过滤：classifyType 扩展名分类表（大小写不敏感；无扩展名/未命中/隐藏文件=other）', async () => {
    expect(classifyType('a.png')).toBe('image')
    expect(classifyType('B.MP4')).toBe('video')
    expect(classifyType('c.mp3')).toBe('audio')
    expect(classifyType('d.pdf')).toBe('doc')
    expect(classifyType('e.xyz')).toBe('other')
    expect(classifyType('noext')).toBe('other')
    expect(classifyType('.gitignore')).toBe('other')
    expect(classifyType('x.tar.gz')).toBe('other') // 只看最后一段扩展名

    await store.clear()
    await store.put([
      row('img.png', 1), row('clip.mp4', 1), row('song.mp3', 1), row('doc.pdf', 1), row('bin.dat', 1),
    ])
    expect((await idx.search({ type: 'image' })).map((r) => r.name)).toEqual(['img.png'])
    expect((await idx.search({ type: 'video' })).length).toBe(1)
    expect((await idx.search({ type: 'audio' })).length).toBe(1)
    expect((await idx.search({ type: 'doc' })).length).toBe(1)
    expect((await idx.search({ type: 'other' })).map((r) => r.name)).toEqual(['bin.dat'])
  })

  it('rootPrefix 过滤：查询侧规范化补尾斜杠后精确比对', async () => {
    await store.clear()
    await store.put([row('a/1.txt', 1, 1, 'a/'), row('a/2.txt', 1, 2, 'a/'), row('b/3.txt', 1, 3, 'b/')])
    expect((await idx.search({ rootPrefix: 'a' })).length).toBe(2)
    expect((await idx.search({ rootPrefix: 'a/' })).length).toBe(2)
    expect((await idx.search({ rootPrefix: 'b' })).map((r) => r.key)).toEqual(['b/3.txt'])
  })

  it('排序 lastModified 降序（缺省视为 0 稳定保序）+ limit 默认 200 / 显式 / 0', async () => {
    await store.clear()
    await store.put([row('x.txt', 1, 300), row('y.txt', 1), row('z.txt', 1, 200)])
    expect((await idx.search({})).map((r) => r.key)).toEqual(['x.txt', 'z.txt', 'y.txt'])

    await store.clear()
    const many: MetaRow[] = []
    for (let i = 0; i < 250; i++) many.push(row(`m/${i}.txt`, i, i))
    await store.put(many)
    const defaulted = await idx.search({})
    expect(defaulted).toHaveLength(200)
    expect(defaulted[0]?.lastModified).toBe(249) // 截断保留最新
    expect((await idx.search({ limit: 3 })).map((r) => r.lastModified)).toEqual([249, 248, 247])
    expect(await idx.search({ limit: 0 })).toEqual([])
  })

  it('组合条件 AND（glob+type+size+rootPrefix）', async () => {
    await store.clear()
    await store.put([
      row('a/big.png', 9000, 1, 'a/'),
      row('a/small.png', 10, 2, 'a/'),
      row('a/big.txt', 9000, 3, 'a/'),
      row('b/big.png', 9000, 4, 'b/'),
    ])
    const hits = await idx.search({ glob: '*.png', type: 'image', sizeMin: 1000, rootPrefix: 'a/' })
    expect(hits.map((r) => r.key)).toEqual(['a/big.png'])
  })
})

describe('stats 与 store 语义', () => {
  it('stats：初始仅 count；scan 后带 lastScanAt；实例隔离（lastScanAt 是内存态）', async () => {
    const client = new FakeListClient()
    client.objects.set('root/a.txt', { size: 1, lastModified: 1 })
    const store = createMemoryMetaStore()
    const idx = new SearchIndex(store)
    expect(await idx.stats()).toEqual({ count: 0 })
    await idx.scan('root/', client)
    const s = await idx.stats()
    expect(s.count).toBe(1)
    expect(typeof s.lastScanAt).toBe('number')
    // 同 store 换新实例：lastScanAt 不随之带过去（内存态），count 仍在
    const fresh = new SearchIndex(store)
    expect(await fresh.stats()).toEqual({ count: 1 })
  })

  it('内存 store：put 按 key upsert / loadAll / count / clear', async () => {
    const store = createMemoryMetaStore()
    await store.put([{ key: 'k/1', name: '1', size: 1, rootPrefix: 'k/' }])
    await store.put([{ key: 'k/1', name: '1', size: 9, rootPrefix: 'k/' }, { key: 'k/2', name: '2', size: 2, rootPrefix: 'k/' }])
    expect(await store.count()).toBe(2)
    expect((await store.loadAll()).find((r) => r.key === 'k/1')?.size).toBe(9)
    await store.clear()
    expect(await store.count()).toBe(0)
    expect(await store.loadAll()).toEqual([])
  })

  it('createIdbMetaStore：jsdom 无 indexedDB（前置断言钉住分支）→ 降级内存语义', async () => {
    // 前置：受控环境确实无 indexedDB（jsdom 未实现、未引入 fake-indexeddb）。
    // 若未来 jsdom 内置 idb，本用例会先在这里失败，提示把降级分支改成显式注入路径来测。
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    expect(typeof indexedDB === 'undefined' || indexedDB === null).toBe(true)
    const store = createIdbMetaStore('mmagic-search')
    await store.put([
      { key: 'k/1.txt', name: '1.txt', size: 3, lastModified: 7, rootPrefix: 'k/' },
      { key: 'k/2.txt', name: '2.txt', size: 4, rootPrefix: 'k/' },
    ])
    expect(await store.count()).toBe(2)
    expect((await store.loadAll())[0]).toEqual({
      key: 'k/1.txt', name: '1.txt', size: 3, lastModified: 7, rootPrefix: 'k/',
    })
    await store.clear()
    expect(await store.count()).toBe(0)
  })

  it('降级 store 接入 SearchIndex：scan→search→stats 全链路可用', async () => {
    const client = new FakeListClient()
    client.objects.set('root/report.pdf', { size: 100, lastModified: 2 })
    client.objects.set('root/photo.png', { size: 200, lastModified: 1 })
    const idx = new SearchIndex(createIdbMetaStore('mmagic-search'))
    const r = await idx.scan('root/', client)
    expect(r).toEqual({ count: 2, truncated: false })
    expect((await idx.search({ glob: '*.pdf' })).map((h) => h.name)).toEqual(['report.pdf'])
    expect((await idx.stats()).count).toBe(2)
  })
})

describe('compileGlob 边界', () => {
  it('末尾孤立反斜杠按字面量处理；空串包含匹配恒真', () => {
    expect(compileGlob('a\\')('a\\b.txt')).toBe(true)
    expect(compileGlob('a\\')('ab.txt')).toBe(false)
    expect(compileGlob('')('anything.txt')).toBe(true)
  })
})
