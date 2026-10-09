/**
 * PDF 渲染器单测（M2-R2 + Lane F6 二级降级）
 * 契约正本：renderers/pdf.ts 头注释——
 *  原生路径：getObject→Blob→objectURL→<iframe src=blobUrl>（判定 navigator.pdfViewerEnabled
 *  非 false 时走此路；jsdom 无该字段=undefined → 原生路径，既有用例不受降级影响）；
 *  降级路径：pdfViewerEnabled=false → 动态 import pdfjs-dist（worker 经 '?url' 引入）自绘首页 +
 *  上一页/下一页/页码；渲染失败→错误提示节点且不抛出。
 * 环境：jsdom 无 createObjectURL/revokeObjectURL——Object.defineProperty 挂桩，afterEach 还原。
 *
 * 覆盖点：
 *  1. 原生——挂 <iframe> 且 src=桩 blob URL、title=file.name；dispose=revoke+remove；
 *     getObject 拒绝→错误提示节点（文案=ctx.t(key)）
 *  2. 降级（F6）——pdfjs-dist 动态 import（getDocument 收 ArrayBuffer、workerSrc 挂 '?url'）、
 *     首页渲染（viewport→canvas 尺寸）、页码指示、翻页边界、渲染/import 失败降级、dispose=destroy
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pdfRenderer } from '../pdf'
import type { AppCtx, AppInstance } from '../../../sdk/types'

// ───────────────────────── pdfjs-dist 动态导入 mock（docx.test.ts 同款 holder 蹦床） ─────────────────────────
const pdfjsHolder = vi.hoisted(() => {
  const GlobalWorkerOptions = { workerSrc: '' }
  const state = { impl: undefined as { getDocument: (src: unknown) => unknown } | undefined }
  return { GlobalWorkerOptions, state }
})
vi.mock('pdfjs-dist', () => {
  if (!pdfjsHolder.state.impl) throw new Error('pdfjs-dist unavailable (simulated)')
  return {
    getDocument: (src: unknown) => pdfjsHolder.state.impl!.getDocument(src),
    GlobalWorkerOptions: pdfjsHolder.GlobalWorkerOptions,
  }
})
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/mock/pdf.worker.min.mjs' }))

/** 渲染文件实参 */
const FILE = { key: 'docs/b.pdf', name: 'b.pdf', size: 1024 }
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
/** 错误提示 i18n key */
const FAIL_KEY = 'app.pdf-load-fail'

// ───────────────────────── URL blob 存根 ─────────────────────────
let createMock: ReturnType<typeof vi.fn<() => string>>
let revokeMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  let seq = 0
  createMock = vi.fn(() => `blob:mock-${++seq}`)
  revokeMock = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createMock, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeMock, configurable: true, writable: true })
})

afterEach(() => {
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  vi.restoreAllMocks()
})

// ───────────────────────── 桩具 ─────────────────────────
function makeCtx(getObjectImpl: (key: string) => Promise<Blob>): AppCtx {
  return {
    getObject: vi.fn(getObjectImpl),
    putObject: vi.fn(async () => undefined),
    t: (key: string) => `T:${key}`,
    notify: vi.fn(),
    theme: {},
  }
}

describe('pdfRenderer', () => {
  it('挂 <iframe src=blobUrl>（M2 从权：getObject 字节流而非直链）；getObject 以 file.key 调用', async () => {
    const ctx = makeCtx(async () => new Blob([BYTES], { type: 'application/pdf' }))
    const el = document.createElement('div')

    const ret = await pdfRenderer(el, FILE, ctx)
    const inst = ret as AppInstance
    expect(typeof inst.dispose).toBe('function')

    const frame = el.querySelector('iframe')
    expect(frame, 'el 内挂了 iframe 元素').not.toBeNull()
    expect(frame!.getAttribute('src')).toBe('blob:mock-1')
    expect(frame!.getAttribute('src')!.startsWith('blob:'), 'src=objectURL（非 S3 直链）').toBe(true)
    expect(frame!.getAttribute('title')).toBe('b.pdf')
    expect(vi.mocked(ctx.getObject).mock.calls[0]?.[0]).toBe('docs/b.pdf')
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith(expect.any(Blob))
    expect(revokeMock).not.toHaveBeenCalled()
  })

  it('dispose：iframe 移除 + revokeObjectURL 以同一 URL 调用', async () => {
    const el = document.createElement('div')
    const inst = (await pdfRenderer(
      el,
      FILE,
      makeCtx(async () => new Blob([BYTES])),
    )) as AppInstance

    inst.dispose()
    expect(el.querySelector('iframe')).toBeNull()
    expect(el.childElementCount).toBe(0)
    expect(revokeMock).toHaveBeenCalledTimes(1)
    expect(revokeMock).toHaveBeenCalledWith('blob:mock-1')
  })

  it('getObject 拒绝：不抛出，el 内错误提示节点（文案=ctx.t），dispose 移除提示且 revoke 不被调', async () => {
    const el = document.createElement('div')

    const ret = await pdfRenderer(
      el,
      FILE,
      makeCtx(async () => {
        throw new Error('sigv4 403')
      }),
    )
    expect(ret, '失败面也返回实例').toBeDefined()

    expect(el.querySelector('iframe')).toBeNull()
    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe(`T:${FAIL_KEY}`)
    expect(createMock).not.toHaveBeenCalled()
    expect(revokeMock).not.toHaveBeenCalled()

    ;(ret as AppInstance).dispose()
    expect(el.childElementCount).toBe(0)
  })
})

// ───────────────────────── 二级降级（Lane F6：pdfViewerEnabled=false → pdf.js 自绘） ─────────────────────────

/** jsdom 无 pdfViewerEnabled 字段——defineProperty 挂实例属性，afterEach 删除还原（原型无此键） */
function stubPdfViewerEnabled(value: boolean): void {
  Object.defineProperty(window.navigator, 'pdfViewerEnabled', { value, configurable: true })
}

/** 假 pdf.js 文档：getPage(n) 返回 viewport(600n×800) + render 假任务；destroy 记次 */
function makeFakeDoc(numPages: number) {
  const renderSpies = new Map<number, ReturnType<typeof vi.fn>>()
  const getPage = vi.fn(async (n: number) => {
    if (!renderSpies.has(n)) {
      renderSpies.set(
        n,
        vi.fn(() => ({ promise: Promise.resolve() })),
      )
    }
    return {
      getViewport: vi.fn(() => ({ width: 600 * n, height: 800 })),
      render: renderSpies.get(n),
    }
  })
  const destroy = vi.fn(async () => undefined)
  const doc = { numPages, getPage }
  const getDocument = vi.fn((_src: unknown) => ({ promise: Promise.resolve(doc), destroy }))
  return { getDocument, getPage, destroy, renderSpies }
}

/** 微任务冲刷：让翻页异步渲染链跑完 */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('pdfRenderer 二级降级（navigator.pdfViewerEnabled=false）', () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext
  let fakeDoc: ReturnType<typeof makeFakeDoc>

  beforeEach(() => {
    stubPdfViewerEnabled(false)
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof origGetContext
    pdfjsHolder.GlobalWorkerOptions.workerSrc = ''
    fakeDoc = makeFakeDoc(3)
    pdfjsHolder.state.impl = { getDocument: fakeDoc.getDocument }
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext
    delete (window.navigator as unknown as Record<string, unknown>).pdfViewerEnabled
    vi.restoreAllMocks()
  })

  it('pdf.js 路径：动态 import + workerSrc 挂 "?url" 产物；getDocument 收 ArrayBuffer；canvas 自绘首页', async () => {
    const el = document.createElement('div')
    const ctx = makeCtx(async () => new Blob([BYTES], { type: 'application/pdf' }))

    const ret = (await pdfRenderer(el, FILE, ctx)) as AppInstance
    expect(typeof ret.dispose).toBe('function')

    // 无 iframe（不走原生路径）、无 objectURL（pdf.js 直接吃字节）
    expect(el.querySelector('iframe')).toBeNull()
    expect(createMock).not.toHaveBeenCalled()

    expect(pdfjsHolder.GlobalWorkerOptions.workerSrc).toBe('/mock/pdf.worker.min.mjs')
    expect(fakeDoc.getDocument).toHaveBeenCalledTimes(1)
    expect(fakeDoc.getDocument).toHaveBeenCalledWith({ data: expect.any(ArrayBuffer) })

    const canvas = el.querySelector('canvas')
    expect(canvas, 'el 内挂了 canvas').not.toBeNull()
    expect(canvas!.width).toBe(600) // viewport width @scale（首页 n=1）
    expect(canvas!.height).toBe(800)
    expect(fakeDoc.renderSpies.get(1)).toHaveBeenCalled() // 首页渲染执行
  })

  it('页码指示与翻页：初始 1 / 3；next→2；prev→1；边界钳制（首页 prev / 末页 next 不越界）', async () => {
    const el = document.createElement('div')
    const inst = (await pdfRenderer(el, FILE, makeCtx(async () => new Blob([BYTES])))) as AppInstance

    const pageOf = () => el.querySelector('.mmagic-pdfjs-page')!
    const prev = el.querySelector<HTMLButtonElement>('[data-action="prev"]')!
    const next = el.querySelector<HTMLButtonElement>('[data-action="next"]')!
    expect(prev).not.toBeNull()
    expect(next).not.toBeNull()
    // 文案走宿主词典（复用既有 app.csv-prev / app.csv-next「上一页/下一页」键，未新增 locales）
    expect(prev.textContent).toBe('T:app.csv-prev')
    expect(next.textContent).toBe('T:app.csv-next')

    expect(pageOf().textContent).toBe('1 / 3')
    expect(fakeDoc.getPage).toHaveBeenCalledTimes(1)
    expect(fakeDoc.getPage).toHaveBeenLastCalledWith(1)

    next.click()
    await flush()
    expect(pageOf().textContent).toBe('2 / 3')
    expect(fakeDoc.getPage).toHaveBeenLastCalledWith(2)

    prev.click()
    await flush()
    expect(pageOf().textContent).toBe('1 / 3')
    expect(fakeDoc.getPage).toHaveBeenLastCalledWith(1)

    prev.click() // 已在首页：不发起 getPage(0)
    await flush()
    expect(fakeDoc.getPage).toHaveBeenLastCalledWith(1)

    next.click(); next.click(); next.click() // 推到末页 3：再多点不越界
    await flush()
    expect(pageOf().textContent).toBe('3 / 3')
    expect(fakeDoc.getPage).toHaveBeenLastCalledWith(3)

    inst.dispose()
  })

  it('dispose：loadingTask.destroy 收尾 + DOM 移除；双重 dispose 幂等', async () => {
    const el = document.createElement('div')
    const inst = (await pdfRenderer(el, FILE, makeCtx(async () => new Blob([BYTES])))) as AppInstance

    inst.dispose()
    expect(fakeDoc.destroy).toHaveBeenCalledTimes(1)
    expect(el.childElementCount).toBe(0)

    expect(() => inst.dispose()).not.toThrow()
    expect(fakeDoc.destroy).toHaveBeenCalledTimes(1)
  })

  it('渲染失败（getPage reject）：不抛出，el 内错误提示节点（文案=ctx.t），无 canvas', async () => {
    fakeDoc = makeFakeDoc(3)
    fakeDoc.getPage.mockRejectedValueOnce(new Error('bad pdf'))
    pdfjsHolder.state.impl = { getDocument: fakeDoc.getDocument }
    const el = document.createElement('div')

    const ret = await pdfRenderer(el, FILE, makeCtx(async () => new Blob([BYTES])))
    expect(ret, '失败面也返回实例').toBeDefined()
    expect(el.querySelector('canvas')).toBeNull()
    expect(el.textContent).toBe(`T:${FAIL_KEY}`)
    ;(ret as AppInstance).dispose()
    expect(el.childElementCount).toBe(0)
  })

  it('动态 import 失败（弱网/加载失败）：同款降级为提示节点', async () => {
    pdfjsHolder.state.impl = undefined
    vi.resetModules()
    const el = document.createElement('div')

    const ret = await pdfRenderer(el, FILE, makeCtx(async () => new Blob([BYTES])))
    expect(ret).toBeDefined()
    expect(el.querySelector('canvas')).toBeNull()
    expect(el.textContent).toBe(`T:${FAIL_KEY}`)
    ;(ret as AppInstance).dispose()
    expect(el.childElementCount).toBe(0)
  })

  it('降级判定不改原生路径：pdfViewerEnabled=true → 仍 iframe（两级降级口径回归锚）', async () => {
    stubPdfViewerEnabled(true)
    const el = document.createElement('div')
    await pdfRenderer(el, FILE, makeCtx(async () => new Blob([BYTES], { type: 'application/pdf' })))
    expect(el.querySelector('iframe')).not.toBeNull()
    expect(el.querySelector('canvas')).toBeNull()
    expect(fakeDoc.getDocument).not.toHaveBeenCalled() // 不进 pdf.js
  })
})
