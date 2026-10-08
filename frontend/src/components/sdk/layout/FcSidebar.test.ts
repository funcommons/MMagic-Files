import { describe, it, expect } from 'vitest'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcSidebar from './FcSidebar.vue'

describe('FcSidebar', () => {
  it('渲染 aside.fc-sidebar + 默认宽度 240px', () => {
    const w = mountFc(FcSidebar)
    const root = w.find('.fc-sidebar')
    expect(root.exists()).toBe(true)
    const style = root.attributes('style') ?? ''
    expect(style).toContain('width: 240px')
  })

  it('width prop 透传到 inline style', () => {
    const w = mountFc(FcSidebar, { props: { width: 300 } })
    expect(w.find('.fc-sidebar').attributes('style')).toContain('width: 300px')
  })

  it('collapsed=true → is-collapsed class + collapsedWidth', () => {
    const w = mountFc(FcSidebar, { props: { collapsed: true } })
    expect(w.find('.fc-sidebar.is-collapsed').exists()).toBe(true)
    expect(w.find('.fc-sidebar').attributes('style')).toContain('width: 64px')
  })

  it('collapsedWidth prop 生效', () => {
    const w = mountFc(FcSidebar, { props: { collapsed: true, collapsedWidth: 80 } })
    expect(w.find('.fc-sidebar').attributes('style')).toContain('width: 80px')
  })

  it('defaultCollapsed=true (非受控) mount 时折叠', () => {
    const w = mountFc(FcSidebar, { props: { defaultCollapsed: true } })
    expect(w.find('.fc-sidebar.is-collapsed').exists()).toBe(true)
  })

  it('forceCollapsed=true 覆盖内部 collapsed 状态', () => {
    const w = mountFc(FcSidebar, {
      props: { collapsed: false, forceCollapsed: true },
    })
    expect(w.find('.fc-sidebar.is-collapsed').exists()).toBe(true)
    expect(w.find('.fc-sidebar').attributes('style')).toContain('width: 64px')
  })

  it('受控模式: 外部 collapsed 变 false → 同步到内部 (is-collapsed 移除)', async () => {
    const w = mountFc(FcSidebar, { props: { collapsed: true } })
    await w.setProps({ collapsed: false })
    expect(w.find('.fc-sidebar.is-collapsed').exists()).toBe(false)
  })

  it('受控模式: 外部 props.collapsed 变化 → emit update:collapsed (host 写 store 用)', async () => {
    // 注意: emit 只在 toggle() 内部触发, 外部 setProps 不应触发
    const w = mountFc(FcSidebar, { props: { collapsed: false } })
    await w.setProps({ collapsed: true })
    expect(emittedOf(w, 'update:collapsed').length).toBe(0)
  })

  it('点 toggle 按钮 → emit update:collapsed(true)', async () => {
    const w = mountFc(FcSidebar, { props: { collapsed: false } })
    await w.find('.fc-sidebar__toggle').trigger('click')
    expect(emittedOf(w, 'update:collapsed')[0]).toEqual([true])
  })

  it('forceCollapsed=true 时 toggle 按钮不渲染 (强制折叠不可切换)', () => {
    const w = mountFc(FcSidebar, {
      props: { collapsed: false, forceCollapsed: true },
    })
    // toggle 按钮在 forceCollapsed=true 时 v-if 关闭
    expect(w.find('.fc-sidebar__toggle').exists()).toBe(false)
    // 仍然折叠
    expect(w.find('.fc-sidebar.is-collapsed').exists()).toBe(true)
  })

  it('enableDrag=false 时不渲染 resize 手柄', () => {
    const w = mountFc(FcSidebar, { props: { enableDrag: false } })
    expect(w.find('.fc-sidebar__resize').exists()).toBe(false)
  })

  it('enableDrag=true (默认) + 非折叠渲染 resize 手柄', () => {
    const w = mountFc(FcSidebar, { props: { enableDrag: true, collapsed: false } })
    expect(w.find('.fc-sidebar__resize').exists()).toBe(true)
  })

  it('折叠态不渲染 resize 手柄', () => {
    const w = mountFc(FcSidebar, { props: { enableDrag: true, collapsed: true } })
    expect(w.find('.fc-sidebar__resize').exists()).toBe(false)
  })

  it('dblclick resize 手柄 → emit reset-width + update:width', async () => {
    const w = mountFc(FcSidebar, { props: { defaultWidth: 240, width: 300 } })
    await w.find('.fc-sidebar__resize').trigger('dblclick')
    expect(emittedOf(w, 'reset-width').length).toBe(1)
    expect(emittedOf(w, 'update:width')[0]).toEqual([240])
  })

  it('header / default / footer slot 渲染', () => {
    const w = mountFc(FcSidebar, {
      slots: {
        header: '<div class="h-x">h</div>',
        default: '<div class="d-x">d</div>',
        footer: '<div class="f-x">f</div>',
      },
    })
    expect(w.find('.h-x').exists()).toBe(true)
    expect(w.find('.fc-sidebar__nav .d-x').exists()).toBe(true)
    expect(w.find('.f-x').exists()).toBe(true)
  })

  it('expose.toggle() 调用 → 翻转 innerCollapsed + emit', async () => {
    const w = mountFc(FcSidebar, { props: { collapsed: false } })
    const vm = w.vm as unknown as { toggle?: () => void }
    vm.toggle?.()
    expect(emittedOf(w, 'update:collapsed')[0]).toEqual([true])
  })
})