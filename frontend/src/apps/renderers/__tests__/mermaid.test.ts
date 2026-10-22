/**
 * Mermaid 图示渲染器单测（mermaid-viewer）
 * 契约正本：renderers/mermaid.ts 头注释——
 *  getObject → 超限只读提示（MERMAID_MAX_BYTES 同源防线）→ 动态 import('mermaid')（
 *  initialize strict + render 唯一 id）→ SVG 注入 .mmagic-mermaid；渲染失败 → 错误提示
 *  节点不抛出；dispose = style+view 移除。
 * 环境：jsdom——mermaid 模块整体 mock（render 出 SVG 字符串桩）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mermaidViewerRenderer } from '../mermaid'
import { MERMAID_MAX_BYTES } from '../../builtins'
import type { AppCtx, AppInstance } from '../../../sdk/types'
import type { Mock } from 'vitest'

// ───────────────────────── mermaid 动态导入 mock（holder 蹦床，pdf.test.ts 同款） ─────────────────────────
const mermaidHolder = vi.hoisted(() => ({
  state: {
    // rest-any 可调用形状（裸 ReturnType<typeof vi.fn> 在 vitest 4 推导出 Procedure|Constructable 联合，不可调用 TS2348）
    impl: undefined as
      | { initialize: Mock<(...args: any[]) => any>; render: Mock<(...args: any[]) => any> }
      | undefined,
  },
}))
// 蹦床必须按调用时委托：vi.mock 工厂只求值一次，直接绑 impl 对象会让后续用例的替换失效
vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => {
      if (!mermaidHolder.state.impl) throw new Error('mermaid unavailable (simulated)')
      return mermaidHolder.state.impl.initialize(...args)
    },
    render: (...args: unknown[]) => {
      if (!mermaidHolder.state.impl) throw new Error('mermaid unavailable (simulated)')
      return mermaidHolder.state.impl.render(...args)
    },
  },
}))

/** 渲染文件实参 */
const FILE = { key: 'diagrams/flow.mmd', name: 'flow.mmd', size: 128 }

/** 提示 i18n key */
const TOO_LARGE_KEY = 'app.mermaid-too-large'
const FAIL_KEY = 'app.mermaid-load-fail'

function makeCtx(getObjectImpl: () => Promise<Blob>): AppCtx {
  return {
    getObject: vi.fn(getObjectImpl),
    t: (key: string) => `T:${key}`,
  } as unknown as AppCtx
}

beforeEach(() => {
  mermaidHolder.state.impl = {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, _text: string) => ({ svg: '<svg data-mock="1"></svg>' })),
  }
})

afterEach(() => {
  mermaidHolder.state.impl = undefined
  document.body.innerHTML = ''
})

describe('mermaid-viewer 渲染器', () => {
  it('成功路径：注入容器 + strict 初始化 + render 唯一 id + SVG 产出；dispose 清理 style/view', async () => {
    const ctx = makeCtx(async () => new Blob(['graph TD\n  A-->B']))
    const el = document.createElement('div')

    const inst = (await mermaidViewerRenderer(el, FILE, ctx)) as AppInstance
    expect(typeof inst.dispose).toBe('function')

    const view = el.querySelector('.mmagic-mermaid')
    expect(view).not.toBeNull()
    expect(view!.querySelector('svg[data-mock]')).not.toBeNull()

    const impl = mermaidHolder.state.impl!
    expect(impl.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', startOnLoad: false }))
    const renderId = impl.render.mock.calls[0]![0] as string
    expect(renderId).toMatch(/^mmf-mmd-\d+$/)
    expect(impl.render.mock.calls[0]![1]).toContain('graph TD')

    inst.dispose()
    expect(el.querySelector('.mmagic-mermaid')).toBeNull()
    expect(el.querySelector('style')).toBeNull()
  })

  it('超限：blob.size > MERMAID_MAX_BYTES → 只读提示，不进渲染管线', async () => {
    const ctx = makeCtx(async () => new Blob([new Uint8Array(MERMAID_MAX_BYTES + 1)]))
    const el = document.createElement('div')

    const inst = (await mermaidViewerRenderer(el, FILE, ctx)) as AppInstance
    expect(el.textContent).toContain(`T:${TOO_LARGE_KEY}`)
    expect(mermaidHolder.state.impl).not.toBeNull()
    expect(el.querySelector('.mmagic-mermaid')).toBeNull()

    inst.dispose()
    expect(el.innerHTML).toBe('')
  })

  it('渲染失败：mermaid.render 拒绝 → 错误提示节点不抛出；dispose 清理', async () => {
    mermaidHolder.state.impl!.render = vi.fn(async () => {
      throw new Error('parse error')
    })
    const ctx = makeCtx(async () => new Blob(['graph TD\n  A --->> 非法']))
    const el = document.createElement('div')

    const inst = (await mermaidViewerRenderer(el, FILE, ctx)) as AppInstance
    expect(el.textContent).toContain(`T:${FAIL_KEY}`)
    expect(el.querySelector('.mmagic-mermaid')).toBeNull()

    inst.dispose()
    expect(el.innerHTML).toBe('')
  })

  it('import 失败（弱网/环境）→ 同样落错误提示节点不抛出', async () => {
    mermaidHolder.state.impl = undefined
    const ctx = makeCtx(async () => new Blob(['graph TD\n  A-->B']))
    const el = document.createElement('div')

    const inst = (await mermaidViewerRenderer(el, FILE, ctx)) as AppInstance
    expect(el.textContent).toContain(`T:${FAIL_KEY}`)
    inst.dispose()
    expect(el.innerHTML).toBe('')
  })
})
