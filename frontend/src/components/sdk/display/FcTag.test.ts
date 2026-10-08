import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcTag from './FcTag.vue'

describe('FcTag', () => {
  it('渲染 fc-tag + 默认 color/size', () => {
    const w = mountFc(FcTag, { slots: { default: '标签' } })
    const el = w.find('.fc-tag')
    expect(el.exists()).toBe(true)
    expect(el.classes()).toContain('color-primary')
    expect(el.classes()).toContain('size-sm')
    expect(w.text()).toBe('标签')
  })

  it('color=danger + solid 输出 color-danger.is-solid', () => {
    const w = mountFc(FcTag, { props: { color: 'danger', solid: true } })
    expect(w.find('.fc-tag.color-danger.is-solid').exists()).toBe(true)
  })

  it('closable 时显示 fc-tag__close 按钮', () => {
    const w = mountFc(FcTag, { props: { closable: true }, slots: { default: 'x' } })
    expect(w.find('.fc-tag__close').exists()).toBe(true)
  })

  it('非 closable 时不显示 close 按钮', () => {
    const w = mountFc(FcTag, { slots: { default: 'x' } })
    expect(w.find('.fc-tag__close').exists()).toBe(false)
  })

  it('点击 tag 触发 click 事件', async () => {
    const w = mountFc(FcTag, { slots: { default: 'clickable' } })
    await w.find('.fc-tag').trigger('click')
    expect(emittedOf(w, 'click').length).toBe(1)
  })

  it('disabled 时不响应 click', async () => {
    const w = mountFc(FcTag, { props: { disabled: true } })
    await w.find('.fc-tag').trigger('click')
    expect(emittedOf(w, 'click').length).toBe(0)
  })

  it('点 close 按钮 → close 事件 + 不冒泡 click', async () => {
    const w = mountFc(FcTag, { props: { closable: true } })
    await w.find('.fc-tag__close').trigger('click')
    expect(emittedOf(w, 'close').length).toBe(1)
    expect(emittedOf(w, 'click').length).toBe(0)
  })

  it('selected 加 is-selected class', () => {
    const w = mountFc(FcTag, { props: { selected: true } })
    expect(w.find('.fc-tag.is-selected').exists()).toBe(true)
  })
})
