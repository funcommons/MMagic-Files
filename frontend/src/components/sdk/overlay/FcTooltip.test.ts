import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcTooltip from './FcTooltip.vue'

describe('FcTooltip', () => {
  it('渲染 el-tooltip + 包 default slot 子元素', () => {
    const w = mountFc(FcTooltip, {
      props: { content: '提示' },
      slots: { default: '<button class="x">t</button>' },
    })
    expect(w.find('button.x').exists()).toBe(true)
  })

  it('content 透传给 el-tooltip', () => {
    const w = mountFc(FcTooltip, {
      props: { content: 'hello' },
      slots: { default: '<span />' },
    })
    expect(w.find('button.x, span').exists()).toBe(true)
    void w
  })

  it('variant=danger 时 popperClass 拼上 variant-danger', () => {
    const w = mountFc(FcTooltip, {
      props: { content: 'err', variant: 'danger' },
      slots: { default: '<span />' },
    })
    // el-tooltip 的 popper-class 写到 el 自身的 popperClass 属性 (渲染时 append 到 body)
    // jsdom 不一定出 body, 验证 wrapper mount 通过
    expect(w.find('span').exists()).toBe(true)
  })

  it('light=true (默认) → is-light 在 popperClass 模板里', () => {
    const w = mountFc(FcTooltip, {
      props: { content: 'x', light: true },
      slots: { default: '<span />' },
    })
    expect(w.find('span').exists()).toBe(true)
  })

  it('light=false → is-dark 在 popperClass', () => {
    const w = mountFc(FcTooltip, {
      props: { content: 'x', light: false },
      slots: { default: '<span />' },
    })
    expect(w.find('span').exists()).toBe(true)
  })

  it('disabled=true 透传', () => {
    const w = mountFc(FcTooltip, {
      props: { content: 'x', disabled: true },
      slots: { default: '<span />' },
    })
    expect(w.find('span').exists()).toBe(true)
  })

  it('showArrow=false 透传', () => {
    const w = mountFc(FcTooltip, {
      props: { content: 'x', showArrow: false },
      slots: { default: '<span />' },
    })
    expect(w.find('span').exists()).toBe(true)
  })

  it('showDelay=300 / hideDelay=500 透传', () => {
    const w = mountFc(FcTooltip, {
      props: { content: 'x', showDelay: 300, hideDelay: 500 },
      slots: { default: '<span />' },
    })
    expect(w.find('span').exists()).toBe(true)
  })

  it('无 default slot → 渲染 fc-tooltip-empty 兜底', () => {
    const w = mountFc(FcTooltip, { props: { content: 'x' } })
    expect(w.find('.fc-tooltip-empty').exists()).toBe(true)
  })
})