/** sidecar 标注层（方案 §五 P2 + §九 P3）：
 *  `<key>.annotations.json`，schema=v1（对齐 mermaid meta 惯例）；导出=显式动作（不做自动双写）；
 *  导入合并（P3）：按 id 去重、createdAt 定序、id 冲突保留双份（副本 id 加 -m<n> 后缀） */
import type { Annotation } from './types'

export interface Sidecar {
  schema: 'v1'
  author: string
  exportedAt: string
  annotations: Annotation[]
  formValues: Record<string, string | boolean>
}

export const SIDECAR_SUFFIX = '.annotations.json'

export function sidecarKeyOf(key: string): string {
  return `${key}${SIDECAR_SUFFIX}`
}

export function toSidecar(annotations: Annotation[], formValues: Record<string, string | boolean>, author: string): Sidecar {
  return {
    schema: 'v1',
    author,
    exportedAt: new Date().toISOString(),
    annotations: JSON.parse(JSON.stringify(annotations)),
    formValues: { ...formValues },
  }
}

export function parseSidecar(text: string): Sidecar | null {
  try {
    const raw = JSON.parse(text) as Partial<Sidecar>
    if (raw.schema !== 'v1' || !Array.isArray(raw.annotations)) return null
    return {
      schema: 'v1',
      author: typeof raw.author === 'string' ? raw.author : 'unknown',
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      annotations: raw.annotations,
      formValues: raw.formValues ?? {},
    }
  } catch {
    return null
  }
}

export interface MergeResult {
  annotations: Annotation[]
  added: number
  duplicated: number
}

/** P3 归并：createdAt 定序；同 id=冲突 → 保留双份（新副本 id 加 -m<n> 防撞），人工裁 */
export function mergeAnnotations(mine: Annotation[], incoming: Annotation[]): MergeResult {
  const byId = new Map<string, Annotation>()
  for (const a of mine) byId.set(a.id, a)
  const ordered = [...incoming, ...mine].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  const out: Annotation[] = []
  let added = 0
  let duplicated = 0
  const suffixSeed = new Map<string, number>()
  for (const a of ordered) {
    if (!byId.has(a.id)) {
      byId.set(a.id, a)
      out.push(a)
      added++
      continue
    }
    // 冲突：保留双份（改 id），按 createdAt 新者排后
    duplicated++
    const n = (suffixSeed.get(a.id) ?? 0) + 1
    suffixSeed.set(a.id, n)
    const copy: Annotation = { ...a, id: `${a.id}-m${n}` }
    byId.set(copy.id, copy)
    out.push(copy)
  }
  return { annotations: out, added, duplicated }
}
