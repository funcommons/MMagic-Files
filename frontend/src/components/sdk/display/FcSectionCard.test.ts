import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcSectionCard from './FcSectionCard.vue'

describe('FcSectionCard', () => {
  it('默认 padding=md + shadow=sm', () => {
    const w = mountFc(FcSectionCard, { slots: { default: 'x' } })
    const root = w.find('.fc-section')
    expect(root.exists()).toBe(true)
    expect(root.classes()).toContain('padding-md')
    expect(root.classes()).toContain('shadow-sm')
  })

  it('hover=true → is-hoverable', () => {
    const w = mountFc(FcSectionCard, { props: { hover: true }, slots: { default: 'x' } })
    expect(w.find('.fc-section.is-hoverable').exists()).toBe(true)
  })

  it('hover=false (默认) 不加 is-hoverable', () => {
    const w = mountFc(FcSectionCard, { slots: { default: 'x' } })
    expect(w.find('.fc-section.is-hoverable').exists()).toBe(false)
  })

  it('padding=lg / shadow=lg 透传', () => {
    const w = mountFc(FcSectionCard, {
      props: { padding: 'lg', shadow: 'lg' },
      slots: { default: 'x' },
    })
    const root = w.find('.fc-section')
    expect(root.classes()).toContain('padding-lg')
    expect(root.classes()).toContain('shadow-lg')
  })

  it('padding=none 移除 padding', () => {
    const w = mountFc(FcSectionCard, {
      props: { padding: 'none' },
      slots: { default: 'x' },
    })
    expect(w.find('.fc-section.padding-none').exists()).toBe(true)
  })

  it('默认 slot 渲染内容', () => {
    const w = mountFc(FcSectionCard, { slots: { default: 'CARD-CONTENT' } })
    expect(w.find('.fc-section__body').text()).toBe('CARD-CONTENT')
  })
})