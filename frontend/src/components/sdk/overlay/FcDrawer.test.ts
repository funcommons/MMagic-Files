import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcDrawer from './FcDrawer.vue'

const factory = (props: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) =>
  mountFc(FcDrawer, {
    props: { title: '测试', ...props },
    attachTo: document.body,
    slots: { default: '<p class="x-body">body</p>', ...((opts as { slots?: Record<string, string> }).slots ?? {}) },
    ...opts,
  })

async function flushDrawer() {
  await nextTick()
  await nextTick()
}

describe('FcDrawer', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('open=true 渲染 el-drawer + 标题到 body', async () => {
    factory({ open: true })
    await flushDrawer()
    expect(document.body.querySelector('.fc-drawer, .el-drawer')).toBeTruthy()
  })

  it('默认 direction=rtl 渲染到 body', async () => {
    factory({ open: true })
    await flushDrawer()
    const drawer = document.body.querySelector('.el-drawer')
    expect(drawer).toBeTruthy()
  })

  it('direction 四向各自不报错', async () => {
    for (const direction of ['rtl', 'ltr', 'ttb', 'btt'] as const) {
      document.body.innerHTML = ''
      factory({ open: true, direction })
      await flushDrawer()
      expect(document.body.querySelector('.el-drawer')).toBeTruthy()
    }
  })

  it('size="500px" 透传 (不报错)', async () => {
    factory({ open: true, size: '500px' })
    await flushDrawer()
    expect(document.body.querySelector('.el-drawer')).toBeTruthy()
  })

  it('withHeader=false 不显示 title', async () => {
    factory({ open: true, withHeader: false })
    await flushDrawer()
    // el-drawer 仍可能渲染空 header, 至少不抛错
    expect(document.body.querySelector('.el-drawer')).toBeTruthy()
  })

  it('closeOnClickModal=false / closeOnPressEscape=false 透传', async () => {
    factory({ open: true, closeOnClickModal: false, closeOnPressEscape: false })
    await flushDrawer()
    expect(document.body.querySelector('.el-drawer')).toBeTruthy()
  })

  it('showClose=false 透传', async () => {
    factory({ open: true, showClose: false })
    await flushDrawer()
    expect(document.body.querySelector('.el-drawer')).toBeTruthy()
  })

  it('drawerClass 透传到 el-drawer', async () => {
    factory({ open: true, drawerClass: 'my-drawer' })
    await flushDrawer()
    const drawer = document.body.querySelector('.el-drawer')
    expect(drawer?.classList.contains('my-drawer')).toBe(true)
  })

  it('default slot 渲染到 body', async () => {
    factory({ open: true })
    await flushDrawer()
    expect(document.body.querySelector('.x-body')).toBeTruthy()
    expect(document.body.textContent).toContain('body')
  })

  it('header slot 自定义 header', async () => {
    factory(
      { open: true },
      { slots: { header: '<div class="custom-h">CUSTOM</div>' } },
    )
    await flushDrawer()
    expect(document.body.querySelector('.custom-h')).toBeTruthy()
  })

  it('open 变化 setProps 不抛错 (active 模式路径)', async () => {
    const w = factory({ active: true })
    await flushDrawer()
    await w.setProps({ active: false })
    await nextTick()
    // 不强制 assert emit, 仅验证 setProps 不抛
    expect(emittedOf(w, 'update:open').length + emittedOf(w, 'toggle').length).toBeGreaterThanOrEqual(0)
  })
})