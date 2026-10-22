/**
 * render.ts jsdom 单测（渲染装配：三形态机 + CodeMirror 编辑窗 + markdown/mermaid 预览窗）
 * 被测：plugins/markdown-editor/src/render.ts（renderEditor → HostInstance）
 * 契约：
 *   - DOM 骨架：.mm-md-root / .mm-md-toolbar / 3 个 [data-mm-mode] / [data-mm-editor] / [data-mm-preview]；
 *     保存钮/形态钮为内联 SVG 图标钮（textContent 无词表文案），hint 走 title/aria-label（= ctx.t 词表 key）；
 *     工具栏布局：保存钮（[data-mm-save]）居左、形态切换组（.mm-md-modes）居右。
 *   - 形态初值优先级：savedState.mode > initialMode > localStorage 记忆 > defaultMode > 'split'。
 *   - 保存链：onChange 置脏 → 保存幂等（clean 不重写）；putObject 失败不上抛、保持脏态可重试。
 *   - Ctrl/Cmd+S（容器捕获级）保存；dispose 移除 keydown 监听 + root + 编辑器。
 *   - getState() = { mode, scrollTop }（preview 态无编辑滚动）。
 * 策略：
 *   - vi.mock('../editor')：CodeMirror 在 jsdom 不可靠，stub createEditor 返回假 EditorHandle
 *     （getText 可配置；setScrollTop/getScrollTop/requestMeasure/dispose 为 spy；onChange/onSave 由测试触发）。
 *   - vi.mock('../mermaid')：挡掉动态 import('mermaid')（巨包，jsdom 下无需真实渲染）；
 *     md.ts 用真实实现（markdown-it 纯字符串层，md.test.ts 已覆盖）。
 *   - ctx 全 stub（t 恒等返回 key）；localStorage 用 jsdom 原生（形态记忆）。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { renderEditor } from '../render'
import { renderMermaidBlocks } from '../mermaid'
import type { HostCtx, HostFile, HostInstance, MdEditorOptions } from '../types'

// ───────────────────────── ../editor stub（vi.mock 提升口径） ─────────────────────────

/** createEditor 装配记录：容器 + 回调（onChange/onSave 由测试手动触发）+ 假 EditorHandle */
interface FakeEditorRecord {
  container: HTMLElement
  opts: { text: string; onSave: () => void; onChange: () => void }
  handle: {
    __text: string
    getText: Mock
    focus: Mock
    getScrollTop: Mock
    setScrollTop: Mock
    requestMeasure: Mock
    dispose: Mock
  }
}

/** 必须提升（vi.mock 工厂不能闭包引用普通顶层变量） */
const editorState = vi.hoisted(() => ({ created: [] as unknown[] }))

vi.mock('../editor', () => ({
  createEditor: (container: HTMLElement, opts: { text: string; onSave: () => void; onChange: () => void }) => {
    const handle = {
      __text: opts.text,
      getText: vi.fn(() => handle.__text),
      focus: vi.fn(),
      getScrollTop: vi.fn(() => 42), // 非 0 值，可区分「真读了」与「默认 0」
      setScrollTop: vi.fn(),
      requestMeasure: vi.fn(),
      dispose: vi.fn(),
    }
    editorState.created.push({ container, opts, handle })
    return handle
  },
}))

// mermaid 懒装配挡板：动态 import('mermaid') 在 jsdom 下既慢又无必要，本文件只验证装配层
vi.mock('../mermaid', () => ({
  renderMermaidBlocks: vi.fn(async () => ({ ok: 0, failed: 0 })),
  clearMermaidCache: vi.fn(),
}))

// ───────────────────────── 测试基建 ─────────────────────────

interface TestCtx extends HostCtx {
  putObject: Mock
  notify: Mock
}

function makeFile(): HostFile {
  return { key: 'docs/hello.md', name: 'hello.md', size: 12 }
}

function makeCtx(): TestCtx {
  return {
    getObject: async () => new Blob(['']),
    putObject: vi.fn(async () => {}),
    t: (k: string) => k,
    notify: vi.fn(),
    theme: {},
  } as unknown as TestCtx
}

interface Mounted {
  el: HTMLElement
  ctx: TestCtx
  inst: HostInstance
  rec: FakeEditorRecord
}

const mounted: HostInstance[] = []

function mount(opts: { text?: string; options?: MdEditorOptions; savedState?: unknown } = {}): Mounted {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const ctx = makeCtx()
  const inst = renderEditor(el, makeFile(), ctx, opts.options ?? {}, opts.text ?? '# t', opts.savedState)
  mounted.push(inst)
  const rec = editorState.created[editorState.created.length - 1] as FakeEditorRecord
  return { el, ctx, inst, rec }
}

/** 排空微任务 + 一轮宏任务（save 的 await 链 / 首开预览的异步管线） */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

function modeBtn(el: HTMLElement, key: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(`[data-mm-mode="${key}"]`) as HTMLButtonElement
}

function saveBtnOf(el: HTMLElement): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>('[data-mm-save]') as HTMLButtonElement
}

function editorPaneOf(el: HTMLElement): HTMLElement {
  return el.querySelector('[data-mm-editor]') as HTMLElement
}

function previewContentOf(el: HTMLElement): HTMLElement {
  return el.querySelector('.mm-md-preview') as HTMLElement
}

beforeEach(() => {
  editorState.created.length = 0
  mounted.length = 0
  document.body.innerHTML = ''
  localStorage.clear()
})

afterEach(() => {
  // 先 dispose（清 debounce 定时器 / keydown 监听），再清环境
  for (const inst of mounted) inst.dispose()
  mounted.length = 0
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

// ───────────────────────── DOM 骨架 ─────────────────────────

describe('DOM 骨架', () => {
  it('mount 后产出 root/toolbar/3 形态钮/编辑窗/预览窗/保存钮，且编辑器装配进编辑窗', () => {
    const { el, ctx, rec } = mount()
    expect(el.style.position).toBe('relative')
    expect(el.querySelector('.mm-md-root')).toBeTruthy()
    expect(el.querySelector('.mm-md-toolbar')).toBeTruthy()
    const btns = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-mm-mode]'))
    expect(btns).toHaveLength(3)
    expect(btns.map((b) => b.dataset.mmMode)).toEqual(['source', 'split', 'preview'])
    // 形态钮已改内联 SVG 图标：文案不再在 textContent，hint 走 title/aria-label（= 词表 key）
    const MODE_HINTS = [
      ['source', 'app.md-mode-source'],
      ['split', 'app.md-mode-split'],
      ['preview', 'app.md-mode-preview'],
    ] as const
    for (const [key, hint] of MODE_HINTS) {
      const b = modeBtn(el, key)
      expect(b.getAttribute('aria-label')).toBe(ctx.t(hint))
      expect(b.title).toBe(ctx.t(hint))
      expect(b.querySelector('svg')).toBeTruthy()
    }
    const editorPane = editorPaneOf(el)
    expect(editorPane).toBeTruthy()
    expect(el.querySelector('[data-mm-preview]')).toBeTruthy()
    // 保存钮：内联 SVG 图标 + label/title 走 i18n 通道（title 额外带快捷键提示）
    const save = saveBtnOf(el)
    expect(save.getAttribute('aria-label')).toBe(ctx.t('app.flow-save'))
    expect(save.title).toBe(`${ctx.t('app.flow-save')} (Ctrl+S)`)
    expect(save.querySelector('svg')).toBeTruthy()
    // 布局：保存钮居左、形态切换组居右（seg 在 save 之后的文档位置）
    const seg = el.querySelector('.mm-md-modes') as HTMLElement
    expect(seg).toBeTruthy()
    expect(save.compareDocumentPosition(seg) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    // createEditor 恰好装配一次，容器挂在编辑窗内
    expect(editorState.created).toHaveLength(1)
    expect(editorPane.contains(rec.container)).toBe(true)
  })
})

// ───────────────────────── 形态初值 ─────────────────────────

describe('形态初值', () => {
  it("options.initialMode='source' → 源码钮 aria-selected，预览窗隐藏", () => {
    const { el } = mount({ options: { initialMode: 'source' } })
    expect(modeBtn(el, 'source').getAttribute('aria-selected')).toBe('true')
    expect(modeBtn(el, 'split').getAttribute('aria-selected')).toBe('false')
    expect(modeBtn(el, 'preview').getAttribute('aria-selected')).toBe('false')
    expect(editorPaneOf(el).style.display).toBe('flex')
    expect((el.querySelector('[data-mm-preview]') as HTMLElement).style.display).toBe('none')
  })

  it("无参数 + localStorage 记忆 'preview' → preview（用户记忆生效），测后清键", () => {
    localStorage.setItem('mm-md-mode', 'preview')
    try {
      const { el, inst } = mount()
      expect(modeBtn(el, 'preview').getAttribute('aria-selected')).toBe('true')
      expect(modeBtn(el, 'source').getAttribute('aria-selected')).toBe('false')
      expect(editorPaneOf(el).style.display).toBe('none')
      const state = inst.getState?.() as { mode: string; scrollTop?: number }
      expect(state.mode).toBe('preview')
      expect(state.scrollTop).toBeUndefined() // preview 态无编辑滚动
    } finally {
      localStorage.removeItem('mm-md-mode')
    }
  })

  it("savedState.mode='split' 压过 options.initialMode='source'（切 tab 恢复优先）", () => {
    const { el } = mount({ options: { initialMode: 'source' }, savedState: { mode: 'split' } })
    expect(modeBtn(el, 'split').getAttribute('aria-selected')).toBe('true')
    expect(modeBtn(el, 'source').getAttribute('aria-selected')).toBe('false')
  })

  it('savedState.scrollTop 数值且非 preview 态 → 恢复编辑滚动', () => {
    const { rec } = mount({ savedState: { mode: 'split', scrollTop: 123 } })
    expect(rec.handle.setScrollTop).toHaveBeenCalledWith(123)
  })

  it('savedState 带 scrollTop 但 mode=preview → 不恢复编辑滚动', () => {
    const { rec } = mount({ savedState: { mode: 'preview', scrollTop: 123 } })
    expect(rec.handle.setScrollTop).not.toHaveBeenCalled()
  })
})

// ───────────────────────── 形态切换 ─────────────────────────

describe('形态切换', () => {
  it("点 preview 钮 → 编辑窗 display none + 写 localStorage 'preview' + 重渲染预览", async () => {
    const { el } = mount({ text: '# 切换' })
    const previewBtn = modeBtn(el, 'preview')
    // 初始 split：编辑窗可见
    expect(editorPaneOf(el).style.display).toBe('flex')
    previewBtn.click()
    expect(editorPaneOf(el).style.display).toBe('none')
    expect(previewBtn.getAttribute('aria-selected')).toBe('true')
    expect(modeBtn(el, 'source').getAttribute('aria-selected')).toBe('false')
    expect(localStorage.getItem('mm-md-mode')).toBe('preview')
    // 切换触发预览管线（真实 md.ts 产出 HTML）
    await flush()
    expect(previewContentOf(el).innerHTML).toContain('<h1>切换</h1>')
  })
})

// ───────────────────────── 保存链 ─────────────────────────

describe('保存链', () => {
  it('onChange 置脏 → saveBtn.click 走 putObject(Blob)+notify，clean 后再点幂等不重写', async () => {
    const { el, ctx, rec } = mount()
    rec.handle.getText.mockReturnValue('# x')

    // 先置脏：徽标非空
    rec.opts.onChange()
    const badge = el.querySelector('.mm-md-dirty') as HTMLElement
    expect(badge.textContent).not.toBe('')

    saveBtnOf(el).click()
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
    const [key, blob, contentType] = ctx.putObject.mock.calls[0] as [string, Blob, string]
    expect(key).toBe('docs/hello.md')
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/markdown')
    // 第三参 contentType 显式带 charset（Blob.type 只留裸 MIME，参数被剥掉，需单独断言）
    expect(contentType).toBe('text/markdown; charset=utf-8')
    await expect(blob.text()).resolves.toBe('# x')
    expect(ctx.notify).toHaveBeenCalledTimes(1)
    expect(ctx.notify).toHaveBeenCalledWith('saved', { key: 'docs/hello.md' })
    // 保存成功 → 脏徽标清空
    expect(badge.textContent).toBe('')

    // clean 后再点：幂等，不再写
    saveBtnOf(el).click()
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
  })

  it('putObject reject → 不上抛（仅告警）、徽标保持脏态、notify 不发、可重试', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { el, ctx, rec } = mount()
    ctx.putObject.mockRejectedValueOnce(new Error('boom'))
    rec.opts.onChange()
    const badge = el.querySelector('.mm-md-dirty') as HTMLElement

    saveBtnOf(el).click()
    await flush()
    // 不上抛（走到这里即未抛出）；失败走 console.warn
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
    expect(ctx.notify).not.toHaveBeenCalled()
    expect(badge.textContent).not.toBe('')
    expect(warnSpy).toHaveBeenCalled()

    // 脏态保留 → 再点重试成功
    saveBtnOf(el).click()
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(2)
    expect(ctx.notify).toHaveBeenCalledTimes(1)
    expect(badge.textContent).toBe('')
  })
})

// ───────────────────────── beforeDispose（未保存确认） ─────────────────────────

describe('beforeDispose 未保存确认', () => {
  it('dirty + confirm=false → false（Promise 形态）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { inst, rec } = mount()
    rec.opts.onChange()
    const result = inst.beforeDispose?.()
    expect(result).toBeInstanceOf(Promise)
    await expect(result as Promise<boolean>).resolves.toBe(false)
    expect(confirmSpy).toHaveBeenCalledWith('app.code-unsaved')
  })

  it('dirty + confirm=true → true', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { inst, rec } = mount()
    rec.opts.onChange()
    await expect(inst.beforeDispose?.() as Promise<boolean>).resolves.toBe(true)
  })

  it('非 dirty → 不弹确认，同步返回 true', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { inst } = mount()
    expect(inst.beforeDispose?.()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})

// ───────────────────────── dispose ─────────────────────────

describe('dispose', () => {
  it('root 移除 + editor.dispose 调用 + keydown 监听移除（Ctrl+S 不再触发保存）+ 幂等', async () => {
    const { el, ctx, inst, rec } = mount()
    rec.opts.onChange() // 置脏，若监听仍在 Ctrl+S 会保存
    const root = el.querySelector('.mm-md-root') as HTMLElement
    expect(root).toBeTruthy()

    inst.dispose()
    expect(root.isConnected).toBe(false) // root 已移除
    expect(rec.handle.dispose).toHaveBeenCalledTimes(1)

    // 容器级 keydown 监听已移除：在 el 上再派发 Ctrl+S 不触发 putObject
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }))
    await flush()
    expect(ctx.putObject).not.toHaveBeenCalled()

    // 双 dispose 幂等：editor.dispose 只调一次
    inst.dispose()
    expect(rec.handle.dispose).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────── getState ─────────────────────────

describe('getState', () => {
  it('split 态 → { mode, scrollTop }（读自编辑器）；preview 态 scrollTop undefined', () => {
    const { el, inst } = mount()
    expect(inst.getState?.()).toEqual({ mode: 'split', scrollTop: 42 })
    modeBtn(el, 'preview').click()
    const state = inst.getState?.() as { mode: string; scrollTop?: number }
    expect(state.mode).toBe('preview')
    expect(state.scrollTop).toBeUndefined()
  })
})

// ───────────────────────── Ctrl/Cmd+S ─────────────────────────

describe('Ctrl/Cmd+S 容器级保存', () => {
  it('el 上派发 Ctrl+S → preventDefault + 触发保存；clean 后 Cmd+S 幂等', async () => {
    const { el, ctx, rec } = mount()
    rec.opts.onChange() // 先置脏

    // 监听挂在本实例容器 el（捕获级）：在 el 上派发即可命中
    const ev = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true, bubbles: true })
    el.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
    await expect((ctx.putObject.mock.calls[0] as [string, Blob])[1].text()).resolves.toBe('# t')

    // 已 clean：Cmd+S 不再重复写
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true, bubbles: true }))
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────── 首开预览 ─────────────────────────

describe('首开预览管线', () => {
  it('preview 态打开 → 立即渲染正文 + 出站链接加固，并透传 mermaid 块', async () => {
    const { el } = mount({
      text: '# hello\n\n[link](https://example.com)',
      options: { initialMode: 'preview' },
    })
    await flush()
    const preview = previewContentOf(el)
    expect(preview.innerHTML).toContain('<h1>hello</h1>')
    const a = preview.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')
    expect(a?.getAttribute('target')).toBe('_blank')
    expect(a?.getAttribute('rel')).toContain('noopener')
    // mermaid 块收集结果（此处无围栏 → 空数组）交给 mermaid 装配层（root 即 .mm-md-preview 本体）
    expect(renderMermaidBlocks).toHaveBeenCalledWith(preview, [])
  })
})
