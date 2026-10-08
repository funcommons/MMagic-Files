import { vi } from 'vitest'
import { config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'

// SDK 组件用 useI18n() (如 FcEmpty), 测试环境注册一个空 i18n 兜底 (t 回退到 key)
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {},
  missingWarn: false,
  fallbackWarn: false,
})

// Pinia: 一些组件 (FcThemeProvider 间接 / FcConfirm 走 store) 需要
const pinia = createPinia()

// 注册 ElementPlus 全局组件, 让 el-dialog / el-table / el-select / el-button 等
// 在 jsdom 下能被解析 (否则 wrapper 找不到组件, 断言炸).
config.global.plugins = [i18n, pinia, ElementPlus]

// jsdom 缺失 matchMedia (useResponsive / FcThemeProvider 用到)
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// jsdom 缺失 ResizeObserver
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom 在某些运行环境下 localStorage 不存在 (Node 实验性 --localstorage-file 未启用),
// 给测试一个内存版 store (FcThemeProvider 持久化需要).
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
  const memStore = new Map<string, string>()
  const fakeStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => { memStore.set(k, String(v)) },
    removeItem: (k: string) => { memStore.delete(k) },
    clear: () => memStore.clear(),
    key: (i: number) => Array.from(memStore.keys())[i] ?? null,
    get length() { return memStore.size },
  }
  try {
    Object.defineProperty(window, 'localStorage', { value: fakeStorage, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true })
  } catch {
    // best-effort, 部分环境下 window 不允许覆写
  }
}