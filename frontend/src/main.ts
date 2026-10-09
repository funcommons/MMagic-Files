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
import { usePreferenceStore } from './store/preference'
import { ApiError } from './api/errorCodes'
import { getFriendlyMessage } from './utils/errorMessages'
import { bootApp, BOOT_KEY } from './boot'

// JSSDK 装配（契约《JSSDK 接口文档.md》§三）：iframe/独立窗加载即 boot——
// 成功=句柄 provide（UI/W2-T2 消费）；失败=BootResult 错误态 provide（Home 渲染错误卡）。
// 配置解析失败时的宿主通知属 best-effort，本期不实现（决策记录见 PROGRESS.md）。
// M1 overrides：workspace 模式下宿主命令由 tree/queue 实做接管（懒 busRef 解 boot 内时序——
// 命令执行必然晚于 bootApp 返回与 ready 往返，届时 busRef 已赋值）。
import { setupStores } from './files/setup'
import { createM1Overrides } from './files/commands'
import { pluginsEnabled, resolveFeatures, requireFeature } from './sdk/features'
import { registerBuiltins } from './apps/builtins'
import { RENDERERS } from './apps/renderers'
import { PluginLoader } from './plugins/loader'
import { ERROR_CODES, SdkError } from './sdk/errorCodes'
import type { MessageBus } from './sdk/bus'
import type { CommandHandler } from './sdk/handlers'
import type { CommandName } from './sdk/types'

// ───────────────────────── setTheme/setLocale 真实生效（F2） ─────────────────────────
// 校验与 handlers.ts 内置实现同形（payload 对象 + 枚举 → 4005 BAD_PARAM），override 保持回包 {} 一致；
// 执行落地 preference store：setFromEmbed=会话级生效、不 persist——嵌入会话不污染 localStorage
// （§4.2 禁 localStorage 持态；宿主 UI 主动切换仍走 store 的 set* 持久化路径）。
// handlers.ts 未导出枚举常量（只读文件），此处按其字面集镜像，改动需两处同步。
const THEME_VALUES = ['light', 'dark', 'auto'] as const
const LOCALE_VALUES = ['zh-CN', 'en-US'] as const

/** payload 必须为普通对象（与 handlers.ts asObject 同形） */
function asObjectPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new SdkError(ERROR_CODES.BAD_PARAM, 'payload 必须是对象')
  }
  return payload as Record<string, unknown>
}

/** 枚举字段校验（与 handlers.ts asEnum 同形：非法=4005） */
function asEnumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new SdkError(ERROR_CODES.BAD_PARAM, `${field} 非法：${String(value)}`)
  }
  return value as T
}

/** 'auto' → 跟随系统：preference/FcThemeProvider 只支持 light|dark（ThemeMode 无 auto） */
function resolveAutoTheme(theme: 'light' | 'dark' | 'auto'): 'light' | 'dark' {
  if (theme !== 'auto') return theme
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/**
 * 外观命令 overrides：workspace/file 两模式都要生效（overrides 此前仅 workspace 返回对象，
 * file 模式的 setTheme/setLocale 只落到 boot 内置内存态、UI 不动）。模式门控（guardMode）对
 * 这两条已放行，override 只替换门控后实现。
 */
function appearanceOverrides(): Partial<Record<CommandName, CommandHandler>> {
  return {
    setTheme: (payload) => {
      const theme = asEnumValue(asObjectPayload(payload).theme, THEME_VALUES, 'theme')
      usePreferenceStore().setFromEmbed({ theme: resolveAutoTheme(theme) })
      return {}
    },
    setLocale: (payload) => {
      const locale = asEnumValue(asObjectPayload(payload).locale, LOCALE_VALUES, 'locale')
      usePreferenceStore().setFromEmbed({ locale })
      i18n.global.locale.value = locale // App.vue 的 watcher 亦会同步；此处立即生效不依赖挂载态
      return {}
    },
  }
}

let busRef: MessageBus | null = null
/** M3：registerApp 通道回 appId 用——loader.onRegister 按「来源插件 url」记录注册成功的应用 id。
 *  按 url 而非单变量：load 对已载 url 幂等短路（不再 activate→onRegister 不触发），且启动
 *  非 lazy 加载与 registerApp 加载可并发，单变量会被并发注册互相覆盖、回错 appId。 */
const appIdByUrl = new Map<string, string>()
let pluginLoader: PluginLoader | null = null
const boot = bootApp({
  onWarn: () => logger.warn('[mmagic] 会话即将到期（T-5min，UX 线）'),
  setupPlugins: (registry, cfg) => {
    // features.plugins 总闸（《动态插件方案.md》§一）：显式 false → 动态插件整链不存在——
    // 不建 PluginLoader、不载配置注入的 plugins[]、不返回 ensureApps（打开链对缺省安全跳过）；
    // registerApp 命令口的 requireFeature(features,'plugins') 保持兜底（4301）。
    if (!pluginsEnabled(cfg.features)) return undefined
    pluginLoader = new PluginLoader({
      registry,
      onError: (err) => busRef?.emit('error', { code: err.code, message: err.message }),
      onRegister: (def, url) => {
        appIdByUrl.set(url, def.id)
      },
    })
    // 配置注入的非 lazy 插件：启动即载；lazy 插件经 ensureApps 在打开链未命中时触发（loader 幂等去重）
    if (cfg.mode === 'workspace') {
      for (const p of cfg.plugins ?? []) {
        if (p.lazy === false) void pluginLoader.load(p)
      }
      return {
        ensureApps: async (entry) => {
          const loader = pluginLoader as PluginLoader
          if (registry.resolveDefault({ name: entry.name, mime: entry.mime, size: entry.size })) return
          await Promise.all((cfg.plugins ?? []).map((p) => loader.load(p)))
        },
      }
    }
    return undefined
  },
  overrides: (cfg) => {
    const features = resolveFeatures(cfg.features)
    // F2：setTheme/setLocale 两模式都接管（file 模式此前无 overrides，外观命令只改内置内存态）
    const base = appearanceOverrides()
    if (cfg.mode !== 'workspace') return base
    const stores = setupStores(cfg, (evt, payload) => busRef?.emit(evt, payload))
    const m1 = createM1Overrides({
      tree: stores.tree,
      queue: stores.queue,
      client: stores.client as unknown as import('./sdk/types').S3Client,
      rootPrefix: cfg.backend.prefix,
      features,
      emit: (evt, payload) => busRef?.emit(evt, payload),
    })
    // M3：registerApp 通道（宿主运行时注册=动态追加配置注入插件）
    m1.registerApp = (payload) => {
      requireFeature(features, 'plugins')
      const p = (payload ?? {}) as { url?: unknown; sri?: unknown }
      const url = typeof p.url === 'string' ? p.url : null
      if (url === null) throw new SdkError(ERROR_CODES.BAD_PARAM, 'registerApp.url 必须是字符串')
      return (pluginLoader as PluginLoader)
        .load({ url, sri: typeof p.sri === 'string' ? p.sri : undefined })
        .then(() => {
          // 已载过的 url：loader 幂等短路不再 activate，onRegister 不触发——查表回既有 appId；
          // 并发首载（在途 Promise 共享）时本回调晚于注册结算，appIdByUrl 必已写入（loader F2 修复）
          const appId = appIdByUrl.get(url)
          if (!appId) throw new SdkError(ERROR_CODES.PLUGIN_LOAD_FAILED, '插件未注册任何应用')
          return { appId }
        })
    }
    // M1 表在前、外观命令在后：无键重叠（M1 不含 setTheme/setLocale），后者仅为防未来重叠时被静默吞掉
    return { ...m1, ...base }
  },
})
if (boot.ok) {
  busRef = boot.handle.bus
  // M2：内置应用注册（真实渲染器注入，替换占位渲染链）
  registerBuiltins(boot.handle.registry, RENDERERS)
}

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

// JSSDK 装配结果注入
app.provide(BOOT_KEY, boot)

// OEM 白标配置: 前端配置文件 (src/config/oem.ts) 内置默认值, 无网络请求.
// 同步 apply 设置 title / favicon / --el-color-* 后立即 mount, 无首屏闪烁.
//
// 注意: brand/theme 属性由 FcThemeProvider (在 App.vue 内) 管理,
// OEM config.brand/theme 通过 initialBrand/initialTheme prop 传给 Provider 作为兜底默认.
const oemStore = useOemStore()

// F2：cfg.appearance 生效（方案设计 §4.9 OEM/主题/语言）——boot.ok 后、mount 前应用，无首屏闪烁。
// - theme/locale → preference 既有 API（setFromEmbed=会话级、不 persist：嵌入会话不污染
//   localStorage，§4.2 禁 localStorage 持态；App.vue 的 immediate watcher 挂载前即同步 FcThemeProvider/i18n）
// - brand{name,logoUrl,primaryColor} → oem store 既有字段（apply() 落 document.title/favicon/
//   --el-color-primary）；brand.name 无专用「品牌名」API，落 companyName+title 两处
if (boot.ok) {
  const appearance = boot.handle.config.appearance
  if (appearance) {
    const preference = usePreferenceStore()
    if (appearance.theme) preference.setFromEmbed({ theme: resolveAutoTheme(appearance.theme) })
    if (appearance.locale) preference.setFromEmbed({ locale: appearance.locale })
    const brand = appearance.brand
    if (brand) {
      if (brand.name) {
        oemStore.config.companyName = brand.name
        oemStore.config.title = brand.name
      }
      if (brand.logoUrl) oemStore.config.logoUrl = brand.logoUrl
      if (brand.primaryColor) oemStore.config.primaryColor = brand.primaryColor
    }
  }
}

oemStore.apply()
app.mount('#app')
