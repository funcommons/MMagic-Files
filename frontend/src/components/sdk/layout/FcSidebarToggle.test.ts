import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcSidebarToggle from './FcSidebarToggle.vue'

describe('FcSidebarToggle', () => {
  it('渲染 fc-sidebar-toggle + 默认 placement-header class', () => {
    const w = mountFc(FcSidebarToggle, { props: { collapsed: false } })
    expect(w.find('.fc-sidebar-toggle').exists()).toBe(true)
    expect(w.find('.fc-sidebar-toggle.placement-header').exists()).toBe(true)
  })

  it('collapsed=true → is-collapsed class + aria-label=Expand', () => {
    const w = mountFc(FcSidebarToggle, { props: { collapsed: true } })
    expect(w.find('.fc-sidebar-toggle.is-collapsed').exists()).toBe(true)
    expect(w.find('.fc-sidebar-toggle').attributes('aria-label')).toBe('Expand sidebar')
  })

  it('collapsed=false → aria-label=Collapse', () => {
    const w = mountFc(FcSidebarToggle, { props: { collapsed: false } })
    expect(w.find('.fc-sidebar-toggle').attributes('aria-label')).toBe('Collapse sidebar')
  })

  it('点击 → emit click', async () => {
    const w = mountFc(FcSidebarToggle, { props: { collapsed: false } })
    await w.find('.fc-sidebar-toggle').trigger('click')
    expect(emittedOf(w, 'click').length).toBe(1)
  })

  it('disabled=true → 加 is-disabled + 点击不 emit', async () => {
    const w = mountFc(FcSidebarToggle, { props: { collapsed: false, disabled: true } })
    expect(w.find('.fc-sidebar-toggle.is-disabled').exists()).toBe(true)
    expect(w.find('.fc-sidebar-toggle').attributes('disabled')).toBeDefined()
    await w.find('.fc-sidebar-toggle').trigger('click')
    expect(emittedOf(w, 'click').length).toBe(0)
  })

  it('placement=footer → placement-footer class', () => {
    const w = mountFc(FcSidebarToggle, { props: { collapsed: false, placement: 'footer' } })
    expect(w.find('.fc-sidebar-toggle.placement-footer').exists()).toBe(true)
  })

  it('placement=inline → placement-inline class', () => {
    const w = mountFc(FcSidebarToggle, { props: { collapsed: false, placement: 'inline' } })
    expect(w.find('.fc-sidebar-toggle.placement-inline').exists()).toBe(true)
  })

  it('渲染 el-icon (Fold/Expand 切换)', () => {
    const w1 = mountFc(FcSidebarToggle, { props: { collapsed: false } })
    const w2 = mountFc(FcSidebarToggle, { props: { collapsed: true } })
    expect(w1.find('.fc-sidebar-toggle__icon').exists()).toBe(true)
    expect(w2.find('.fc-sidebar-toggle__icon').exists()).toBe(true)
  })
})