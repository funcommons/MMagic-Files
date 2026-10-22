/**
 * 参数归一化（纯逻辑，无 DOM——单测口径）。
 * 非法值一律丢弃走缺省（方案 §2.3：参数坏不击穿渲染链）。
 */
import type { ArtplayerOptions } from './types'

/** Artplayer 出厂强调色（theme 参数/宿主主色都取不到时的兜底） */
export const FALLBACK_THEME = '#23ade5'

export function normalizeOptions(raw: unknown): Required<ArtplayerOptions> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { autoplay: false, theme: FALLBACK_THEME }
  }
  const o = raw as Record<string, unknown>
  return {
    autoplay: o.autoplay === true,
    theme: typeof o.theme === 'string' && o.theme.trim() !== '' ? o.theme.trim() : FALLBACK_THEME,
  }
}

/**
 * 解析强调色：theme 参数优先；无参数时读宿主主题变量 --app-primary（渲染期 DOM 环境）。
 * documentElement 未就绪/取空 → FALLBACK_THEME。纯 DOM 读取，无副作用。
 */
export function resolveTheme(options: Required<ArtplayerOptions>): string {
  if (options.theme !== FALLBACK_THEME) return options.theme
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--app-primary').trim()
    return v !== '' ? v : FALLBACK_THEME
  } catch {
    return FALLBACK_THEME
  }
}
