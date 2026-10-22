/**
 * ExcelJS 样式/值 → HTML 映射纯函数集（xlsx-viewer 保真升级 B 方案，2026-10-21）。
 * 全部为无副作用纯函数（可单测）；DOM 装配在 xlsx.ts。
 * 覆盖面（保真度「中」）：底色/字色/粗斜/字号/字体族/删除线/下划线、四边边框、
 * 水平垂直对齐/换行、合并单元格、列宽/行高；**不含**图表/条件格式/图片（ExcelJS 数据面就无）。
 * 颜色：argb 直转；theme 色用 Office 默认主题近似表（未自定义主题的文件占绝大多数）+ tint 明暗调整。
 */

/** Office 默认主题色近似表（theme 索引 0-9：lt1/dk1/lt2/dk2/accent1-6） */
const THEME_COLORS = ['#FFFFFF', '#000000', '#EEECE1', '#1F497D', '#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646']

/** ExcelJS 颜色对象（argb / rgb / theme+tint 的联合形状） */
export interface ExcelColor {
  argb?: string
  rgb?: string
  theme?: number
  tint?: number
}

/** hex（#RRGGBB）→ rgb 三元组；无效返回 null */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.replace(/^#/, '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return null
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
}

/** tint 明暗调整：>0 变亮（向白插值）、<0 变暗（向黑插值），幅度 |tint|（Excel 口径近似） */
function applyTint(rgb: [number, number, number], tint: number): [number, number, number] {
  const target = tint > 0 ? 255 : 0
  const k = Math.abs(tint)
  return rgb.map((v) => Math.round(v + (target - v) * k)) as [number, number, number]
}

/** ExcelJS 颜色对象 → CSS 色；读不出返回 null（调用方跳过该样式项） */
export function colorToCss(color: ExcelColor | undefined): string | null {
  if (!color || typeof color !== 'object') return null
  const raw = color.argb ?? color.rgb
  if (typeof raw === 'string') {
    // FFRRGGBB（8 位）取后 6；RRGGBB（6 位）直用
    const hex = raw.length === 8 ? raw.slice(2) : raw.length === 6 ? raw : null
    if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null
    const rgb: [number, number, number] = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]
    const final = typeof color.tint === 'number' && color.tint !== 0 ? applyTint(rgb, color.tint) : rgb
    return `#${final.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }
  if (typeof color.theme === 'number' && color.theme >= 0 && color.theme < THEME_COLORS.length) {
    const base = THEME_COLORS[color.theme]!
    const rgb = hexToRgb(base)
    if (!rgb) return null
    const final = typeof color.tint === 'number' && color.tint !== 0 ? applyTint(rgb, color.tint) : rgb
    return `#${final.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }
  return null
}

/** ExcelJS 边框 style → CSS 宽度+线型；非已知线型返回 null */
const BORDER_STYLES: Record<string, string> = {
  thin: '1px solid',
  medium: '2px solid',
  thick: '3px solid',
  hair: '1px solid',
  dotted: '1px dotted',
  dashed: '1px dashed',
  dashDot: '1px dashed',
  dashDotDot: '1px dashed',
  double: '3px double',
}
export function borderCss(side: { style?: string; color?: ExcelColor } | undefined): string | null {
  if (!side || typeof side.style !== 'string') return null
  const css = BORDER_STYLES[side.style]
  if (!css) return null
  const color = colorToCss(side.color)
  return color ? `${css} ${color}` : css
}

/** ExcelJS 单元格值 → 显示文本（formula 取缓存结果 / richText 拼接 / hyperlink 取文本 / Date 本地化） */
export function cellValueText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (Array.isArray(value)) {
    // richText：[{text, font?}, ...] 拼纯文本（富文本内联样式 v1 不逐段还原，整格按主样式渲染）
    return value.map((seg) => (typeof seg === 'object' && seg !== null ? String((seg as { text?: unknown }).text ?? '') : String(seg))).join('')
  }
  if (typeof value === 'object') {
    const v = value as { formula?: unknown; result?: unknown; text?: unknown; error?: unknown; hyperlink?: unknown; richText?: unknown }
    if (v.result !== undefined) return cellValueText(v.result) // 公式：显示计算结果
    if (v.formula !== undefined) return '' // 公式无缓存结果（如 NOW() 动态函数）：显示空，不字符串化对象
    if (typeof v.text === 'string') return v.text // hyperlink：显示锚文本
    if (Array.isArray(v.richText)) return cellValueText(v.richText)
    if (v.error !== undefined) return String(v.error)
    if (v.hyperlink !== undefined) return String(v.hyperlink)
  }
  return String(value)
}

/** 列宽（Excel 字符单位）→ px（Calibri 11 近似：×7 + 5 padding） */
export function colWidthPx(width: number | undefined): number | null {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null
  return Math.round(width * 7 + 5)
}

/** 行高（pt）→ px（96/72 = 4/3） */
export function rowHeightPx(height: number | undefined): number | null {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null
  return Math.round(height * (96 / 72))
}

/** 列字母 → 0 基列号（A→0 … Z→25 AA→26） */
export function colLetterToIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0)
    if (code < 65 || code > 90) return -1
    n = n * 26 + (code - 64)
  }
  return n - 1
}

/** 解析合并区引用（'A1:C3' / 'A1'）→ {startRow, startCol, endRow, endCol}（0 基，含端点）；非法返回 null */
export function parseMergeRange(ref: string): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const m = ref.trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i)
  if (!m) return null
  const startCol = colLetterToIndex(m[1]!)
  const startRow = Number(m[2]!) - 1
  const endCol = m[3] ? colLetterToIndex(m[3]!) : startCol
  const endRow = m[4] ? Number(m[4]!) - 1 : startRow
  if (startCol < 0 || endCol < 0 || startRow < 0 || endRow < 0) return null
  return { startRow, startCol, endRow: Math.max(startRow, endRow), endCol: Math.max(startCol, endCol) }
}

/** 合并区集合 → 起点→跨度和 跳过坐标集（渲染时从格不生成 td） */
export function buildMergeIndex(merges: readonly string[]): {
  spans: Map<string, { rowSpan: number; colSpan: number }>
  skipped: Set<string>
} {
  const spans = new Map<string, { rowSpan: number; colSpan: number }>()
  const skipped = new Set<string>()
  for (const ref of merges) {
    const range = parseMergeRange(ref)
    if (!range) continue
    const { startRow, startCol, endRow, endCol } = range
    const rowSpan = endRow - startRow + 1
    const colSpan = endCol - startCol + 1
    if (rowSpan === 1 && colSpan === 1) continue // 单格引用不是合并区（防御：正常 merges 不会出现）
    spans.set(`${startRow}:${startCol}`, { rowSpan, colSpan })
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (r !== startRow || c !== startCol) skipped.add(`${r}:${c}`)
      }
    }
  }
  return { spans, skipped }
}
