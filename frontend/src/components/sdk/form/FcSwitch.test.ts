import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcSwitch from './FcSwitch.vue'

describe('FcSwitch', () => {
  it('默认渲染 fc-switch + role=switch + aria-checked=false', () => {
    const w = mountFc(FcSwitch, { props: { modelValue: false } })
    const root = w.find('.fc-switch')
    expect(root.exists()).toBe(true)
    expect(root.attributes('role')).toBe('switch')
    expect(root.attributes('aria-checked')).toBe('false')
  })

  it('modelValue=activeValue 时加 is-active + aria-checked=true', () => {
    const w = mountFc(FcSwitch, { props: { modelValue: true } })
    expect(w.find('.fc-switch.is-active').exists()).toBe(true)
    expect(w.find('.fc-switch').attributes('aria-checked')).toBe('true')
  })

  it('点击 → emit update:modelValue + change (切到 activeValue)', async () => {
    const w = mountFc(FcSwitch, { props: { modelValue: false } })
    await w.find('.fc-switch').trigger('click')
    expect(emittedOf(w, 'update:modelValue')[0]).toEqual([true])
    expect(emittedOf(w, 'change')[0]).toEqual([true])
  })

  it('点击 active → 切到 inactiveValue', async () => {
    const w = mountFc(FcSwitch, { props: { modelValue: true } })
    await w.find('.fc-switch').trigger('click')
    expect(emittedOf(w, 'update:modelValue')[0]).toEqual([false])
  })

  it('自定义 activeValue/inactiveValue 字符串模式', async () => {
    const w = mountFc(FcSwitch, {
      props: { modelValue: 'off', activeValue: 'on', inactiveValue: 'off' },
    })
    expect(w.find('.fc-switch.is-active').exists()).toBe(false)
    await w.find('.fc-switch').trigger('click')
    expect(emittedOf(w, 'update:modelValue')[0]).toEqual(['on'])
  })

  it('disabled 时点击不 emit', async () => {
    const w = mountFc(FcSwitch, { props: { modelValue: false, disabled: true } })
    await w.find('.fc-switch').trigger('click')
    expect(emittedOf(w, 'update:modelValue').length).toBe(0)
    expect(w.find('.fc-switch.is-disabled').exists()).toBe(true)
    expect(w.find('.fc-switch').attributes('disabled')).toBeDefined()
  })

  it('loading 时点击不 emit + 加 is-loading + 显示 spinner', async () => {
    const w = mountFc(FcSwitch, { props: { modelValue: false, loading: true } })
    await w.find('.fc-switch').trigger('click')
    expect(emittedOf(w, 'update:modelValue').length).toBe(0)
    expect(w.find('.fc-switch.is-loading').exists()).toBe(true)
    expect(w.find('.fc-switch__spinner').exists()).toBe(true)
  })

  it('size=large → CSS 变量 --fc-switch-w=56', () => {
    const w = mountFc(FcSwitch, { props: { modelValue: false, size: 'large' } })
    const style = w.find('.fc-switch').attributes('style') ?? ''
    expect(style).toContain('--fc-switch-w: 56px')
    expect(style).toContain('--fc-switch-h: 28px')
  })

  it('activeText/inactiveText 渲染文案', () => {
    const w = mountFc(FcSwitch, {
      props: { modelValue: true, activeText: '开', inactiveText: '关' },
    })
    expect(w.text()).toContain('开')
    expect(w.text()).not.toContain('关')
  })

  it('inlinePrompt=true + active → 显示 ✓', () => {
    const w = mountFc(FcSwitch, {
      props: { modelValue: true, inlinePrompt: true },
    })
    expect(w.find('.fc-switch__inline').exists()).toBe(true)
    expect(w.text()).toContain('✓')
  })
})