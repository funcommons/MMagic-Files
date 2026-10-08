import { defineStore } from 'pinia'
import { ref } from 'vue'
import { OEM_CONFIG, type OemConfig } from '@/config/oem'

export type { OemConfig }

export const useOemStore = defineStore('oem', () => {
  // 前端配置文件内置, 启动即就绪 (不再从后端 /api/v1/oem/config 拉取)
  const config = ref<OemConfig>({ ...OEM_CONFIG })
  const loaded = ref(true)

  /**
   * 应用 OEM 配置到 DOM.
   *
   * 注: data-brand / data-theme 属性由 FcThemeProvider 管理 (基于 v-model:brand/theme + localStorage).
   * OEM 只设置 title / favicon / --el-color-* 等. OEM config.brand/theme 通过
   * App.vue 传给 FcThemeProvider 的 initialBrand/initialTheme prop 作为兜底默认.
   */
  function apply() {
    const c = config.value
    const root = document.documentElement

    if (c.title) document.title = c.title

    if (c.faviconUrl) {
      let link = document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = c.faviconUrl
    }

    if (c.primaryColor) root.style.setProperty('--el-color-primary', c.primaryColor)
    if (c.successColor) root.style.setProperty('--el-color-success', c.successColor)
    if (c.warningColor) root.style.setProperty('--el-color-warning', c.warningColor)
    if (c.dangerColor) root.style.setProperty('--el-color-danger', c.dangerColor)
  }

  return { config, loaded, apply }
})
