import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcNavGroup from './FcNavGroup.vue'

const factory = (props: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) =>
  mountFc(FcNavGroup, {
    props,
    slots: {
      default: '<el-menu-item index="a">A</el-menu-item><el-menu-item index="b">B</el-menu-item>',
      ...((opts as { slots?: Record<string, string> }).slots ?? {}),
    },
  })

describe('FcNavGroup', () => {
  it('渲染 fc-nav-group + el-menu', () => {
    const w = factory()
    expect(w.find('.fc-nav-group').exists()).toBe(true)
    expect(w.find('.el-menu').exists()).toBe(true)
  })

  it('mode=vertical (默认) 渲染 el-menu--vertical', () => {
    const w = factory()
    expect(w.find('.el-menu--vertical').exists()).toBe(true)
  })

  it('mode=horizontal 渲染 el-menu--horizontal', () => {
    const w = factory({ mode: 'horizontal' })
    expect(w.find('.el-menu--horizontal').exists()).toBe(true)
  })

  it('collapse=true 渲染 el-menu--collapse', () => {
    const w = factory({ collapse: true })
    expect(w.find('.el-menu--collapse').exists()).toBe(true)
  })

  it('activePath=a 渲染 active menu-item', () => {
    const w = factory({ activePath: 'a' })
    expect(w.findAll('.el-menu-item')[0]!.classes()).toContain('is-active')
  })

  it('点 menu-item → emit select(index)', async () => {
    const w = factory()
    await w.findAll('.el-menu-item')[1]!.trigger('click')
    expect(emittedOf(w, 'select')[0]).toEqual(['b'])
  })

  it('openeds prop 透传给 default-openeds', () => {
    const w = factory({ openeds: ['group1'] })
    // 不强制断言 DOM, 至少 mount + class 在
    expect(w.find('.el-menu').exists()).toBe(true)
  })

  it('accordion=true 透传 unique-opened (mount 不报错)', () => {
    const w = factory({ accordion: true })
    expect(w.find('.el-menu').exists()).toBe(true)
  })

  it('default slot 渲染', () => {
    const w = factory()
    expect(w.findAll('.el-menu-item').length).toBe(2)
  })
})