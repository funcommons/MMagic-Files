import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcSegmented from './FcSegmented.vue'

describe('FcSegmented', () => {
  const opts = [
    { label: '列表', value: 'list' },
    { label: '网格', value: 'grid' },
  ]

  it('options 模式渲染 fc-segmented + fc-segmented__item', () => {
    const w = mountFc(FcSegmented, { props: { modelValue: 'list', options: opts } })
    expect(w.find('.fc-segmented').exists()).toBe(true)
    expect(w.findAll('.fc-segmented__item').length).toBe(2)
  })

  it('激活项加 is-active + aria-checked=true', () => {
    const w = mountFc(FcSegmented, { props: { modelValue: 'list', options: opts } })
    const items = w.findAll('.fc-segmented__item')
    expect(items[0]!.classes()).toContain('is-active')
    expect(items[0]!.attributes('aria-checked')).toBe('true')
    expect(items[1]!.attributes('aria-checked')).toBe('false')
  })

  it('点击未选项 → emit update:modelValue + change', async () => {
    const w = mountFc(FcSegmented, { props: { modelValue: 'list', options: opts } })
    await w.findAll('.fc-segmented__item')[1]!.trigger('click')
    expect(emittedOf(w, 'update:modelValue')[0]).toEqual(['grid'])
    expect(emittedOf(w, 'change')[0]).toEqual(['grid'])
  })

  it('点击已选项不 emit', async () => {
    const w = mountFc(FcSegmented, { props: { modelValue: 'list', options: opts } })
    await w.findAll('.fc-segmented__item')[0]!.trigger('click')
    expect(emittedOf(w, 'update:modelValue').length).toBe(0)
  })

  it('disabled 整体禁用 → 点击不 emit', async () => {
    const w = mountFc(FcSegmented, { props: { modelValue: 'list', options: opts, disabled: true } })
    await w.findAll('.fc-segmented__item')[1]!.trigger('click')
    expect(emittedOf(w, 'update:modelValue').length).toBe(0)
    expect(w.find('.fc-segmented.is-disabled').exists()).toBe(true)
  })

  it('单选项 disabled 时点击不 emit', async () => {
    const w = mountFc(FcSegmented, {
      props: { modelValue: 'list', options: [{ label: 'A', value: 'a', disabled: true }] },
    })
    await w.find('.fc-segmented__item').trigger('click')
    expect(emittedOf(w, 'update:modelValue').length).toBe(0)
  })

  it('icon 渲染 remix 图标', () => {
    const w = mountFc(FcSegmented, {
      props: { modelValue: 'list', options: [{ label: 'A', value: 'a', icon: 'ri-grid-line' }] },
    })
    expect(w.find('i.ri-grid-line').exists()).toBe(true)
  })

  it('block 加 is-block class', () => {
    const w = mountFc(FcSegmented, { props: { options: opts, block: true } })
    expect(w.find('.fc-segmented.is-block').exists()).toBe(true)
  })
})
