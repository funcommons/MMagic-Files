import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcFilterButton from './FcFilterButton.vue'

describe('FcFilterButton', () => {
  it('渲染 fc-filter-btn + 默认 slot', () => {
    const w = mountFc(FcFilterButton, { slots: { default: '全部' } })
    expect(w.find('.fc-filter-btn').exists()).toBe(true)
    expect(w.text()).toBe('全部')
  })

  it('active=true 加 is-active class', () => {
    const w = mountFc(FcFilterButton, { props: { active: true } })
    expect(w.find('.fc-filter-btn.is-active').exists()).toBe(true)
  })

  it('点击 → click 事件', async () => {
    const w = mountFc(FcFilterButton)
    await w.find('.fc-filter-btn').trigger('click')
    expect(emittedOf(w, 'click').length).toBe(1)
  })

  it('disabled 时不 emit click', async () => {
    const w = mountFc(FcFilterButton, { props: { disabled: true } })
    await w.find('.fc-filter-btn').trigger('click')
    expect(emittedOf(w, 'click').length).toBe(0)
  })

  it('badge slot 渲染到 fc-filter-btn__count 内', () => {
    const w = mountFc(FcFilterButton, {
      slots: { default: '热', badge: '<span>9</span>' },
    })
    const badge = w.find('.fc-filter-btn__count')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('9')
  })
})
