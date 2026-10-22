/** find.ts 单测：跨 text-node 文本索引/位置映射（纯 JS mock doc，无 ProseMirror 依赖） */
import { describe, expect, it } from 'vitest'
import { buildIndex, findAllHits, locate, type DocLike, type DocNode } from '../find'

/** 纯 JS text node（叶子，无子孙） */
function textNode(text: string): DocNode {
  return { text, isText: true, descendants() {} }
}

/**
 * 扁平文档 mock：每段文本一个 paragraph，位置规则与 PM 一致——
 * para 依次排布（size=文本长+2），text 起点为所在 para 起点+1
 */
function doc(...texts: string[]): DocLike {
  const nodes: Array<{ node: DocNode; pos: number }> = []
  let paraStart = 0
  for (const t of texts) {
    nodes.push({ node: textNode(t), pos: paraStart + 1 })
    paraStart += t.length + 2
  }
  return {
    doc: {
      isText: false,
      descendants(cb) {
        for (const n of nodes) cb(n.node, n.pos)
      },
    },
  }
}

describe('buildIndex', () => {
  it('拼接 text node 文本并记录区段（base=pos+1）', () => {
    const { text, spans } = buildIndex(doc('hello', 'world'))
    expect(text).toBe('helloworld')
    expect(spans).toEqual([
      { start: 0, end: 5, base: 2 }, // para1 起点 0 → text pos 1 → base 2
      { start: 5, end: 10, base: 9 }, // para2 起点 7 → text pos 8 → base 9
    ])
  })
  it('空文档 → 空文本空区段', () => {
    expect(buildIndex(doc())).toEqual({ text: '', spans: [] })
  })
})

describe('locate / locateRange', () => {
  it('拼接文本下标 → 所在 node 的 PM 位置', () => {
    const { spans } = buildIndex(doc('hello', 'world'))
    expect(locate(spans, 0)).toBe(2) // node1 首字符
    expect(locate(spans, 4)).toBe(6) // node1 末字符（2+4）
    expect(locate(spans, 5)).toBe(9) // node2 首字符
    expect(locate(spans, 9)).toBe(13) // node2 末字符（9+4）
  })
  it('空区段不抛错 → 0', () => {
    expect(() => locate([], 5)).not.toThrow()
    expect(locate([], 5)).toBe(0)
  })
})

describe('findAllHits', () => {
  it('单 text node：计数与位置映射正确（from/to 覆盖目标文本）', () => {
    const hits = findAllHits(doc('say hi to hi'), 'hi')
    expect(hits).toEqual([
      { from: 6, to: 8 }, // base 2 + 'say hi'[4..6)
      { from: 12, to: 14 }, // base 2 + 'say hi to hi'[10..12)
    ])
  })
  it("跨 text node：query 'oworl' 命中 from 在 node1 内、to 在 node2 内", () => {
    const hits = findAllHits(doc('hello', 'world'), 'oworl')
    expect(hits).toEqual([{ from: 6, to: 13 }])
    // from 落在 node1 文本区段 [2,7)，to 落在 node2 文本区段 [9,14)
    expect(hits[0]!.from).toBeGreaterThanOrEqual(2)
    expect(hits[0]!.from).toBeLessThan(7)
    expect(hits[0]!.to).toBeGreaterThan(9)
    expect(hits[0]!.to).toBeLessThanOrEqual(14)
  })
  it("大小写不敏感：query 'HELLO' 命中 'Say HELLO'", () => {
    expect(findAllHits(doc('Say HELLO'), 'hello')).toEqual([{ from: 6, to: 11 }])
    expect(findAllHits(doc('Say hello'), 'HELLO')).toEqual([{ from: 6, to: 11 }])
  })
  it('空 query → 0 命中；无命中 → 空', () => {
    expect(findAllHits(doc('abc'), '')).toEqual([])
    expect(findAllHits(doc('abc'), 'zzz')).toEqual([])
    expect(findAllHits(doc(), 'abc')).toEqual([])
  })
  it("重叠查询：'aa' 对 'aaaa' → 2 个不重叠命中（i 步进 q.length）", () => {
    const hits = findAllHits(doc('aaaa'), 'aa')
    expect(hits).toEqual([
      { from: 2, to: 4 },
      { from: 4, to: 6 },
    ])
    expect(hits[1]!.from).toBeGreaterThanOrEqual(hits[0]!.to)
  })
})
