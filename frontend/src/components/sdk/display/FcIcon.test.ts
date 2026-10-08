import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcIcon from './FcIcon.vue'

describe('FcIcon', () => {
  it('class 模式: 渲染 <i class="fc-icon ri-search-line">', () => {
    const w = mountFc(FcIcon, { props: { name: 'ri-search-line' } })
    const el = w.find('i.fc-icon')
    expect(el.exists()).toBe(true)
    expect(el.classes()).toContain('ri-search-line')
  })

  it('size=18 → fontSize: 18px', () => {
    const w = mountFc(FcIcon, { props: { name: 'ri-add-line', size: 18 } })
    const style = w.find('i.fc-icon').attributes('style') ?? ''
    expect(style).toContain('font-size: 18px')
  })

  it('size="2em" 字符串原样输出', () => {
    const w = mountFc(FcIcon, { props: { name: 'ri-x', size: '2em' } })
    const style = w.find('i.fc-icon').attributes('style') ?? ''
    expect(style).toContain('font-size: 2em')
  })

  it('color prop 输出到 inline style', () => {
    const w = mountFc(FcIcon, { props: { name: 'ri-x', color: 'red' } })
    const style = w.find('i.fc-icon').attributes('style') ?? ''
    expect(style).toContain('color: red')
  })

  it('spin=true → 加 fc-icon--spin class', () => {
    const w = mountFc(FcIcon, { props: { name: 'ri-loader', spin: true } })
    expect(w.find('i.fc-icon.fc-icon--spin').exists()).toBe(true)
  })

  it('slot 模式: 不传 name 时渲染 <span class="fc-icon fc-icon--svg"> 包 slot', () => {
    const w = mountFc(FcIcon, {
      slots: { default: '<svg class="my-svg" />' },
    })
    expect(w.find('span.fc-icon.fc-icon--svg').exists()).toBe(true)
    expect(w.find('span.fc-icon svg.my-svg').exists()).toBe(true)
  })

  it('slot 模式 + spin → span 加 fc-icon--spin', () => {
    const w = mountFc(FcIcon, {
      props: { spin: true },
      slots: { default: '<svg />' },
    })
    expect(w.find('span.fc-icon.fc-icon--spin').exists()).toBe(true)
  })

  it('不传 size 不输出 font-size', () => {
    const w = mountFc(FcIcon, { props: { name: 'ri-x' } })
    const style = w.find('i.fc-icon').attributes('style') ?? ''
    expect(style).not.toContain('font-size')
  })
})