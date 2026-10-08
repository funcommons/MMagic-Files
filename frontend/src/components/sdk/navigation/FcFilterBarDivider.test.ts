import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcFilterBarDivider from './FcFilterBarDivider.vue'

describe('FcFilterBarDivider', () => {
  it('渲染 <span class="fc-filter-bar-divider">', () => {
    const w = mountFc(FcFilterBarDivider)
    const el = w.find('.fc-filter-bar-divider')
    expect(el.exists()).toBe(true)
    expect(el.element.tagName).toBe('SPAN')
  })

  it('不是 button (不可聚焦)', () => {
    const w = mountFc(FcFilterBarDivider)
    expect(w.find('button').exists()).toBe(false)
  })

  it('在 FcFilterBar 中渲染', () => {
    const w = mountFc(FcFilterBarDivider)
    expect(w.html()).toContain('fc-filter-bar-divider')
  })
})