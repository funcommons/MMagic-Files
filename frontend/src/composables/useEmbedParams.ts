/**
 * useEmbedParams - 嵌入模式外观参数解析。
 *
 * 从 URL query 中解析 brand / mode / language 三个外观参数,
 * 通过 preference.setFromEmbed() 即时生效但 **不写入 localStorage**。
 *
 * 认证参数 (access_token) 由 useEmbedToken 处理, 不在此 composable 范围。
 *
 * 用法 (router beforeEach):
 *   const embed = useEmbedParams()
 *   embed.applyFromRoute(to)
 */
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { usePreferenceStore, type Brand, type Theme, type Locale } from '@/store/preference'

/** 白名单校验 — 与 SDK brands.ts BRANDS 保持同步 */
const VALID_BRANDS = new Set<string>([
  'ldx2', 'apple', 'google', 'mchuan', 'manyun', 'acme', 'microsoft', 'vonnex',
])
const VALID_MODES = new Set<string>(['light', 'dark'])
const VALID_LOCALES = new Set<string>(['zh-CN', 'en-US'])

export interface EmbedAppearanceParams {
  brand?: Brand
  mode?: Theme
  language?: Locale
}

/**
 * 从 route.query 解析外观参数。
 * 非法值静默忽略 (不报错, 不 fallback)。
 */
export function parseEmbedAppearance(query: RouteLocationNormalizedLoaded['query']): EmbedAppearanceParams {
  const result: EmbedAppearanceParams = {}

  const brand = query.brand
  if (typeof brand === 'string' && VALID_BRANDS.has(brand)) {
    result.brand = brand as Brand
  }

  const mode = query.mode
  if (typeof mode === 'string' && VALID_MODES.has(mode)) {
    result.mode = mode as Theme
  }

  const language = query.language
  if (typeof language === 'string' && VALID_LOCALES.has(language)) {
    result.language = language as Locale
  }

  return result
}

/**
 * 解析 + 应用。在 router beforeEach 中调用。
 * 幂等: 多次调用同一 query 结果相同。
 */
export function useEmbedParams() {
  const preference = usePreferenceStore()

  function applyFromRoute(route: RouteLocationNormalizedLoaded) {
    const params = parseEmbedAppearance(route.query)
    if (params.brand || params.mode || params.language) {
      preference.setFromEmbed({
        brand: params.brand,
        theme: params.mode,
        locale: params.language,
      })
    }
  }

  return { applyFromRoute, parseEmbedAppearance }
}
