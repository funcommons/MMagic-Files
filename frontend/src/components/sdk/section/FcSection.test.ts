import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcSection from './FcSection.vue'

describe('FcSection', () => {
  it('默认 padding=inherit + shadow=md + 不 hoverable', () => {
    const w = mountFc(FcSection, { slots: { default: 'body' } })
    const root = w.find('.fc-section')
    expect(root.exists()).toBe(true)
    expect(root.classes()).toContain('padding-inherit')
    expect(root.classes()).toContain('shadow-md')
    expect(root.classes()).not.toContain('is-hoverable')
  })

  it('padding=lg → class', () => {
    const w = mountFc(FcSection, { props: { padding: 'lg' } })
    expect(w.find('.fc-section.padding-lg').exists()).toBe(true)
  })

  it('shadow=none 移除阴影', () => {
    const w = mountFc(FcSection, { props: { shadow: 'none' } })
    expect(w.find('.fc-section.shadow-none').exists()).toBe(true)
  })

  it('hover=true → is-hoverable class', () => {
    const w = mountFc(FcSection, { props: { hover: true } })
    expect(w.find('.fc-section.is-hoverable').exists()).toBe(true)
  })

  it('header slot 渲染到 fc-section__header', () => {
    const w = mountFc(FcSection, {
      slots: { header: '<h1>title</h1>', default: 'body' },
    })
    expect(w.find('.fc-section__header h1').text()).toBe('title')
    expect(w.find('.fc-section__body').text()).toBe('body')
  })

  it('noHeaderBorder=true → header 加 fc-section__header--flush', () => {
    const w = mountFc(FcSection, {
      props: { noHeaderBorder: true },
      slots: { header: 'h', default: 'b' },
    })
    expect(w.find('.fc-section__header--flush').exists()).toBe(true)
  })

  it('默认 slot 渲染到 fc-section__body', () => {
    const w = mountFc(FcSection, { slots: { default: 'CONTENT' } })
    expect(w.find('.fc-section__body').text()).toBe('CONTENT')
  })
})