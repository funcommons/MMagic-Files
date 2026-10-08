import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'remixicon/fonts/remixicon.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import pinia from './store'
import i18n from './locales'

import './styles/index.scss'
import { transformImageUrl, handleError, logger } from './utils'
import { useOemStore } from './store/oem'
import { ApiError } from './api/errorCodes'
import { getFriendlyMessage } from './utils/errorMessages'

const app = createApp(App)

// 注册 Element Plus
app.use(ElementPlus)

// 注册所有 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 全局属性 - 图片URL转换函数
app.config.globalProperties.$img = transformImageUrl

// 全局错误兜底：捕获组件渲染错误
app.config.errorHandler = (err) => {
  logger.error('[Vue Error]', err)
  handleError(err, i18n.global.t('common.page-error'))
}

// 全局兜底：捕获未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (event) => {
  logger.error('[Unhandled Rejection]', event.reason)
  const reason = event.reason
  // ApiError 且有友好文案 → 用 i18n key 翻译 (改善体验, 跨语言一致)
  if (reason instanceof ApiError) {
    const key = getFriendlyMessage(reason.code)
    if (key) {
      handleError(new ApiError(reason.code, i18n.global.t(key), {
        status: reason.status,
        silent: reason.silent,
        traceId: reason.traceId,
        details: reason.details,
      }), i18n.global.t('common.error'))
      return
    }
  }
  handleError(reason, i18n.global.t('api.request-failed'))
})

// 注册路由和状态管理
app.use(router)
app.use(pinia)
app.use(i18n)

// OEM 白标配置: 前端配置文件 (src/config/oem.ts) 内置默认值, 无网络请求.
// 同步 apply 设置 title / favicon / --el-color-* 后立即 mount, 无首屏闪烁.
//
// 注意: brand/theme 属性由 FcThemeProvider (在 App.vue 内) 管理,
// OEM config.brand/theme 通过 initialBrand/initialTheme prop 传给 Provider 作为兜底默认.
const oemStore = useOemStore()
oemStore.apply()
app.mount('#app')
