import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcEmpty from './FcEmpty.vue'

describe('FcEmpty', () => {
  it('默认 type=empty 渲染 fc-empty + 默认 title', () => {
    const w = mountFc(FcEmpty)
    expect(w.find('.fc-empty').exists()).toBe(true)
    expect(w.find('.fc-empty.type-empty').exists()).toBe(true)
    expect(w.find('.fc-empty__title').exists()).toBe(true)
  })

  it('5 种 type 各自渲染对应 svg 图标', () => {
    const types = ['empty', 'error', 'search', 'no-result', 'processing'] as const
    for (const t of types) {
      const w = mountFc(FcEmpty, { props: { type: t } })
      expect(w.find(`.fc-empty.type-${t}`).exists()).toBe(true)
      expect(w.find('.fc-empty__icon svg').exists()).toBe(true)
    }
  })

  it('spinning=true 时加 is-spinning class (非 processing 也可)', () => {
    const w = mountFc(FcEmpty, { props: { type: 'empty', spinning: true } })
    expect(w.find('.fc-empty.is-spinning').exists()).toBe(true)
  })

  it('type=processing 默认 spinning=true', () => {
    const w = mountFc(FcEmpty, { props: { type: 'processing' } })
    expect(w.find('.fc-empty.is-spinning').exists()).toBe(true)
  })

  it('title prop 覆盖默认 i18n 文案', () => {
    const w = mountFc(FcEmpty, { props: { title: '暂无数据' } })
    expect(w.find('.fc-empty__title').text()).toBe('暂无数据')
  })

  it('description 渲染到 fc-empty__desc', () => {
    const w = mountFc(FcEmpty, { props: { description: '请稍后再试' } })
    expect(w.find('.fc-empty__desc').exists()).toBe(true)
    expect(w.find('.fc-empty__desc').text()).toBe('请稍后再试')
  })

  it('default slot 覆盖 title', () => {
    const w = mountFc(FcEmpty, { slots: { default: '自定义文案' } })
    expect(w.find('.fc-empty__title').text()).toBe('自定义文案')
  })

  it('icon slot 覆盖默认图标', () => {
    const w = mountFc(FcEmpty, {
      slots: { icon: '<i class="ri-image-line" />' },
    })
    expect(w.find('.fc-empty__icon i.ri-image-line').exists()).toBe(true)
  })

  it('action slot 渲染到 fc-empty__action', () => {
    const w = mountFc(FcEmpty, {
      slots: { action: '<button class="custom-action">重试</button>' },
    })
    expect(w.find('.fc-empty__action button.custom-action').exists()).toBe(true)
    expect(w.find('.fc-empty__action').text()).toBe('重试')
  })

  it('spanFull=false 时不加 is-span-full class', () => {
    const w = mountFc(FcEmpty, { props: { spanFull: false } })
    expect(w.find('.fc-empty.is-span-full').exists()).toBe(false)
  })
})