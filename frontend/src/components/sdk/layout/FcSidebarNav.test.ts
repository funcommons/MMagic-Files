import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcSidebarNav from './FcSidebarNav.vue'

const items = [
  { index: '/home', label: 'Home' },
  { index: '/create', label: 'Create' },
  {
    type: 'group' as const,
    index: 'sub1',
    label: 'Group',
    children: [
      { index: '/sub/a', label: 'A' },
      { index: '/sub/b', label: 'B' },
    ],
  },
  { index: '/hidden', label: 'Hidden', visible: false },
]

describe('FcSidebarNav', () => {
  it('渲染 el-menu + 叶子项渲染', () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never },
    })
    expect(w.find('.el-menu').exists()).toBe(true)
    // 隐藏项不渲染: home + create + group 下 2 个 leaf = 4 个 el-menu-item (jsdom 把 sub-menu 内 leaf 也作为 el-menu-item 算)
    expect(w.findAll('.el-menu-item').length).toBe(4)
  })

  it('group 子项渲染为 sub-menu', () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never },
    })
    expect(w.find('.el-sub-menu').exists()).toBe(true)
  })

  it('visible=false 项不渲染 (Hidden label 不在 DOM)', () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never },
    })
    const html = w.html()
    expect(html).not.toContain('Hidden')
    expect(html).not.toContain('/hidden')
  })

  it('activePath 透传给 FcNavGroup (mount 不报错)', () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never, activePath: '/create' },
    })
    expect(w.find('.el-menu').exists()).toBe(true)
  })

  it('点击 leaf → emit select(index)', async () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never },
    })
    const menuItem = w.findAll('.el-menu-item')[0]!
    await menuItem.trigger('click')
    expect(emittedOf(w, 'select').length).toBe(1)
    expect(emittedOf(w, 'select')[0]?.[0]).toBe('/home')
  })

  it('collapse=true → mount 不报错 (子项折叠时数量减少)', () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never, collapse: true },
    })
    expect(w.find('.el-menu').exists()).toBe(true)
    // 折叠时 group 子项被 tooltip 包, el-menu-item 只算顶层 (home, create)
    expect(w.findAll('.el-menu-item').length).toBe(2)
  })

  it('defaultOpeneds 透传给 FcNavGroup', () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never, defaultOpeneds: ['sub1'] },
    })
    expect(w.find('.el-menu').exists()).toBe(true)
  })

  it('accordion=true (默认) + group 渲染正常', () => {
    const w = mountFc(FcSidebarNav, {
      props: { items: items as never },
    })
    expect(w.find('.el-menu').exists()).toBe(true)
  })

  it('空 items 列表不抛错', () => {
    const w = mountFc(FcSidebarNav, { props: { items: [] } })
    expect(w.find('.el-menu').exists()).toBe(true)
    expect(w.findAll('.el-menu-item').length).toBe(0)
  })
})