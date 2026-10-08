import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcTagGroup from './FcTagGroup.vue'

describe('FcTagGroup', () => {
  it('渲染 fc-tag-group + 初始 tags 各显示一个 FcTag', () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A', 'B'] } })
    expect(w.find('.fc-tag-group').exists()).toBe(true)
    expect(w.findAll('.fc-tag').length).toBe(2)
    expect(w.text()).toContain('A')
    expect(w.text()).toContain('B')
  })

  it('editable=true (默认) 渲染 input', () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A'] } })
    expect(w.find('input.fc-tag-group__input').exists()).toBe(true)
  })

  it('editable=false 不渲染 input', () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A'], editable: false } })
    expect(w.find('input.fc-tag-group__input').exists()).toBe(false)
  })

  it('input Enter → emit update:tags 新增 (去重 + trim)', async () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A'] } })
    const input = w.find('input.fc-tag-group__input')
    await input.setValue('B')
    await input.trigger('keydown.enter')
    expect(emittedOf(w, 'update:tags')[0]).toEqual([['A', 'B']])
  })

  it('重复 tag 不新增', async () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A'] } })
    const input = w.find('input.fc-tag-group__input')
    await input.setValue('A')
    await input.trigger('keydown.enter')
    expect(emittedOf(w, 'update:tags').length).toBe(0)
  })

  it('空白 tag 不新增', async () => {
    const w = mountFc(FcTagGroup, { props: { tags: [] } })
    const input = w.find('input.fc-tag-group__input')
    await input.setValue('   ')
    await input.trigger('keydown.enter')
    expect(emittedOf(w, 'update:tags').length).toBe(0)
  })

  it('input 空时 Backspace → 删除末位 tag', async () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A', 'B'] } })
    const input = w.find('input.fc-tag-group__input')
    await input.trigger('keydown.backspace')
    expect(emittedOf(w, 'update:tags')[0]).toEqual([['A']])
  })

  it('input 有内容时 Backspace 不删 tag', async () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A'] } })
    const input = w.find('input.fc-tag-group__input')
    await input.setValue('xy')
    await input.trigger('keydown.backspace')
    expect(emittedOf(w, 'update:tags').length).toBe(0)
  })

  it('点 FcTag 的 close → emit update:tags 移除', async () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A', 'B'] } })
    await w.find('.fc-tag__close').trigger('click')
    expect(emittedOf(w, 'update:tags')[0]).toEqual([['B']])
  })

  it('color 透传给所有 FcTag', () => {
    const w = mountFc(FcTagGroup, { props: { tags: ['A', 'B'], color: 'danger' } })
    const tags = w.findAll('.fc-tag')
    expect(tags.every(t => t.classes().includes('color-danger'))).toBe(true)
  })
})