/**
 * markdown 渲染器单测（M2-R1）
 * 被测：src/apps/renderers/markdown.ts——markdownRenderer
 * 要点：基础渲染（h1/ul/li）/ html:false 转义 / 链接加固（target+rel）
 *       / mermaid 围栏块动态导入：失败静默降级为代码块、成功逐块 render 注 SVG
 *       / 坏围栏仅自身失败（render reject）→ 原文保留，好围栏不受影响
 *       / dispose 清空容器 / 文本 > 5MB 只读提示不渲染
 */
import { describe, expect, it, vi } from 'vitest'
import { markdownRenderer } from '../markdown'
import type { AppCtx, AppInstance } from '../../../sdk/types'

// ───────────────────────── mermaid 动态导入 mock ─────────────────────────
// vi.mock 工厂结果整个测试文件只求值一次并缓存——不能在工厂里直接捕获 holder.impl
// （否则后置用例拿到的是首个成功用例捕获的旧 impl）。故返回稳定壳：调用时再透传到
// 当时的 holder.impl；impl 为 undefined 时壳层抛错 → 生产代码 catch → 静默降级
// （模拟弱网/jsdom 不可用）。
type MermaidLike = {
  initialize: (opts: { startOnLoad: boolean; securityLevel: string; suppressErrorRendering: boolean }) => void
  render: (id: string, code: string) => Promise<{ svg: string }>
}
const mermaidHolder = vi.hoisted(() => ({ impl: undefined as unknown }))
vi.mock('mermaid', () => {
  const current = (): MermaidLike => {
    if (!mermaidHolder.impl) throw new Error('mermaid unavailable (simulated)')
    return mermaidHolder.impl as MermaidLike
  }
  return {
    default: {
      initialize: (...args: Parameters<MermaidLike['initialize']>) => current().initialize(...args),
      render: (...args: Parameters<MermaidLike['render']>) => current().render(...args),
    },
  }
})

// ───────────────────────── 测试基建 ─────────────────────────

/** fake ctx：getObject 返回给定文本的 Blob；t 返回 i18n:<key> 便于断言键名 */
function makeCtx(text: string): { ctx: AppCtx; blob: Blob } {
  const blob = new Blob([text], { type: 'text/markdown' })
  const ctx: AppCtx = {
    getObject: vi.fn(async (_key: string) => blob),
    putObject: vi.fn(async (_key: string, _data: Blob, _contentType?: string) => undefined),
    t: vi.fn((key: string) => `i18n:${key}`),
    notify: vi.fn(),
    theme: {},
  }
  return { ctx, blob }
}

const FILE = { key: 'docs/a.md', name: 'a.md', size: 12 }

/** 渲染助手：构造容器 → 跑渲染器 → 返回 ctx 与实例（契约：渲染器必须返回 AppInstance） */
async function render(el: HTMLElement, text: string): Promise<{ ctx: AppCtx; inst: AppInstance }> {
  const { ctx } = makeCtx(text)
  const inst = (await markdownRenderer(el, FILE, ctx)) as AppInstance
  return { ctx, inst }
}

// ───────────────────────── 基础渲染 ─────────────────────────

describe('markdownRenderer：基础渲染', () => {
  it('渲染 h1 / ul / li（getObject 以 file.key 调用）', async () => {
    const el = document.createElement('div')
    const { ctx, inst } = await render(el, '# hi\n\n- a\n- b')
    expect(ctx.getObject).toHaveBeenCalledWith('docs/a.md')
    expect(el.querySelector('h1')?.textContent).toBe('hi')
    const lis = el.querySelectorAll('ul > li')
    expect(lis.length).toBe(2)
    expect(lis[0]?.textContent).toBe('a')
    expect(lis[1]?.textContent).toBe('b')
    expect(typeof inst.dispose).toBe('function')
    inst.dispose()
  })

  it('html:false：内联原样 HTML 被转义为文本，不产生元素', async () => {
    const el = document.createElement('div')
    await render(el, 'hello <img src=x onerror="window.__pwned=1"> world')
    expect(el.querySelector('img')).toBeNull()
    // 原文以文本形态可见（markdown-it 已转义，输入视为可信文档内容）
    expect(el.textContent).toContain('<img src=x onerror="window.__pwned=1">')
  })
})

// ───────────────────────── 链接加固 ─────────────────────────

describe('markdownRenderer：链接加固', () => {
  it('链接统一 target=_blank 且 rel 含 noopener', async () => {
    const el = document.createElement('div')
    await render(el, 'see [example](https://example.com)')
    const a = el.querySelector('a')
    expect(a).toBeTruthy()
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toContain('noopener')
  })
})

// ───────────────────────── mermaid 围栏块 ─────────────────────────

describe('markdownRenderer：mermaid 增强', () => {
  it('mermaid 不可用（impl 缺省壳层抛错）：静默降级为普通代码块，不抛错', async () => {
    mermaidHolder.impl = undefined
    const el = document.createElement('div')
    const { inst } = await render(el, '# t\n\n```mermaid\ngraph TD; A-->B;\n```')
    const code = el.querySelector('pre > code')
    expect(code).toBeTruthy()
    expect(code?.className).toContain('language-mermaid')
    expect(code?.textContent).toContain('graph TD; A-->B;')
    inst.dispose()
  })

  it('动态导入成功：initialize 三参数 + 每个围栏块调一次 render，SVG 注入 code 元素', async () => {
    const initialize = vi.fn()
    const renderMock = vi.fn(async (_id: string, _code: string) => ({ svg: '<svg data-mock-mermaid="1"></svg>' }))
    mermaidHolder.impl = { initialize, render: renderMock }
    const el = document.createElement('div')
    const { inst } = await render(el, '```mermaid\ngraph TD; A-->B;\n```')
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true }),
    )
    expect(renderMock).toHaveBeenCalledTimes(1)
    const [id, code] = renderMock.mock.calls[0]!
    expect(code).toContain('graph TD; A-->B;') // textContent 解码后传给 render
    expect(id).toMatch(/^mmf-mmd-/)
    expect(el.querySelector('pre > code.language-mermaid')?.innerHTML).toContain('data-mock-mermaid')
    inst.dispose()
  })

  it('坏围栏失败：该块 render reject 后原文保留，好围栏照常注入 SVG（逐块隔离）', async () => {
    const initialize = vi.fn()
    const renderMock = vi.fn(async (_id: string, code: string) => {
      // 模拟 mermaid 解析：悬空箭头的坏围栏 reject，其余 resolve
      if (/A-->\s*$/.test(code)) throw new Error('mermaid parse error')
      return { svg: '<svg data-mock-mermaid="1"></svg>' }
    })
    mermaidHolder.impl = { initialize, render: renderMock }
    const el = document.createElement('div')
    const doc = '```mermaid\ngraph TD\n A-->\n```\n\ntext\n\n```mermaid\ngraph TD; A-->B;\n```'
    const { inst } = await render(el, doc)
    expect(renderMock).toHaveBeenCalledTimes(2) // 失败块也调了 render
    const codes = renderMock.mock.calls.map(([, code]) => code)
    expect(codes[0]).toContain('A-->\n') // 坏围栏
    expect(codes[1]).toContain('A-->B;') // 好围栏
    const nodes = el.querySelectorAll('pre > code.language-mermaid')
    expect(nodes).toHaveLength(2)
    // 坏围栏：静默降级，原代码文本原样保留、无 SVG
    expect(nodes[0]?.querySelector('svg')).toBeNull()
    expect(nodes[0]?.textContent).toContain('graph TD\n A-->')
    // 好围栏：成功注入 mock SVG
    expect(nodes[1]?.innerHTML).toContain('data-mock-mermaid')
    inst.dispose()
  })
})

// ───────────────────────── 生命周期 ─────────────────────────

describe('markdownRenderer：生命周期', () => {
  it('dispose 清空容器 innerHTML', async () => {
    const el = document.createElement('div')
    const { inst } = await render(el, '# hi')
    expect(el.innerHTML).not.toBe('')
    inst.dispose()
    expect(el.innerHTML).toBe('')
  })

  it('文本 > 5MB：不渲染正文，显示超限提示（ctx.t 带 {limit} 实参，R2-03/R2-05），dispose 可清空', async () => {
    const el = document.createElement('div')
    const big = 'x'.repeat(5 * 1024 * 1024 + 1)
    const { ctx, inst } = await render(el, big)
    expect(ctx.t).toHaveBeenCalledWith('app.markdown-too-large', { limit: '5.0 MB' })
    expect(el.querySelector('h1')).toBeNull()
    expect(el.textContent).toBe('i18n:app.markdown-too-large')
    inst.dispose()
    expect(el.innerHTML).toBe('')
  })
})
