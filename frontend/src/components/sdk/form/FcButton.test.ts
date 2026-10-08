import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcButton from './FcButton.vue'

describe('FcButton', () => {
  it('渲染默认 variant=primary + size=md', () => {
    const w = mountFc(FcButton, { slots: { default: '保存' } })
    const el = w.find('.fc-button')
    expect(el.exists()).toBe(true)
    expect(el.classes()).toContain('variant-primary')
    expect(el.classes()).toContain('size-md')
    expect(el.classes()).not.toContain('is-block')
    expect(w.text()).toBe('保存')
  })

  it('variant=danger 输出 fc-button.variant-danger', () => {
    const w = mountFc(FcButton, { props: { variant: 'danger' }, slots: { default: '删' } })
    expect(w.find('.fc-button.variant-danger').exists()).toBe(true)
  })

  it('size=sm 输出 size-sm class', () => {
    const w = mountFc(FcButton, { props: { size: 'sm' }, slots: { default: 'x' } })
    expect(w.find('.fc-button.size-sm').exists()).toBe(true)
  })

  it('显式 type 覆盖 variant', () => {
    const w = mountFc(FcButton, { props: { variant: 'primary', type: 'warning' } })
    // el-button 渲染 warning 类型 (EP 用 el-button--warning, 不是 is-warning)
    expect(w.find('.fc-button.variant-primary').exists()).toBe(true)
    expect(w.find('.el-button.el-button--warning').exists()).toBe(true)
  })

  it('block 时加 is-block class', () => {
    const w = mountFc(FcButton, { props: { block: true } })
    expect(w.find('.fc-button.is-block').exists()).toBe(true)
  })

  it('点击触发 click 事件', async () => {
    const w = mountFc(FcButton, { slots: { default: 'go' } })
    await w.trigger('click')
    expect(emittedOf(w, 'click').length).toBe(1)
  })

  it('disabled 时点击不 emit click', async () => {
    const w = mountFc(FcButton, { props: { disabled: true } })
    await w.trigger('click')
    expect(emittedOf(w, 'click').length).toBe(0)
  })

  it('loading 时点击不 emit click', async () => {
    const w = mountFc(FcButton, { props: { loading: true } })
    await w.trigger('click')
    expect(emittedOf(w, 'click').length).toBe(0)
  })

  it('variant=text 时加 is-text-like class', () => {
    const w = mountFc(FcButton, { props: { variant: 'text' } })
    expect(w.find('.fc-button.is-text-like').exists()).toBe(true)
  })
})
