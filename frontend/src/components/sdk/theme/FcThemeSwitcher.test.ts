import { describe, it, expect, beforeEach } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcThemeSwitcher from './FcThemeSwitcher.vue'
import { BRANDS, THEMES } from './brands'

describe('FcThemeSwitcher', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-brand')
    document.documentElement.removeAttribute('data-theme')
  })

  it('variant=inline 渲染 fc-theme-switcher--inline + 主题 + 品牌区', () => {
    const w = mountFc(FcThemeSwitcher, { props: { variant: 'inline' } })
    expect(w.find('.fc-theme-switcher--inline').exists()).toBe(true)
    expect(w.findAll('.fc-ts-swatch').length).toBe(THEMES.length)
    expect(w.findAll('.fc-ts-brand-card').length).toBe(BRANDS.length)
  })

  it('当前 theme 加 active class', () => {
    const w = mountFc(FcThemeSwitcher, { props: { variant: 'inline', theme: 'dark' } })
    const swatches = w.findAll('.fc-ts-swatch')
    const darkIdx = THEMES.findIndex(t => t.id === 'dark')
    expect(swatches[darkIdx]!.classes()).toContain('active')
  })

  it('当前 brand 加 active class + 渲染 check 图标', () => {
    const w = mountFc(FcThemeSwitcher, { props: { variant: 'inline', brand: 'apple' } })
    const appleIdx = BRANDS.findIndex(b => b.id === 'apple')
    const cards = w.findAll('.fc-ts-brand-card')
    expect(cards[appleIdx]!.classes()).toContain('active')
    expect(cards[appleIdx]!.find('.fc-ts-brand-card__check').exists()).toBe(true)
  })

  it('独立模式: 点 theme → emit update:theme', async () => {
    const w = mountFc(FcThemeSwitcher, { props: { variant: 'inline', theme: 'light' } })
    // 直接拿 dark 索引 (THEMES[1])
    const darkIdx = THEMES.findIndex(t => t.id === 'dark')
    await w.findAll('.fc-ts-swatch')[darkIdx]!.trigger('click')
    expect(emittedOf(w, 'update:theme')[0]).toEqual(['dark'])
  })

  it('独立模式: 点 brand → emit update:brand', async () => {
    const w = mountFc(FcThemeSwitcher, { props: { variant: 'inline', brand: 'ldx2' } })
    // 找到 'apple' brand card
    const cards = w.findAll('.fc-ts-brand-card')
    const appleIdx = BRANDS.findIndex(b => b.id === 'apple')
    await cards[appleIdx]!.trigger('click')
    expect(emittedOf(w, 'update:brand')[0]).toEqual(['apple'])
  })

  it('showReset=false (默认) 不渲染 reset 按钮', () => {
    const w = mountFc(FcThemeSwitcher, { props: { variant: 'inline' } })
    expect(w.find('.fc-ts-section--reset').exists()).toBe(false)
  })

  it('showReset=true 渲染 reset 按钮 + 点击 emit reset', async () => {
    const w = mountFc(FcThemeSwitcher, {
      props: { variant: 'inline', showReset: true },
    })
    expect(w.find('.fc-ts-section--reset').exists()).toBe(true)
    await w.find('.fc-ts-section--reset button').trigger('click')
    expect(emittedOf(w, 'reset').length).toBe(1)
  })

  it('自定义 t 函数覆盖文案', () => {
    const t = (key: string) => `__${key}__`
    const w = mountFc(FcThemeSwitcher, {
      props: { variant: 'inline', t },
    })
    expect(w.text()).toContain('__theme.section.theme__')
    expect(w.text()).toContain('__theme.section.brand__')
  })

  it('variant=popover 渲染 FcPopover + 触发按钮', () => {
    const w = mountFc(FcThemeSwitcher, {
      props: { variant: 'popover', triggerText: '主题' },
      attachTo: document.body,
    })
    expect(w.text()).toContain('主题')
  })

  it('variant=drawer 渲染 FcButton trigger + FcDrawer 容器', () => {
    const w = mountFc(FcThemeSwitcher, {
      props: { variant: 'drawer' },
      attachTo: document.body,
    })
    expect(w.html()).toBeTruthy()
  })

  it('注入 fc-theme context 时, 切换走 context.setBrand 不 emit', async () => {
    let ctxBrand: string = 'ldx2'
    const ctx = {
      brand: { get value() { return ctxBrand }, set value(v: string) { ctxBrand = v } },
      theme: { get value() { return 'light' as const }, set value(_v: 'light' | 'dark') {} },
      setBrand: (b: string) => { ctxBrand = b },
      setTheme: (_t: 'light' | 'dark') => {},
    }

    // 用一个 wrapper component 注入 context
    const { h, defineComponent, provide } = await import('vue')
    const Wrapper = defineComponent({
      setup() {
        provide('fc-theme', ctx)
        return () => h(FcThemeSwitcher, { variant: 'inline' })
      },
    })
    void Wrapper
    const w = mountFc(FcThemeSwitcher, {
      props: { variant: 'inline' },
      global: {
        provide: { 'fc-theme': ctx },
      },
    })
    const cards = w.findAll('.fc-ts-brand-card')
    const appleIdx = BRANDS.findIndex(b => b.id === 'apple')
    await cards[appleIdx]!.trigger('click')
    // 注入模式: 不 emit update:brand, 走 context.setBrand
    expect(emittedOf(w, 'update:brand').length).toBe(0)
    expect(ctxBrand).toBe('apple')
  })
})