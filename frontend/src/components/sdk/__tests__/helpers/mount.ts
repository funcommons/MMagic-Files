/**
 * SDK 测试统一入口.
 *
 * 在 setup.ts 已注入 i18n (空) + matchMedia + ResizeObserver,
 * 这里只补 Vue 3 + 测试断言常用工具.
 */
import { mount as vtuMount, type ComponentMountingOptions, type VueWrapper } from '@vue/test-utils'
import type { Component } from 'vue'

export type MountOptions<T extends Component> = ComponentMountingOptions<T>

/** 业务测试一律走这个: 后续可注入 router/pinia 而无需改测试. */
export function mountFc<T extends Component>(component: T, options: MountOptions<T> = {}) {
  return vtuMount(component, options)
}

/** 取出 wrapper 内某个 emit 的全部历史. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function emittedOf<T = unknown>(wrapper: VueWrapper<any>, name: string): T[][] {
  return (wrapper.emitted(name) as T[][] | undefined) ?? []
}
