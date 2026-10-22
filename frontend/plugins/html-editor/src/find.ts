/**
 * 查找替换文本索引（纯函数模块，无编辑器/ProseMirror 依赖）：
 * - 跨 text-node 拼接文档文本 + 位置映射（拼接文本下标 ↔ PM 文档位置）
 * - state 参数为结构最小类型（PM EditorState/Node 结构兼容，便于单测 mock）
 */

/** 文本节点结构最小形状（PM Node 子集） */
export interface DocNode {
  text?: string
  isText: boolean
  descendants(cb: (node: DocNode, pos: number) => void): void
}

/** 编辑器 state 结构最小形状（PM EditorState 子集） */
export interface DocLike {
  doc: DocNode
}

/** text-node 区段：拼接文本 [start,end) ↔ PM 文档 base（首字符位置） */
export interface TextSpan {
  start: number
  end: number
  base: number
}

/** 命中区段（PM 文档坐标） */
export interface Hit {
  from: number
  to: number
}

/** 拼接所有 text node 文本并记录各区段（base=pos+1：跳过节点开 tag 位） */
export function buildIndex(state: DocLike): { text: string; spans: TextSpan[] } {
  let text = ''
  const spans: TextSpan[] = []
  state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      spans.push({ start: text.length, end: text.length + node.text.length, base: pos + 1 })
      text += node.text
    }
  })
  return { text, spans }
}

/** 拼接文本下标 → PM 文档位置（越界回落最后区段起点；空索引 → 0） */
export function locate(spans: TextSpan[], charIdx: number): number {
  for (const s of spans) {
    if (charIdx >= s.start && charIdx < s.end) return s.base + (charIdx - s.start)
  }
  return spans.length ? spans[spans.length - 1]!.base : 0
}

/** 拼接文本区段 → PM 文档区段 */
export function locateRange(spans: TextSpan[], from: number, to: number): Hit {
  return { from: locate(spans, from), to: locate(spans, to - 1) + 1 }
}

/** 全量检索（大小写不敏感、不重叠、按出现顺序）；空 query → 无命中 */
export function findAllHits(state: DocLike, query: string): Hit[] {
  if (!query) return []
  const { text, spans } = buildIndex(state)
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const hits: Hit[] = []
  let i = lower.indexOf(q)
  while (i !== -1) {
    hits.push(locateRange(spans, i, i + q.length))
    i = lower.indexOf(q, i + Math.max(1, q.length))
  }
  return hits
}
