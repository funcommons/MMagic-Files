/**
 * heicViewerRenderer 单测（Lane F6）
 * 契约正本：renderers/heic.ts 头注释——getObject → >32MB 拒转（提示下载，防内存爆）→
 * 动态 import('heic2any') → HEIC Blob 转 JPEG → 复用 image.ts 的 viewerjs 展示路径
 * （mountImageViewer：objectURL→<img>→Viewer）；失败面（getObject/转码/import）→
 * 自捕获错误提示节点（不向调用侧抛出）；dispose=viewer.destroy+revokeObjectURL。
 *
 * 环境：heic2any/viewerjs 均 vi.mock（docx.test.ts 同款 holder 蹦床）；jsdom 无
 * createObjectURL/revokeObjectURL → stub；img 不真实加载 → load/error 手动派发。
 *
 * 覆盖点：
 *  1. 成功——heic2any 以 {blob, toType:'image/jpeg', quality:0.92} 调用；转换产物（非原 HEIC）
 *     走 objectURL→<img>；load 后 Viewer 实例化（navbar:false toolbar:true）
 *  2. 边界——恰好 32MB 不拒转（仅「>32MB」拒绝）
 *  3. >32MB——app.heic-too-large 提示下载；不进动态 import（转码零调用）；不建 objectURL
 *  4. 转换失败（heic2any reject）——app.image-load-fail 提示节点，不抛出
 *  5. getObject 拒绝——提示节点；动态 import 失败——同款降级
 *  6. dispose——viewer.destroy 恰一次 + revokeObjectURL 同一 URL + DOM 还原
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { heicViewerRenderer } from '../heic'
import type { AppCtx, AppInstance } from '../../../sdk/types'

// ───────────────────────── heic2any 动态导入 mock ─────────────────────────
// holder.impl 假实现 → 成功路径；置 undefined + vi.resetModules() → 工厂抛错模拟弱网加载失败
const heicHolder = vi.hoisted(() => ({ impl: undefined as unknown }))
vi.mock('heic2any', () => {
  if (!heicHolder.impl) throw new Error('heic2any unavailable (simulated)')
  return {
    default: (...args: unknown[]) => (heicHolder.impl as (...a: unknown[]) => Promise<unknown>)(...args),
  }
})

// ───────────────────────── 假 Viewer（同 image.test.ts 口径；heic 复用 image.ts 展示路径） ─────────────────────────
const viewerMock = vi.hoisted(() => {
  const instances: FakeViewer[] = []
  class FakeViewer {
    el: HTMLElement
    options: Record<string, unknown> | undefined
    destroyCalls = 0
    constructor(el: HTMLElement, options?: Record<string, unknown>) {
      this.el = el
      this.options = options
      instances.push(this)
    }
    destroy(): FakeViewer {
      this.destroyCalls++
      return this
    }
  }
  return { instances, FakeViewer }
})
vi.mock('viewerjs', () => ({ default: viewerMock.FakeViewer }))

// ───────────────────────── 桩具 ─────────────────────────
const FILE = { key: 'photos/a.heic', name: 'a.heic', size: 12 }
const HEIC_BLOB = new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x18])], { type: 'image/heic' })
const JPEG_BLOB = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' })
const IMAGE_FAIL_KEY = 'app.heic-load-fail' // 专用键（复盘后落地，替代借用 app.image-load-fail）
const DOWNLOAD_KEY = 'app.heic-too-large' // 专用键（复盘后落地，替代借用 files.preview-fallback）

/** fake ctx：getObject 返回注入 Blob；t 加前缀以便断言文案确实走词典 */
function makeCtx(blob: Blob): AppCtx {
  return {
    getObject: vi.fn(async () => blob),
    putObject: vi.fn(async () => undefined),
    t: (key: string) => `T:${key}`,
    notify: vi.fn(),
    theme: {},
  }
}

let createMock: ReturnType<typeof vi.fn<() => string>>
let revokeMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  let seq = 0
  createMock = vi.fn(() => `blob:mock-${++seq}`)
  revokeMock = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createMock, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeMock, configurable: true, writable: true })
  heicHolder.impl = vi.fn(async () => JPEG_BLOB)
  viewerMock.instances.length = 0
})

afterEach(() => {
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  vi.restoreAllMocks()
})

/** 渲染助手：默认成功 ctx；注入自定义 ctx 供失败面用例 */
async function render(el: HTMLElement, ctx: AppCtx = makeCtx(HEIC_BLOB)): Promise<AppInstance> {
  const ret = await heicViewerRenderer(el, FILE, ctx)
  expect(ret && typeof (ret as AppInstance).dispose === 'function').toBe(true)
  return ret as AppInstance
}

describe('heicViewerRenderer 成功路径', () => {
  it('getObject→heic2any(→jpeg)→objectURL(转换产物)→<img>；load 后实例化 Viewer', async () => {
    const ctx = makeCtx(HEIC_BLOB)
    const el = document.createElement('div')
    await render(el, ctx)

    expect(vi.mocked(ctx.getObject).mock.calls[0]?.[0]).toBe('photos/a.heic')
    expect(heicHolder.impl).toHaveBeenCalledWith({ blob: HEIC_BLOB, toType: 'image/jpeg', quality: 0.92 })
    // 走的是转换产物 JPEG（非原 HEIC 字节）——复用 image.ts 展示路径
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith(JPEG_BLOB)
    const img = el.querySelector('img')
    expect(img, 'el 内挂了 <img>').not.toBeNull()
    expect(img!.src).toBe('blob:mock-1')
    expect(img!.alt).toBe('a.heic')
    expect(viewerMock.instances).toHaveLength(0) // 尚未 load

    img!.dispatchEvent(new Event('load'))
    expect(viewerMock.instances).toHaveLength(1)
    expect(viewerMock.instances[0]!.el).toBe(img!.parentElement)
    expect(viewerMock.instances[0]!.options).toEqual({ navbar: false, toolbar: true })
  })

  it('边界：恰好 32MB 不拒转（仅「>32MB」拒绝），仍走转码链路', async () => {
    const exact = new Blob([new ArrayBuffer(32 * 1024 * 1024)])
    const el = document.createElement('div')
    await render(el, makeCtx(exact))

    expect(heicHolder.impl).toHaveBeenCalled()
    expect(el.querySelector('img')).not.toBeNull()
  })
})

describe('heicViewerRenderer 失败/拒绝面', () => {
  it('>32MB：提示下载（app.heic-too-large）、不进转码、不建 objectURL；dispose 移除提示', async () => {
    const huge = new Blob([new ArrayBuffer(32 * 1024 * 1024 + 1)])
    const el = document.createElement('div')
    const ret = await render(el, makeCtx(huge))

    expect(el.textContent).toBe(`T:${DOWNLOAD_KEY}`)
    expect(heicHolder.impl).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
    ;(ret as AppInstance).dispose()
    expect(el.childElementCount).toBe(0)
  })

  it('heic2any reject（坏 HEIC）：app.heic-load-fail 提示节点，不向调用侧抛出', async () => {
    heicHolder.impl = vi.fn(async () => {
      throw new Error('corrupt heic')
    })
    const el = document.createElement('div')
    const ret = await render(el)

    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toBe(`T:${IMAGE_FAIL_KEY}`)
    ;(ret as AppInstance).dispose()
    expect(el.childElementCount).toBe(0)
  })

  it('getObject 拒绝：提示节点，不进转码', async () => {
    const ctx = makeCtx(HEIC_BLOB)
    vi.mocked(ctx.getObject).mockRejectedValueOnce(new Error('sigv4 403'))
    const el = document.createElement('div')
    await render(el, ctx)

    expect(el.textContent).toBe(`T:${IMAGE_FAIL_KEY}`)
    expect(heicHolder.impl).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('动态 import 失败：同款降级为提示节点（不抛出）', async () => {
    heicHolder.impl = undefined
    vi.resetModules()
    const el = document.createElement('div')
    await render(el)

    expect(el.textContent).toBe(`T:${IMAGE_FAIL_KEY}`)
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('heicViewerRenderer dispose', () => {
  it('viewer.destroy 恰一次 + revokeObjectURL 同一 URL + DOM 还原；双重 dispose 幂等', async () => {
    const el = document.createElement('div')
    const inst = await render(el)
    const img = el.querySelector('img')!
    img.dispatchEvent(new Event('load'))
    expect(viewerMock.instances).toHaveLength(1)

    inst.dispose()
    expect(viewerMock.instances[0]!.destroyCalls).toBe(1)
    expect(revokeMock).toHaveBeenCalledTimes(1)
    expect(revokeMock).toHaveBeenCalledWith('blob:mock-1')
    expect(el.childElementCount).toBe(0)

    expect(() => inst.dispose()).not.toThrow()
    expect(viewerMock.instances[0]!.destroyCalls).toBe(1)
    expect(revokeMock).toHaveBeenCalledTimes(1)
  })
})
