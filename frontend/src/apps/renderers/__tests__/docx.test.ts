/**
 * docx 渲染器单测（M2-R5——M4 内容提前）
 * 契约正本：renderers/docx.ts 头注释——getObject→Blob.arrayBuffer→动态 import('docx-preview')
 * →renderAsync(buffer, 容器, undefined, {inWrapper:true})，容器 div.docx-view（白底 padding）；
 * dispose=容器移除；任何一步失败（getObject/读流/import/renderAsync）→错误提示节点（ctx.t），
 * 不向调用侧抛出（R1 mermaid 同款 try/catch 降级口径）。
 *
 * 覆盖点：
 *  1. 成功路径——renderAsync 以 (ArrayBuffer, .docx-view 容器, undefined, {inWrapper:true}) 调用、
 *     容器挂 el、白底 + padding、getObject 以 file.key 调用
 *  2. dispose——容器移除、el 还原、可重复调用
 *  3. renderAsync 拒绝——不抛出、提示节点文案=ctx.t(key)、无 .docx-view、dispose 移除提示
 *  4. getObject 拒绝——同上且不进动态 import（renderAsync 零调用）
 *  5. 动态 import 失败——同上降级（import 必须动态而非顶层，mock 抛错即模拟加载失败）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { docxRenderer } from '../docx'
import type { AppCtx, AppInstance } from '../../../sdk/types'

// ───────────────────────── docx-preview 动态导入 mock ─────────────────────────
// holder.impl 为假实现 → 成功路径（断言 buffer/container/options 实参）；
// 用例间换 spy 靠蹦床（调用时才读 holder，不依赖模块重载）；
// holder.impl 置回 undefined + vi.resetModules() → 工厂抛错 → import 本身拒绝（模拟弱网/加载失败）
const docxHolder = vi.hoisted(() => ({ impl: undefined as unknown }))
vi.mock('docx-preview', () => {
  if (!docxHolder.impl) throw new Error('docx-preview unavailable (simulated)')
  return {
    renderAsync: (...args: unknown[]) =>
      (docxHolder.impl as (...a: unknown[]) => Promise<unknown>)(...args),
  }
})

/** 渲染文件实参 */
const FILE = { key: 'docs/a.docx', name: 'a.docx', size: 2048 }
/** 错误提示 i18n key（键照用，词典待主线补录） */
const FAIL_KEY = 'app.docx-load-fail'

/** 桩 docx 字节流（zip 魔数 PK；renderer 只透传字节，不校验格式） */
const BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02])

/** fake ctx：getObject 可注入成功/拒绝；t 加前缀以便断言文案确实走词典 */
function makeCtx(getObjectImpl: (key: string) => Promise<Blob>): AppCtx {
  return {
    getObject: vi.fn(getObjectImpl),
    putObject: vi.fn(async () => undefined),
    t: (key: string) => `T:${key}`,
    notify: vi.fn(),
    theme: {},
  }
}

const okCtx = () => makeCtx(async () => new Blob([BYTES]))

/** renderAsync 假实现（每个用例独立 spy） */
const renderAsyncSpy = () => vi.fn(async () => undefined)

describe('docxRenderer', () => {
  beforeEach(() => {
    docxHolder.impl = renderAsyncSpy()
  })

  it('成功路径：renderAsync(ArrayBuffer, .docx-view 容器, undefined, {inWrapper:true})；容器白底 padding', async () => {
    const ctx = okCtx()
    const el = document.createElement('div')

    const ret = await docxRenderer(el, FILE, ctx)
    const inst = ret as AppInstance
    expect(typeof inst.dispose).toBe('function')

    expect(vi.mocked(ctx.getObject).mock.calls[0]?.[0]).toBe('docs/a.docx')

    const spy = docxHolder.impl as ReturnType<typeof vi.fn>
    expect(spy).toHaveBeenCalledTimes(1)
    const [buffer, container, styleContainer, options] = spy.mock.calls[0] as unknown as unknown[]
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect((buffer as ArrayBuffer).byteLength).toBe(BYTES.byteLength)
    expect(container).toBeInstanceOf(HTMLDivElement)
    expect((container as HTMLElement).className).toBe('docx-view')
    expect((container as HTMLElement).parentElement).toBe(el)
    expect(styleContainer).toBeUndefined()
    expect(options).toEqual({ inWrapper: true })

    const view = el.querySelector<HTMLDivElement>('.docx-view')
    expect(view, '.docx-view 容器挂在 el 内').not.toBeNull()
    expect(view!.style.background).toContain('255, 255, 255')
    expect(view!.style.padding).not.toBe('')
  })

  it('dispose：.docx-view 容器移除、el 还原；可重复调用（幂等）', async () => {
    const el = document.createElement('div')
    const inst = (await docxRenderer(el, FILE, okCtx())) as AppInstance
    expect(el.querySelector('.docx-view')).not.toBeNull()

    inst.dispose()
    expect(el.childElementCount).toBe(0)
    expect(() => inst.dispose()).not.toThrow()
  })

  it('renderAsync 拒绝：不抛出，提示节点（文案=ctx.t），无 .docx-view；dispose 移除提示', async () => {
    docxHolder.impl = vi.fn(async () => {
      throw new Error('corrupt docx')
    })
    const el = document.createElement('div')

    const ret = await docxRenderer(el, FILE, okCtx())
    expect(ret, '失败面也返回实例').toBeDefined()

    expect(el.querySelector('.docx-view')).toBeNull()
    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe(`T:${FAIL_KEY}`)
    ;(ret as AppInstance).dispose()
    expect(el.childElementCount).toBe(0)
  })

  it('getObject 拒绝：不抛出，提示节点；不进动态 import（renderAsync 零调用）', async () => {
    const el = document.createElement('div')
    const ret = await docxRenderer(
      el,
      FILE,
      makeCtx(async () => {
        throw new Error('sigv4 403')
      }),
    )
    expect(ret).toBeDefined()

    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe(`T:${FAIL_KEY}`)
    expect(docxHolder.impl as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('动态 import 失败：降级为提示节点，不抛出（mermaid 同款 catch 口径）', async () => {
    docxHolder.impl = undefined
    vi.resetModules()
    const el = document.createElement('div')

    const ret = await docxRenderer(el, FILE, okCtx())
    expect(ret).toBeDefined()

    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe(`T:${FAIL_KEY}`)
    expect(el.querySelector('.docx-view')).toBeNull()
  })
})
