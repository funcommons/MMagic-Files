import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcThemeProvider from './FcThemeProvider.vue'

describe('FcThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-brand')
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })

  it('mount 时把 data-brand/data-theme 写到 <html>', () => {
    mountFc(FcThemeProvider)
    expect(document.documentElement.getAttribute('data-brand')).toBe('ldx2')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('props.brand / props.theme 透传到 <html>', () => {
    mountFc(FcThemeProvider, { props: { brand: 'apple', theme: 'dark' } })
    expect(document.documentElement.getAttribute('data-brand')).toBe('apple')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('defaultBrand/defaultTheme 兜底', () => {
    mountFc(FcThemeProvider, { props: { defaultBrand: 'google', defaultTheme: 'dark' } })
    expect(document.documentElement.getAttribute('data-brand')).toBe('google')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('initialBrand/initialTheme 兜底 (props 没传时)', () => {
    mountFc(FcThemeProvider, { props: { initialBrand: 'mchuan', initialTheme: 'dark' } })
    expect(document.documentElement.getAttribute('data-brand')).toBe('mchuan')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('props.brand 优先于 initialBrand', () => {
    mountFc(FcThemeProvider, {
      props: { brand: 'apple', initialBrand: 'mchuan', defaultBrand: 'ldx2' },
    })
    expect(document.documentElement.getAttribute('data-brand')).toBe('apple')
  })

  it('change emit 在 brand/theme 变化时触发 (不是 mount)', async () => {
    const w = mountFc(FcThemeProvider, { props: { brand: 'ldx2' } })
    await w.setProps({ brand: 'apple' })
    await nextTick()
    const changes = emittedOf(w, 'change')
    expect(changes.length).toBeGreaterThanOrEqual(1)
    expect(changes[changes.length - 1]?.[0]).toEqual({ brand: 'apple', theme: 'light' })
  })

  it('update:brand / update:theme emit (props.brand 变化时)', async () => {
    const w = mountFc(FcThemeProvider, { props: { brand: 'ldx2' } })
    await w.setProps({ brand: 'apple' })
    await nextTick()
    expect(emittedOf(w, 'update:brand')).toContainEqual(['apple'])
  })

  it('持久化到 localStorage (变化时存, 不是 mount 即存)', async () => {
    const w = mountFc(FcThemeProvider, { props: { brand: 'ldx2' } })
    // mount 时不持久化 (无变化). 触发 change 后写
    await w.setProps({ brand: 'apple' })
    await nextTick()
    const raw = localStorage.getItem('fc-theme-provider')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.v).toBe(1)
    expect(parsed.brand).toBe('apple')
  })

  it('mount 时从 localStorage 恢复 (无 initial 兜底)', () => {
    localStorage.setItem('fc-theme-provider', JSON.stringify({ v: 1, brand: 'apple', theme: 'dark' }))
    mountFc(FcThemeProvider)
    expect(document.documentElement.getAttribute('data-brand')).toBe('apple')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('storage version 不匹配时忽略 (用 initialBrand 兜底)', () => {
    localStorage.setItem('fc-theme-provider', JSON.stringify({ v: 99, brand: 'apple', theme: 'dark' }))
    mountFc(FcThemeProvider, { props: { initialBrand: 'mchuan' } })
    expect(document.documentElement.getAttribute('data-brand')).toBe('mchuan')
  })

  it('persist=false 不写 localStorage', () => {
    mountFc(FcThemeProvider, { props: { persist: false, brand: 'apple' } })
    expect(localStorage.getItem('fc-theme-provider')).toBeNull()
  })

  it('custom persistKey', async () => {
    const w = mountFc(FcThemeProvider, { props: { persistKey: 'my-key', brand: 'ldx2' } })
    await w.setProps({ brand: 'apple' })
    await nextTick()
    expect(localStorage.getItem('my-key')).toBeTruthy()
    expect(localStorage.getItem('fc-theme-provider')).toBeNull()
  })

  it('无效 brand id 兜底到 defaultBrand', () => {
    mountFc(FcThemeProvider, { props: { brand: 'invalid-id', defaultBrand: 'ldx2' } })
    expect(document.documentElement.getAttribute('data-brand')).toBe('ldx2')
  })

  it('default slot 渲染', () => {
    const w = mountFc(FcThemeProvider, { slots: { default: '<div class="x">x</div>' } })
    expect(w.find('.x').exists()).toBe(true)
  })

  it('expose.reset 非受控模式: inner 状态回到 initial', async () => {
    const w = mountFc(FcThemeProvider, { props: { initialBrand: 'mchuan' } })
    const vm = w.vm as unknown as { reset?: () => void }
    vm.reset?.()
    await nextTick()
    expect(document.documentElement.getAttribute('data-brand')).toBe('mchuan')
  })

  it('expose.reset 受控模式: emit update:brand/theme 通知父级回退', async () => {
    const w = mountFc(FcThemeProvider, {
      props: { brand: 'apple', theme: 'dark', initialBrand: 'mchuan', initialTheme: 'light' },
    })
    const vm = w.vm as unknown as { reset?: () => void }
    vm.reset?.()
    await nextTick()
    expect(emittedOf(w, 'update:brand')).toContainEqual(['mchuan'])
    expect(emittedOf(w, 'update:theme')).toContainEqual(['light'])
  })
})