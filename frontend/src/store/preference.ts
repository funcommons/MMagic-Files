import { defineStore } from 'pinia'
import { mergeJSON, saveJSON } from '@/utils'

const STORAGE_KEY = 'ldx2-aigc:preference'

export type Theme = 'light' | 'dark'
export type Brand = 'ldx2' | 'apple' | 'google' | 'mchuan' | 'manyun' | 'acme'
export type Locale = 'zh-CN' | 'en-US'

export interface Preference {
  theme: Theme
  brand: Brand
  locale: Locale
  sidebarCollapsed: boolean
  sidebarWidth: number
  showAppearance: boolean
}

const DEFAULT_PREFERENCE: Preference = {
  theme: 'light',
  brand: 'ldx2',
  locale: 'zh-CN',
  sidebarCollapsed: false,
  sidebarWidth: 240,
  showAppearance: false,
}

function loadPreference(): Preference {
  return mergeJSON<Preference>(STORAGE_KEY, DEFAULT_PREFERENCE)
}

function savePreference(p: Preference) {
  // 仅持久化用户偏好维度 (theme/brand/locale/sidebar*); showAppearance 是 UI 临时态
  saveJSON(STORAGE_KEY, {
    theme: p.theme,
    brand: p.brand,
    locale: p.locale,
    sidebarCollapsed: p.sidebarCollapsed,
    sidebarWidth: p.sidebarWidth,
  })
}

export const usePreferenceStore = defineStore('preference', {
  state: (): Preference => loadPreference(),
  getters: {
    isDark: (s) => s.theme === 'dark',
  },
  actions: {
    setTheme(theme: Theme) {
      this.theme = theme
      this.applyToRoot()
      this.persist()
    },
    setBrand(brand: Brand) {
      this.brand = brand
      this.applyToRoot()
      this.persist()
    },
    setLocale(locale: Locale) {
      this.locale = locale
      this.persist()
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
      this.persist()
    },
    setSidebarWidth(width: number) {
      this.sidebarWidth = width
      // 只写 --app-sidebar-width, 不动 data-theme/data-brand:
      // FcThemeProvider 才是主题/品牌的写入端, 它的内部 applyToRoot() 会处理.
      // 这里同步调用一次保证 CSS var 立刻生效 (避免 resize 期间 var 滞后).
      document.documentElement.style.setProperty('--app-sidebar-width', `${this.sidebarWidth}px`)
      this.persist()
    },
    setSidebarCollapsed(collapsed: boolean) {
      this.sidebarCollapsed = collapsed
      this.persist()
    },
    setShowAppearance(v: boolean) {
      this.showAppearance = v
      this.persist()
    },
    /**
     * 重置 theme/brand/locale 到默认值. sidebar* / showAppearance 等 UI 布局字段不动.
     *
     * @param overrides OEM 当前配置 (可选); 传了则把 OEM.theme/brand/locale 作为"默认",
     *                  不传则用硬编码 DEFAULT_PREFERENCE.
     *
     * 行为:
     *  - 清 localStorage (下次启动重新走 OEM fallback)
     *  - 内存中重置 theme/brand/locale
     *  - 触发 applyToRoot (立即生效到 DOM)
     *  - 重新 persist (让 OEM overrides 写回, 跟启动期行为一致)
     */
    /**
     * 嵌入模式专用: 设置 brand/theme/locale 但 **不 persist**。
     *
     * 用于 URL query 参数 (brand/mode/language) 的即时生效:
     *  - 三方 iframe 嵌入时, query 参数只对本次会话生效, 不污染 localStorage。
     *  - 用户主动在 UI 里切换品牌/主题仍走 setBrand/setTheme/setLocale (会 persist)。
     */
    setFromEmbed(overrides: Partial<Pick<Preference, 'theme' | 'brand' | 'locale'>>) {
      if (overrides.brand) this.brand = overrides.brand
      if (overrides.theme) this.theme = overrides.theme
      if (overrides.locale) this.locale = overrides.locale
      this.applyToRoot()
      // 注意: 不调 persist()
    },
    reset(overrides?: Partial<Pick<Preference, 'theme' | 'brand' | 'locale'>>) {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // private mode / quota — ignore
      }
      this.theme = overrides?.theme ?? DEFAULT_PREFERENCE.theme
      this.brand = overrides?.brand ?? DEFAULT_PREFERENCE.brand
      this.locale = overrides?.locale ?? DEFAULT_PREFERENCE.locale
      this.applyToRoot()
      this.persist()
    },
    applyToRoot() {
      const html = document.documentElement
      html.setAttribute('data-theme', this.theme)
      html.setAttribute('data-brand', this.brand)
      html.style.setProperty('--app-sidebar-width', `${this.sidebarWidth}px`)
    },
    persist() {
      savePreference(this.$state)
    },
    init() {
      this.applyToRoot()
    },
  },
})
