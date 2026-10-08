import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  FcButton,
  FcTag,
  FcEmpty,
  FcIcon,
  FcStatusBadge,
  FcSegmented,
  FcSectionCard,
  FcRadioGroup,
} from '@/components/sdk'

describe('SDK 组件冒烟测试 (mount 不报错 + 渲染 fc- 类)', () => {
  it('FcButton 渲染默认插槽', () => {
    const w = mount(FcButton, { slots: { default: '确定' } })
    expect(w.text()).toContain('确定')
    expect(w.html()).toMatch(/fc-/)
  })

  it('FcTag 渲染 fc-tag', () => {
    const w = mount(FcTag, { slots: { default: '标签' } })
    expect(w.find('.fc-tag').exists()).toBe(true)
    expect(w.text()).toContain('标签')
  })

  it('FcEmpty 渲染 fc-empty', () => {
    const w = mount(FcEmpty, { props: { title: '无数据' } })
    expect(w.find('.fc-empty').exists()).toBe(true)
    expect(w.text()).toContain('无数据')
  })

  it('FcIcon (class 模式) 渲染 remix 图标类', () => {
    const w = mount(FcIcon, { props: { name: 'ri-search-line' } })
    expect(w.find('.fc-icon').exists()).toBe(true)
    expect(w.find('.ri-search-line').exists()).toBe(true)
  })

  it('FcIcon (slot 模式) 渲染 svg 壳', () => {
    const w = mount(FcIcon, { slots: { default: '<svg data-t="x"></svg>' } })
    expect(w.find('.fc-icon--svg').exists()).toBe(true)
    expect(w.find('svg[data-t="x"]').exists()).toBe(true)
  })

  it('FcStatusBadge 渲染 fc-status-badge', () => {
    const w = mount(FcStatusBadge, { props: { label: '在线', tone: 'success' } })
    expect(w.find('.fc-status-badge').exists()).toBe(true)
    expect(w.text()).toContain('在线')
  })

  it('FcSegmented 渲染选项并可选中', async () => {
    const w = mount(FcSegmented, {
      props: {
        modelValue: 'a',
        options: [
          { label: '甲', value: 'a' },
          { label: '乙', value: 'b' },
        ],
      },
    })
    expect(w.find('.fc-segmented').exists()).toBe(true)
    expect(w.text()).toContain('甲')
    expect(w.text()).toContain('乙')
  })

  it('FcSectionCard 渲染默认插槽内容', () => {
    const w = mount(FcSectionCard, { slots: { default: '<p>卡片正文</p>' } })
    expect(w.text()).toContain('卡片正文')
    expect(w.html()).toMatch(/fc-/)
  })
})

describe('FcRadioGroup 分组交互', () => {
  it('options 模式渲染选项 + 点击 emit update:modelValue', async () => {
    const w = mount(FcRadioGroup, {
      props: {
        modelValue: 'a',
        options: [
          { label: '选项A', value: 'a' },
          { label: '选项B', value: 'b' },
        ],
      },
    })
    expect(w.find('.fc-radio-group').exists()).toBe(true)
    expect(w.text()).toContain('选项A')
    expect(w.text()).toContain('选项B')

    // 点击第二个单选项的可点击区域
    const inputs = w.findAll('.fc-radio__input')
    expect(inputs.length).toBe(2)
    await inputs[1]!.trigger('click')

    const emitted = w.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]).toEqual(['b'])
  })

  it('button 变体渲染分段按钮', () => {
    const w = mount(FcRadioGroup, {
      props: {
        modelValue: '7d',
        variant: 'button',
        options: [
          { label: '7天', value: '7d' },
          { label: '30天', value: '30d' },
        ],
      },
    })
    expect(w.findAll('.fc-radio-button').length).toBe(2)
    expect(w.find('.is-checked').text()).toContain('7天')
  })
})
