import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcImage from './FcImage.vue'

describe('FcImage', () => {
  it('无 src 时显示 placeholder slot', () => {
    const w = mountFc(FcImage)
    expect(w.find('.fc-image__placeholder').exists()).toBe(true)
  })

  it('有 src 时渲染 img 标签', () => {
    const w = mountFc(FcImage, { props: { src: 'a.png', alt: 'alt-text' } })
    const img = w.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('a.png')
    expect(img.attributes('alt')).toBe('alt-text')
    expect(img.attributes('loading')).toBe('lazy')
  })

  it('lazy=false 时关闭懒加载', () => {
    const w = mountFc(FcImage, { props: { src: 'a.png', lazy: false } })
    expect(w.find('img').attributes('loading')).toBe('eager')
  })

  it('shape=circle 加 shape-circle class', () => {
    const w = mountFc(FcImage, { props: { shape: 'circle' } })
    expect(w.find('.fc-image.shape-circle').exists()).toBe(true)
  })

  it('ratio 推导出 aspectRatio 行内样式', () => {
    const w = mountFc(FcImage, { props: { ratio: '16/9' } })
    const style = w.find('.fc-image').attributes('style') ?? ''
    expect(style).toContain('aspect-ratio: 16/9')
  })

  it('src 加载成功 → status=loaded + emit load', async () => {
    const w = mountFc(FcImage, { props: { src: 'a.png' } })
    await w.find('img').trigger('load')
    await nextTick()
    expect(w.find('.fc-image').classes()).toContain('status-loaded')
    expect(emittedOf(w, 'load').length).toBe(1)
  })

  it('src 加载失败 → status=error + emit error + 显示 fallback', async () => {
    const w = mountFc(FcImage, { props: { src: 'bad.png', fallback: 'ok.png' } })
    await w.find('img').trigger('error')
    await nextTick()
    expect(w.find('.fc-image').classes()).toContain('status-error')
    expect(emittedOf(w, 'error').length).toBe(1)
    // 失败后切到 fallback, 它也是 img
    const imgs = w.findAll('img')
    expect(imgs.some((i) => i.attributes('src') === 'ok.png')).toBe(true)
  })

  it('name 提供时失败后显示首字母', async () => {
    const w = mountFc(FcImage, { props: { src: 'bad.png', name: 'Alice' } })
    await w.find('img').trigger('error')
    await nextTick()
    const initial = w.find('.fc-image__initial')
    expect(initial.exists()).toBe(true)
    expect(initial.text()).toBe('A')
  })

  it('previewSrcList 时加 is-previewable class', () => {
    const w = mountFc(FcImage, {
      props: { src: 'a.png', previewSrcList: ['a.png', 'b.png'] },
    })
    expect(w.find('.fc-image.is-previewable').exists()).toBe(true)
  })
})
