/**
 * code-editor 主题适配（code-editor升级建议 P1-1，OpenSumi theme 服务思路）：
 * 宿主 FcThemeProvider 体系 `html[data-brand][data-theme]` → `--app-*` CSS 变量
 * （品牌×明暗双维度，dark 变体由 brands/_xxx.scss 覆写 --brand-* 生效）→
 * monaco defineTheme('mmagic-light' | 'mmagic-dark') 动态注册 + setTheme 联动。
 * 切换信号=MutationObserver 监听 data-theme **与 data-brand**（brand 切换同样改 --app-* 计算值）。
 * 范围红线：8 类核心 token 对齐（底/前景/行号/选区/行高亮/注释/关键字/字符串/数字），
 * 长尾 token 由 base（vs / vs-dark）inherit 兜底——不做完整 VS Code 主题移植（成本黑洞）。
 * data-theme 非 'light'（dark / orange-black）一律按暗色基线：底色/前景仍从变量动态取，
 * 橙黑等暗系品牌自动成立。
 */
import type { editor as monacoEditorNS } from 'monaco-editor'

/** 宿主 CSS 变量快照（normalize 后的 #RRGGBB[AA]；读不到=null→走兜底） */
export interface HostThemeVars {
  bgCard: string | null
  bgMuted: string | null
  textPrimary: string | null
  textSecondary: string | null
  textTertiary: string | null
  primary: string | null
  separator: string | null
}

/** monaco IStandaloneThemeData 的结构子集（不 import 运行时 monaco——纯函数可单测） */
export interface MonacoThemeData {
  base: 'vs' | 'vs-dark'
  inherit: boolean
  rules: monacoEditorNS.ITokenThemeRule[]
  colors: Record<string, string>
}

/** 变量名 → 读取映射表（与 _app-aliases.scss 的 html[data-brand] 层同源） */
const VAR_MAP: Record<keyof HostThemeVars, string> = {
  bgCard: '--app-bg-card',
  bgMuted: '--app-bg-muted',
  textPrimary: '--app-text-primary',
  textSecondary: '--app-text-secondary',
  textTertiary: '--app-text-tertiary',
  primary: '--app-primary',
  separator: '--app-separator',
}

/**
 * CSS 色值 → monaco 认的 #RRGGBB[AA]：
 * 支持 #RGB / #RRGGBB / #RRGGBBAA / rgb() / rgba()；小写归一；
 * color-mix()/渐变等复杂值与垃圾输入 → null（调用方走兜底色）。
 */
export function normalizeHexColor(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return s
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (m) {
    const r = Math.round(Number(m[1]))
    const g = Math.round(Number(m[2]))
    const b = Math.round(Number(m[3]))
    if (r > 255 || g > 255 || b > 255) return null
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    if (m[4] === undefined) return `#${hex}`
    const a = Number(m[4])
    if (!Number.isFinite(a) || a < 0 || a > 1) return null
    return `#${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`
  }
  return null
}

/** 宿主是否暗色基线：data-theme 缺省=light（provider 默认）；非 'light' 的显式值（dark/orange-black）一律暗 */
export function isDarkHost(doc: Document): boolean {
  const theme = doc.documentElement.getAttribute('data-theme')
  return theme !== null && theme !== 'light'
}

/** 读宿主 --app-* 变量计算值（getComputedStyle 强制同步重算——attribute 变更后即时拿到新值） */
export function readHostThemeVars(doc: Document): HostThemeVars {
  const cs = getComputedStyle(doc.documentElement)
  const vars = {} as HostThemeVars
  for (const key of Object.keys(VAR_MAP) as Array<keyof HostThemeVars>) {
    vars[key] = normalizeHexColor(cs.getPropertyValue(VAR_MAP[key]))
  }
  return vars
}

/** 亮色基线的语法近似色（宿主无对应语义变量——固定色，VS Code 官方口径） */
const STRING_LIGHT = '#0b7a3e'
const STRING_DARK = '#98c379'
const NUMBER_LIGHT = '#098658'
const NUMBER_DARK = '#b5cea8'

/** 8 类核心 token → monaco 主题（bg/fg/行号/选区/行高亮 + comment/keyword/string/number rules） */
export function buildMonacoTheme(vars: HostThemeVars, dark: boolean): MonacoThemeData {
  const d = dark
  /** rules 的 foreground 只认 #RRGGBB（不支持 alpha）——带 alpha 的变量截断 */
  const opaque = (c: string): string => c.slice(0, 7)
  const bg = vars.bgCard ?? (d ? '#1e1e1e' : '#ffffff')
  const fg = vars.textPrimary ?? (d ? '#d4d4d4' : '#333333')
  const primary = vars.primary ?? (d ? '#3794ff' : '#409eff')
  return {
    base: d ? 'vs-dark' : 'vs',
    inherit: true, // 长尾 token（type/regexp/操作符/补全弹层等）由基线兜底
    rules: [
      { token: 'comment', foreground: opaque(vars.textTertiary ?? (d ? '#6a737d' : '#999999')), fontStyle: 'italic' },
      { token: 'keyword', foreground: opaque(primary) },
      { token: 'string', foreground: d ? STRING_DARK : STRING_LIGHT },
      { token: 'number', foreground: d ? NUMBER_DARK : NUMBER_LIGHT },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': vars.textTertiary ?? (d ? '#6e7681' : '#999999'),
      'editor.selectionBackground': `${opaque(primary)}4d`, // 30% 透明主色
      'editor.lineHighlightBackground': vars.bgMuted ?? (d ? '#2a2d2e' : '#f5f5f5'),
      'editorGutter.background': bg,
      'editorCursor.foreground': primary,
      'editorIndentGuide.background1': vars.separator ?? (d ? '#404040' : '#d0d0d0'),
    },
  }
}

/**
 * 宿主主题/品牌切换监听：data-theme 与 data-brand 都触发（brand 切换改 --app-* 计算值）。
 * 返回解绑函数（渲染器 dispose 时调用）。
 */
export function observeHostTheme(doc: Document, onChange: () => void): () => void {
  const mo = new MutationObserver(() => onChange())
  mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-brand'] })
  return () => mo.disconnect()
}
