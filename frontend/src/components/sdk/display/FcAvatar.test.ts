import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcAvatar from './FcAvatar.vue'

describe('FcAvatar', () => {
  it('有 src 时渲染 img + 不渲染首字母', () => {
    const w = mountFc(FcAvatar, { props: { name: '张三', src: 'https://x.com/a.png' } })
    expect(w.find('.fc-avatar img').exists()).toBe(true)
    expect(w.find('.fc-avatar img').attributes('src')).toBe('https://x.com/a.png')
    expect(w.find('.fc-avatar-char').exists()).toBe(false)
  })

  it('无 src 时显示 name 首字母 (大写)', () => {
    const w = mountFc(FcAvatar, { props: { name: '张三' } })
    expect(w.find('.fc-avatar-char').exists()).toBe(true)
    expect(w.find('.fc-avatar-char').text()).toBe('张')
  })

  it('英文 name → 首字母大写', () => {
    const w = mountFc(FcAvatar, { props: { name: 'alice' } })
    expect(w.find('.fc-avatar-char').text()).toBe('A')
  })

  it('name 为空时显示 ? + 兜底渐变', () => {
    const w = mountFc(FcAvatar, { props: { name: '' } })
    expect(w.find('.fc-avatar-char').text()).toBe('?')
    const style = w.find('.fc-avatar').attributes('style') ?? ''
    expect(style).toContain('linear-gradient')
  })

  it('4 档 size 渲染对应 class', () => {
    for (const size of ['tiny', 'small', 'medium', 'large'] as const) {
      const w = mountFc(FcAvatar, { props: { name: 'x', size } })
      expect(w.find(`.fc-avatar.size-${size}`).exists()).toBe(true)
    }
  })

  it('urlTransform 把 src 转成最终 URL', () => {
    const transform = (src: string, size: string) => `${src}?w=${size}`
    const w = mountFc(FcAvatar, {
      props: { name: 'x', src: 'a.png', size: 'large', urlTransform: transform },
    })
    expect(w.find('img').attributes('src')).toBe('a.png?w=large')
  })

  it('title 属性同步 name', () => {
    const w = mountFc(FcAvatar, { props: { name: '我的头像' } })
    expect(w.find('.fc-avatar').attributes('title')).toBe('我的头像')
  })
})