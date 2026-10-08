/**
 * 切换 documentElement 的 data-theme / data-brand, 触发 SDK 主题/品牌样式
 * 重新计算. 测试结束 in restore 还原.
 *
 * 使用方式:
 *   afterEach(() => resetDataAttrs())
 *   it('dark 时...', () => { setDataAttrs({ theme: 'dark' }); ... })
 */
type Theme = 'light' | 'dark'
type Brand = string

const PREV = { theme: 'light' as Theme, brand: 'ldx2' as Brand }

export function setDataAttrs(attrs: { theme?: Theme; brand?: Brand }): void {
  const el = document.documentElement
  if (attrs.theme) {
    PREV.theme = (el.getAttribute('data-theme') as Theme) ?? PREV.theme
    el.setAttribute('data-theme', attrs.theme)
  }
  if (attrs.brand) {
    PREV.brand = el.getAttribute('data-brand') ?? PREV.brand
    el.setAttribute('data-brand', attrs.brand)
  }
}

export function resetDataAttrs(): void {
  const el = document.documentElement
  el.setAttribute('data-theme', PREV.theme)
  el.setAttribute('data-brand', PREV.brand)
}
