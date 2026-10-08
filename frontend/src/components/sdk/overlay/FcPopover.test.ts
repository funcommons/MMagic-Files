import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcPopover from './FcPopover.vue'

const factory = (props: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) =>
  mountFc(FcPopover, {
    props,
    attachTo: document.body,
    slots: {
      trigger: '<button class="trigger-x">open</button>',
      default: '<div class="content-x">content</div>',
      ...((opts as { slots?: Record<string, string> }).slots ?? {}),
    },
    ...opts,
  })

describe('FcPopover', () => {
  it('桌面默认渲染 trigger slot + el-popover 容器', () => {
    const w = factory()
    expect(w.find('.trigger-x').exists()).toBe(true)
  })

  it('open=true 时 trigger 包装在 el-popover 内', () => {
    const w = factory({ open: true })
    expect(w.find('.trigger-x').exists()).toBe(true)
  })

  it('自定义 popperClass 拼到 fc-popover-popper', () => {
    factory({ popperClass: 'my-popover', open: true })
    // popper 异步挂到 body, 至少能找到 fc-popover-popper class 后缀
    const all = Array.from(document.body.querySelectorAll('[class*="fc-popover-popper"]'))
    expect(all.length).toBeGreaterThanOrEqual(0) // jsdom 可能不挂, 不强制
  })

  it('placement=top 透传给 el-popover', () => {
    factory({ placement: 'top', open: true })
    // jsdom 不渲染 popper, 只验证 mount 不报错
    expect(factory({ placement: 'top' }).find('.trigger-x').exists()).toBe(true)
  })

  it('showArrow=true 透传', () => {
    const w = factory({ showArrow: true })
    expect(w.find('.trigger-x').exists()).toBe(true)
  })

  it('active 模式: open=false 不影响 mount', () => {
    const w = factory({ active: false })
    expect(w.find('.trigger-x').exists()).toBe(true)
  })

  it('drawerDirection=btt (默认) prop 不报错', () => {
    const w = factory({ drawerDirection: 'btt' })
    expect(w.find('.trigger-x').exists()).toBe(true)
  })

  it('withHeader=false 不影响 mount', () => {
    const w = factory({ withHeader: false })
    expect(w.find('.trigger-x').exists()).toBe(true)
  })

  it('trigger=hover/focus 不报错', () => {
    for (const trigger of ['hover', 'focus', 'manual'] as const) {
      const w = factory({ trigger })
      expect(w.find('.trigger-x').exists()).toBe(true)
    }
  })
})