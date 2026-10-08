import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcSkeleton from './FcSkeleton.vue'

describe('FcSkeleton', () => {
  it('默认 variant=text + rows=1 渲染 fc-skeleton + 单条 line', () => {
    const w = mountFc(FcSkeleton)
    expect(w.find('.fc-skeleton.variant-text').exists()).toBe(true)
    expect(w.findAll('.fc-skeleton__line').length).toBe(1)
  })

  it('text 模式 rows=3 → 3 条 line (最后一条加 is-last)', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'text', rows: 3 } })
    const lines = w.findAll('.fc-skeleton__line')
    expect(lines.length).toBe(3)
    expect(lines[2]!.classes()).toContain('is-last')
  })

  it('rect 模式 width/height 渲染到 shape style', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'rect', width: 200, height: 60 } })
    const shape = w.find('.fc-skeleton__shape')
    const style = shape.attributes('style') ?? ''
    expect(style).toContain('width: 200px')
    expect(style).toContain('height: 60px')
  })

  it('avatar 模式 size=48 输出 48x48 + 50% borderRadius', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'avatar', size: 48 } })
    const shape = w.find('.fc-skeleton__shape')
    const style = shape.attributes('style') ?? ''
    expect(style).toContain('width: 48px')
    expect(style).toContain('height: 48px')
    expect(style).toContain('border-radius: 50%')
  })

  it('card 模式 width 默认 100%', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'card' } })
    const style = w.find('.fc-skeleton__shape').attributes('style') ?? ''
    expect(style).toContain('width: 100%')
  })

  it('card 模式 height 默认回退 120px (未显式传时)', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'card' } })
    const style = w.find('.fc-skeleton__shape').attributes('style') ?? ''
    expect(style).toContain('height: 120px')
  })

  it('rect 模式 height 默认回退 32px (未显式传时)', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'rect' } })
    const style = w.find('.fc-skeleton__shape').attributes('style') ?? ''
    expect(style).toContain('height: 32px')
  })

  it('card 模式显式传 height 生效', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'card', height: 200 } })
    const style = w.find('.fc-skeleton__shape').attributes('style') ?? ''
    expect(style).toContain('height: 200px')
  })

  it('animated=false 时不加 is-animated class', () => {
    const w = mountFc(FcSkeleton, { props: { animated: false } })
    expect(w.find('.fc-skeleton.is-animated').exists()).toBe(false)
  })

  it('animated=true (默认) → 加 is-animated', () => {
    const w = mountFc(FcSkeleton)
    expect(w.find('.fc-skeleton.is-animated').exists()).toBe(true)
  })

  it('radius 自定义覆盖默认', () => {
    const w = mountFc(FcSkeleton, { props: { variant: 'rect', radius: 0 } })
    const style = w.find('.fc-skeleton__shape').attributes('style') ?? ''
    expect(style).toContain('border-radius: 0px')
  })

  it('role=status + aria-busy=true (a11y)', () => {
    const w = mountFc(FcSkeleton)
    expect(w.find('.fc-skeleton').attributes('role')).toBe('status')
    expect(w.find('.fc-skeleton').attributes('aria-busy')).toBe('true')
  })
})