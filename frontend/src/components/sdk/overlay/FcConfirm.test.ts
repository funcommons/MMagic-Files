import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcConfirm from './FcConfirm.vue'

const factory = (props: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) =>
  mountFc(FcConfirm, {
    props: { title: '提示', content: '正文', ...props },
    attachTo: document.body,
    ...opts,
  })

async function flushConfirm() {
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('FcConfirm', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('open=true 渲染 FcDialog + content 到 body', async () => {
    factory({ open: true })
    await flushConfirm()
    expect(document.body.querySelector('.fc-confirm-dialog')).toBeTruthy()
    expect(document.body.textContent).toContain('正文')
  })

  it('variant=danger 渲染 warning svg 图标 + 加 .variant-danger', async () => {
    factory({ open: true, variant: 'danger' })
    await flushConfirm()
    expect(document.body.querySelector('.variant-danger')).toBeTruthy()
    expect(document.body.querySelector('.fc-confirm__icon svg')).toBeTruthy()
  })

  it('variant=primary 不显示默认 danger icon', async () => {
    factory({ open: true, variant: 'primary' })
    await flushConfirm()
    // primary 不画 icon (除非 slot 提供)
    expect(document.body.querySelector('.fc-confirm__icon')).toBeFalsy()
  })

  it('confirmText / cancelText 透传按钮文案', async () => {
    factory({ open: true, confirmText: '确认删', cancelText: '取消吧' })
    await flushConfirm()
    expect(document.body.textContent).toContain('确认删')
    expect(document.body.textContent).toContain('取消吧')
  })

  it('点确认按钮 → emit confirm + update:open(false)', async () => {
    const w = factory({ open: true })
    await flushConfirm()
    // FcConfirm 的确认按钮: el-button[type=danger|primary] 在 footer
    const buttons = document.body.querySelectorAll('.el-dialog__footer .el-button')
    // 第一个是 cancel, 第二个是 confirm
    const confirmBtn = buttons[buttons.length - 1] as HTMLElement
    confirmBtn?.click()
    await nextTick()
    expect(emittedOf(w, 'confirm').length).toBe(1)
    expect(emittedOf(w, 'update:open')).toContainEqual([false])
  })

  it('点取消按钮 → emit cancel + update:open(false)', async () => {
    const w = factory({ open: true })
    await flushConfirm()
    const buttons = document.body.querySelectorAll('.el-dialog__footer .el-button')
    const cancelBtn = buttons[0] as HTMLElement
    cancelBtn?.click()
    await nextTick()
    expect(emittedOf(w, 'cancel').length).toBe(1)
    expect(emittedOf(w, 'update:open')).toContainEqual([false])
  })

  it('loading=true 时确认按钮显示 loading', async () => {
    factory({ open: true, loading: true })
    await flushConfirm()
    expect(document.body.querySelector('.el-dialog__footer .el-button.is-loading')).toBeTruthy()
  })

  it('width=500 透传', async () => {
    factory({ open: true, width: 500 })
    await flushConfirm()
    expect(document.body.querySelector('.fc-confirm-dialog')).toBeTruthy()
  })

  it('default slot 覆盖 content prop', async () => {
    factory(
      { open: true, content: 'PROP_TEXT' },
      { slots: { default: '<span class="slot-text">SLOT_TEXT</span>' } },
    )
    await flushConfirm()
    expect(document.body.querySelector('.slot-text')?.textContent).toBe('SLOT_TEXT')
    expect(document.body.textContent).not.toContain('PROP_TEXT')
  })

  it('icon slot 自定义图标', async () => {
    factory(
      { open: true },
      { slots: { icon: '<i class="custom-icon-x" />' } },
    )
    await flushConfirm()
    expect(document.body.querySelector('.fc-confirm__icon i.custom-icon-x')).toBeTruthy()
  })
})