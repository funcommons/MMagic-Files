/**
 * pptx-viewer 插件单测：resolveRenderWidth 边界 / renderTip 文案面 / renderPptx 装配链
 * （init 16:9 调用、preview(buffer)、init 抛错→onParseError、dispose 收口）/ activate 契约
 * （registerApp 形状、尺寸双闸、解析失败 tip）。
 * mock：vi.mock('pptx-preview')（init/preview spy）；ResizeObserver jsdom 缺失 → 类桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activate } from '../index'
import { renderPptx, renderTip, resolveRenderWidth } from '../render'
import type { HostCtx, HostFile, HostSdk } from '../types'

// ───────────────────────── pptx-preview mock ─────────────────────────

const pptxMock = vi.hoisted(() => {
  const preview = vi.fn()
  const init = vi.fn(() => ({ preview }))
  return { init, preview }
})
vi.mock('pptx-preview', () => ({ init: pptxMock.init }))

// jsdom 无 ResizeObserver：最小类桩（observe/disconnect 无操作——resize 重建链不在单测覆盖面，E2E 兜）
beforeEach(() => {
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver
  pptxMock.init.mockClear()
  pptxMock.preview.mockClear()
  pptxMock.init.mockImplementation(() => ({ preview: pptxMock.preview }))
})
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
})

// ───────────────────────── 测试基建 ─────────────────────────

const FILE: HostFile = { key: 'slides/demo.pptx', name: 'demo.pptx', size: 1024 }

function makeCtx(blob: Blob): HostCtx {
  return {
    getObject: vi.fn(async () => blob),
    t: vi.fn((key: string, params?: Record<string, unknown>) =>
      params ? `i18n:${key}:${JSON.stringify(params)}` : `i18n:${key}`,
    ),
    notify: vi.fn(),
  }
}

function makeSdk(): { sdk: HostSdk; defs: Array<Record<string, unknown>> } {
  const defs: Array<Record<string, unknown>> = []
  const sdk = {
    version: 1,
    registerApp: vi.fn((def: Record<string, unknown>) => {
      defs.push(def)
      return { ok: true }
    }),
  } as unknown as HostSdk
  return { sdk, defs }
}

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0))
}

// ───────────────────────── resolveRenderWidth 纯函数 ─────────────────────────

describe('resolveRenderWidth：渲染宽自适应边界', () => {
  it('异常输入（负/0/NaN）→ 缺省 960', () => {
    expect(resolveRenderWidth(-100)).toBe(960)
    expect(resolveRenderWidth(0)).toBe(960)
    expect(resolveRenderWidth(NaN)).toBe(960)
  })

  it('窄容器夹到下界 480；宽容器夹到上界 1400；中间留 24px 滚动余量', () => {
    expect(resolveRenderWidth(300)).toBe(480)
    expect(resolveRenderWidth(2000)).toBe(1400)
    expect(resolveRenderWidth(1000)).toBe(976)
  })
})

// ───────────────────────── renderTip ─────────────────────────

describe('renderTip：超限/错误提示面', () => {
  it('ctx.t 文案渲染（含 params）+ dispose 清空', () => {
    const el = document.createElement('div')
    const ctx = makeCtx(new Blob())
    const inst = renderTip(el, ctx, 'app.pptx-too-large', { limit: '30 MB' })
    expect(el.textContent).toBe('i18n:app.pptx-too-large:{"limit":"30 MB"}')
    inst.dispose()
    expect(el.innerHTML).toBe('')
  })
})

// ───────────────────────── renderPptx 装配链 ─────────────────────────

describe('renderPptx：pptx-preview 装配', () => {
  it('init(page, {width, height 16:9}) + preview(buffer)；root 挂载注入 relative', async () => {
    const el = document.createElement('div')
    const ctx = makeCtx(new Blob())
    const buf = new ArrayBuffer(8)
    const inst = await renderPptx(el, ctx, buf, () => {})
    await flush()
    expect(el.style.getPropertyValue('position')).toBe('relative')
    expect(el.querySelector('.pptx-viewer')).not.toBeNull()
    expect(el.querySelector('.pptx-viewer__page')).not.toBeNull()
    expect(pptxMock.init).toHaveBeenCalledTimes(1)
    const [container, opts] = pptxMock.init.mock.calls[0] as unknown as [
      HTMLElement,
      { width: number; height: number },
    ]
    expect(container.className).toBe('pptx-viewer__page')
    expect(opts.width).toBeGreaterThan(0)
    expect(Math.abs(opts.height / opts.width - 9 / 16)).toBeLessThan(0.01) // 16:9 推导
    expect(pptxMock.preview).toHaveBeenCalledWith(buf)
    inst.dispose()
    expect(el.innerHTML).toBe('')
    expect(el.style.getPropertyValue('position')).toBe('') // 注入样式还原
  })

  it('init 抛错 → onParseError 回调（错误面透出）不外抛', async () => {
    pptxMock.init.mockImplementation(() => {
      throw new Error('corrupt pptx')
    })
    const el = document.createElement('div')
    const onError = vi.fn()
    const inst = await renderPptx(el, makeCtx(new Blob()), new ArrayBuffer(4), onError)
    expect(() => inst.dispose()).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────── activate 契约 ─────────────────────────

describe('activate：registerApp 契约与 renderer 双闸', () => {
  it('注册形状：id/matcher/label/actions/maxBytes=30MiB', () => {
    const { sdk, defs } = makeSdk()
    activate(sdk)
    expect(defs).toHaveLength(1)
    const def = defs[0] as unknown as Record<string, unknown>
    expect(def.id).toBe('pptx-viewer')
    expect(def.matcher).toEqual({ ext: ['pptx'] })
    expect(def.label).toBe('app.pptx-viewer')
    expect(def.actions).toEqual(['preview'])
    expect(def.maxBytes).toBe(30 * 1024 * 1024)
  })

  it('正常路径：getObject → arrayBuffer → renderPptx（preview 收到字节）', async () => {
    const { sdk, defs } = makeSdk()
    activate(sdk)
    const renderer = defs[0]!.renderer as NonNullable<Record<string, unknown>['renderer']> as (
      el: HTMLElement,
      file: HostFile,
      ctx: HostCtx,
    ) => Promise<{ dispose(): void }>
    const el = document.createElement('div')
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
    const ctx = makeCtx(blob)
    const inst = await renderer(el, FILE, ctx)
    expect(ctx.getObject).toHaveBeenCalledWith('slides/demo.pptx')
    expect(pptxMock.preview).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.pptx-viewer')).not.toBeNull()
    inst.dispose()
  })

  it('file.size 预检超限 → too-large tip（不拉字节流）', async () => {
    const { sdk, defs } = makeSdk()
    activate(sdk)
    const renderer = defs[0]!.renderer as (
      el: HTMLElement,
      file: HostFile,
      ctx: HostCtx,
    ) => Promise<{ dispose(): void }>
    const el = document.createElement('div')
    const ctx = makeCtx(new Blob([new Uint8Array([1])]))
    const inst = await renderer(el, { ...FILE, size: 30 * 1024 * 1024 + 1 }, ctx)
    expect(ctx.getObject).not.toHaveBeenCalled() // 超限不拉字节流
    expect(el.textContent).toContain('app.pptx-too-large')
    expect(pptxMock.init).not.toHaveBeenCalled()
    inst.dispose()
  })

  it('blob.size 复核超限（预检绕过防御纵深）→ too-large tip', async () => {
    const { sdk, defs } = makeSdk()
    activate(sdk)
    const renderer = defs[0]!.renderer as (
      el: HTMLElement,
      file: HostFile,
      ctx: HostCtx,
    ) => Promise<{ dispose(): void }>
    const el = document.createElement('div')
    const big = new Blob([new Uint8Array(4)])
    const ctx = { ...makeCtx(big), getObject: vi.fn(async () => new Blob([new Uint8Array(32 * 1024 * 1024)])) }
    const inst = await renderer(el, { ...FILE, size: 100 }, ctx)
    expect(el.textContent).toContain('app.pptx-too-large')
    expect(pptxMock.init).not.toHaveBeenCalled()
    inst.dispose()
  })

  it('解析失败 → parse-failed tip（onParseError 走 renderTip 错误面）', async () => {
    pptxMock.init.mockImplementation(() => {
      throw new Error('bad zip')
    })
    const { sdk, defs } = makeSdk()
    activate(sdk)
    const renderer = defs[0]!.renderer as (
      el: HTMLElement,
      file: HostFile,
      ctx: HostCtx,
    ) => Promise<{ dispose(): void }>
    const el = document.createElement('div')
    const ctx = makeCtx(new Blob([new Uint8Array([9, 9])]))
    const inst = await renderer(el, FILE, ctx)
    expect(el.textContent).toContain('app.pptx-parse-failed')
    inst.dispose()
  })
})
