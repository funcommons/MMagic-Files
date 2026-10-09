/**
 * Monaco 文本/代码编辑器渲染器单测（M2-R4）
 * 被测：src/apps/renderers/code.ts——codeEditorRenderer + extToLanguage
 * 要点：动态 import 触发 monaco.editor.create（language 映射正确）/ Ctrl+Cmd+S 保存链
 *       （getValue→Blob→putObject→notify('saved')→dirty 复位、保存中防重入）
 *       / beforeDispose 契约（非 dirty 直接放行；dirty 弹 confirm；3s 超时强制放行）
 *       / file.size > 5MB 只读降级（不建 editor）/ savedState.viewState 恢复 / dispose 清理
 * mock：vi.mock('monaco-editor') 最小面——create 返回 fake editor
 *       （getValue/setValue/onDidChangeModelContent 收集器/restoreViewState/saveViewState/
 *         getModel/dispose…），测试经 editors[-1] 直取实例断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codeEditorRenderer, extToLanguage } from '../code'
import type { AppInstance } from '../../../sdk/types'

// ───────────────────────── monaco-editor mock ─────────────────────────

/** fake editor 最小面（与 monaco 被测调用点一一对应） */
interface FakeEditor {
  getValue: () => string
  setValue: (v: string) => void
  /** 内容变化监听收集器：测试用 listeners[n]?.() 模拟用户输入 → dirty */
  onDidChangeModelContent: (cb: () => void) => { dispose: () => void }
  restoreViewState: ReturnType<typeof vi.fn>
  saveViewState: () => unknown
  focus: ReturnType<typeof vi.fn>
  getModel: () => { dispose: ReturnType<typeof vi.fn> }
  dispose: ReturnType<typeof vi.fn>
  /** onDidChangeModelContent 收集到的回调 */
  listeners: Array<() => void>
}

// vi.hoisted：vi.mock 工厂与测试体共享同一份 fake 状态
const monacoMock = vi.hoisted((): {
  create: ReturnType<typeof vi.fn>
  createModel: ReturnType<typeof vi.fn>
  editors: FakeEditor[]
  reset: () => void
} => {
  const editors: FakeEditor[] = []

  /** create 桩：按 options.value 建 fake editor（value 可由 setValue 演进） */
  const create = vi.fn((_el: HTMLElement, opts: { value?: string; language?: string }) => {
    const listeners: Array<() => void> = []
    let value = opts.value ?? ''
    // model 单例：monaco 一个 editor 绑一个 model（实现与测试须拿到同一实例）
    const model = { dispose: vi.fn() }
    const editor: FakeEditor = {
      getValue: vi.fn(() => value),
      setValue: vi.fn((v: string) => {
        value = v
      }),
      onDidChangeModelContent: vi.fn((cb: () => void) => {
        listeners.push(cb)
        return { dispose: vi.fn() }
      }),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(() => ({ line: 1, column: 1 })),
      focus: vi.fn(),
      getModel: vi.fn(() => model),
      dispose: vi.fn(),
      listeners,
    }
    editors.push(editor)
    return editor
  })

  const reset = () => {
    editors.length = 0
    create.mockClear()
    createModel.mockClear()
  }

  const createModel = vi.fn()
  return { create, createModel, editors, reset }
})

vi.mock('monaco-editor', () => ({
  editor: { create: monacoMock.create, createModel: monacoMock.createModel },
  Uri: { parse: vi.fn() },
}))

// ───────────────────────── 测试基建 ─────────────────────────

/** 渲染文件实参（name 后缀决定 language 映射） */
const FILE = { key: 'docs/demo.ts', name: 'demo.ts', size: 24 }
const TEXT = 'const answer = 42\n'

/** fake ctx：getObject 返回给定文本 Blob；putObject/notify 为 spy（保留 vi.fn 类型便于断言） */
function makeCtx(blob: Blob) {
  return {
    getObject: vi.fn(async (_key: string) => blob),
    putObject: vi.fn(async (_key: string, _data: Blob, _contentType?: string) => {
      /* 默认立即成功 */
    }),
    t: vi.fn((key: string) => `i18n:${key}`),
    notify: vi.fn(),
    theme: {},
  }
}

/** 本渲染器保证 dispose/getState/beforeDispose 三件套齐备（契约：渲染器必须返回 AppInstance） */
type EditorInstance = AppInstance & Required<Pick<AppInstance, 'beforeDispose' | 'getState'>>

/** 渲染助手：容器 + fake ctx → 跑渲染器 → 返回 el/ctx/实例/最后一个 fake editor */
async function render(opts?: { text?: string; file?: { key: string; name: string; size: number }; savedState?: unknown }) {
  const el = document.createElement('div')
  const blob = new Blob([opts?.text ?? TEXT], { type: 'text/plain' })
  const ctx = makeCtx(blob)
  const inst = (await codeEditorRenderer(el, opts?.file ?? FILE, ctx, opts?.savedState)) as EditorInstance
  const editor = monacoMock.editors[monacoMock.editors.length - 1]
  if (!editor) throw new Error('monaco.editor.create 未被调用（应已建 fake editor）')
  return { el, ctx, inst, editor }
}

/** 微任务冲刷：让 doSave 的 await 链（putObject→notify→dirty 复位）跑完 */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** 派发 Ctrl/Cmd+S 键盘事件到容器 */
function dispatchSave(el: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true, ...init })
  el.dispatchEvent(ev)
  return ev
}

let confirmSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  monacoMock.reset()
  // jsdom 未实现 window.confirm：统一挂 spy（默认=用户确认）
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  // MonacoEnvironment 全局态逐测清理（实现只在缺位时设置一次）
  delete (self as { MonacoEnvironment?: unknown }).MonacoEnvironment
})

afterEach(() => {
  confirmSpy.mockRestore()
  vi.useRealTimers()
})

// ───────────────────────── extToLanguage 纯函数 ─────────────────────────

describe('extToLanguage：ext→monaco language id', () => {
  it('常见扩展名映射（js/ts/json/html/css/md/py/java/go/rs/sql/sh/yaml/xml…）', () => {
    expect(extToLanguage('js')).toBe('javascript')
    expect(extToLanguage('jsx')).toBe('javascript')
    expect(extToLanguage('ts')).toBe('typescript')
    expect(extToLanguage('tsx')).toBe('typescript')
    expect(extToLanguage('json')).toBe('json')
    expect(extToLanguage('html')).toBe('html')
    expect(extToLanguage('css')).toBe('css')
    expect(extToLanguage('scss')).toBe('scss')
    expect(extToLanguage('md')).toBe('markdown')
    expect(extToLanguage('py')).toBe('python')
    expect(extToLanguage('java')).toBe('java')
    expect(extToLanguage('go')).toBe('go')
    expect(extToLanguage('rs')).toBe('rust')
    expect(extToLanguage('sql')).toBe('sql')
    expect(extToLanguage('sh')).toBe('shell')
    expect(extToLanguage('yaml')).toBe('yaml')
    expect(extToLanguage('yml')).toBe('yaml')
    expect(extToLanguage('xml')).toBe('xml')
    expect(extToLanguage('c')).toBe('c')
    expect(extToLanguage('cpp')).toBe('cpp')
    expect(extToLanguage('cs')).toBe('csharp')
    expect(extToLanguage('rb')).toBe('ruby')
    expect(extToLanguage('php')).toBe('php')
    expect(extToLanguage('kt')).toBe('kotlin')
    expect(extToLanguage('swift')).toBe('swift')
    expect(extToLanguage('vue')).toBe('html')
    expect(extToLanguage('ini')).toBe('ini')
  })

  it('归一化：忽略大小写与前导点', () => {
    expect(extToLanguage('TS')).toBe('typescript')
    expect(extToLanguage('.Py')).toBe('python')
    expect(extToLanguage('JSON')).toBe('json')
  })

  it('未知扩展名 / 空值默认 plaintext', () => {
    expect(extToLanguage('xyz')).toBe('plaintext')
    expect(extToLanguage('txt')).toBe('plaintext')
    expect(extToLanguage('')).toBe('plaintext')
    expect(extToLanguage('..')).toBe('plaintext')
  })
})

// ───────────────────────── 挂载与 monaco 环境 ─────────────────────────

describe('codeEditorRenderer：挂载', () => {
  it('动态 import 触发 editor.create：value=文件文本、language 按扩展名映射、automaticLayout/minimap 契约', async () => {
    const { el, ctx, inst } = await render()
    expect(ctx.getObject).toHaveBeenCalledWith('docs/demo.ts')
    expect(monacoMock.create).toHaveBeenCalledTimes(1)
    const [createdEl, opts] = monacoMock.create.mock.calls[0] as unknown as [HTMLElement, { value: string; language: string; automaticLayout: boolean; minimap: { enabled: boolean } }]
    expect(createdEl).toBe(el)
    expect(opts.value).toBe(TEXT)
    expect(opts.language).toBe('typescript')
    expect(opts.automaticLayout).toBe(true)
    expect(opts.minimap.enabled).toBe(false)
    inst.dispose()
  })

  it('language 映射按文件名后缀取（py→python；无后缀→plaintext）', async () => {
    await render({ file: { key: 'scripts/run.py', name: 'run.py', size: 4 } })
    expect((monacoMock.create.mock.calls[0] as unknown as [HTMLElement, { language: string }])[1].language).toBe('python')

    monacoMock.reset()
    await render({ file: { key: 'etc/motd', name: 'motd', size: 4 } })
    expect((monacoMock.create.mock.calls[0] as unknown as [HTMLElement, { language: string }])[1].language).toBe('plaintext')
  })

  it('挂载后准备 MonacoEnvironment 占位 worker（getWorker 就位；占位策略后续收口）', async () => {
    await render()
    const env = (self as { MonacoEnvironment?: { getWorker?: unknown } }).MonacoEnvironment
    expect(typeof env?.getWorker).toBe('function')
  })
})

// ───────────────────────── 保存链 ─────────────────────────

describe('codeEditorRenderer：Ctrl/Cmd+S 保存链', () => {
  it('编辑变化→dirty；Ctrl+S→getValue→Blob→putObject→notify(saved)→dirty 复位', async () => {
    const { el, ctx, inst, editor } = await render()
    // 模拟用户输入：内容变化回调 → dirty
    expect(editor.listeners.length).toBeGreaterThan(0)
    editor.listeners[0]!()

    const ev = dispatchSave(el)
    expect(ev.defaultPrevented).toBe(true) // 拦截浏览器默认「保存网页」
    await flush()

    expect(editor.getValue).toHaveBeenCalled()
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
    const [key, data] = ctx.putObject.mock.calls[0] as unknown as [string, Blob]
    expect(key).toBe('docs/demo.ts')
    expect(data).toBeInstanceOf(Blob)
    expect(await data.text()).toBe(TEXT)
    expect(ctx.notify).toHaveBeenCalledWith('saved', { key: 'docs/demo.ts' })

    // dirty 复位：非 dirty → beforeDispose 同步放行 true，不弹 confirm
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(inst.beforeDispose()).toBe(true)
    inst.dispose()
  })

  it('Cmd+S（macOS metaKey）同样触发保存', async () => {
    const { el, ctx, editor } = await render()
    editor.listeners[0]!()
    dispatchSave(el, { key: 'S', metaKey: true, ctrlKey: false })
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
  })

  it('无修饰键 / Ctrl+Alt+S 不触发保存', async () => {
    const { el, ctx, editor } = await render()
    editor.listeners[0]!()
    dispatchSave(el, { ctrlKey: false })
    dispatchSave(el, { altKey: true })
    await flush()
    expect(ctx.putObject).not.toHaveBeenCalled()
    expect(ctx.notify).not.toHaveBeenCalled()
  })

  it('保存中防重入：putObject 未决期间重复 Ctrl+S 只触发一次保存', async () => {
    const { el, ctx, editor } = await render()
    editor.listeners[0]!()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ctx.putObject.mockReturnValueOnce(gate)

    dispatchSave(el)
    dispatchSave(el)
    expect(ctx.putObject).toHaveBeenCalledTimes(1)

    release()
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(1) // 放行后也不再补发
    expect(ctx.notify).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────── beforeDispose 契约 ─────────────────────────

describe('codeEditorRenderer：beforeDispose 契约', () => {
  it('非 dirty：直接放行 true，不弹 confirm', async () => {
    const { inst } = await render()
    expect(inst.beforeDispose()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('dirty：弹 confirm，用户取消=false=暂缓关闭', async () => {
    const { inst, editor } = await render()
    confirmSpy.mockReturnValue(false)
    editor.listeners[0]!()
    await expect(inst.beforeDispose()).resolves.toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenCalledWith('i18n:app.code-unsaved')
  })

  it('dirty 且 confirm 未决：3s 超时强制放行 true（Promise.race 契约）', async () => {
    vi.useFakeTimers()
    const { inst, editor } = await render()
    // confirm 挂死（模拟异步对话框不返回）：超时兜底必须接管
    confirmSpy.mockImplementation(() => new Promise<boolean>(() => undefined) as unknown as boolean)
    editor.listeners[0]!()

    const pending = Promise.resolve(inst.beforeDispose())
    let result: boolean | undefined
    void pending.then((v) => {
      result = v
    })

    await vi.advanceTimersByTimeAsync(2999)
    await Promise.resolve()
    expect(result).toBeUndefined() // 未到 3s：不决出

    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    expect(result).toBe(true) // 3s 到：强制放行
  })
})

// ───────────────────────── 5MB 只读降级 ─────────────────────────

describe('codeEditorRenderer：5MB 只读降级', () => {
  it('file.size > 5_000_000：不建 editor，显示只读提示（ctx.t），dispose 清容器', async () => {
    const el = document.createElement('div')
    const ctx = makeCtx(new Blob(['x'], { type: 'text/plain' }))
    const inst = (await codeEditorRenderer(el, { ...FILE, size: 5_000_001 }, ctx)) as AppInstance

    expect(monacoMock.create).not.toHaveBeenCalled()
    expect(monacoMock.editors).toHaveLength(0)
    expect(ctx.getObject).not.toHaveBeenCalled() // 超限不拉字节流
    expect(ctx.t).toHaveBeenCalledWith('app.code-too-large')
    expect(el.textContent).toBe('i18n:app.code-too-large')

    inst.dispose()
    expect(el.innerHTML).toBe('')
  })

  it('file.size 恰为 5MB：不降级，正常建 editor', async () => {
    await render({ file: { ...FILE, size: 5_000_000 } })
    expect(monacoMock.create).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────── savedState / 生命周期 ─────────────────────────

describe('codeEditorRenderer：savedState 与生命周期', () => {
  it('savedState 携带 viewState：restoreViewState(viewState) + focus', async () => {
    const viewState = { cursorState: [{ inSelection: false }], scrollLeft: 0 }
    const { editor } = await render({ savedState: { viewState } })
    expect(editor.restoreViewState).toHaveBeenCalledWith(viewState)
    expect(editor.focus).toHaveBeenCalledTimes(1)
  })

  it('无 savedState / 形状不符：不调 restoreViewState', async () => {
    await render({ savedState: 'junk' })
    const editor = monacoMock.editors[monacoMock.editors.length - 1]!
    expect(editor.restoreViewState).not.toHaveBeenCalled()
  })

  it('getState 返回 { viewState }（切 tab 重跑注入 savedState 用）', async () => {
    const { inst } = await render()
    expect(inst.getState).toEqual(expect.any(Function))
    expect(inst.getState?.()).toEqual({ viewState: { line: 1, column: 1 } })
  })

  it('dispose：model.dispose → editor.dispose，按键监听一并移除（dispose 后 Ctrl+S 不再保存）', async () => {
    const { el, ctx, inst, editor } = await render()
    const model = editor.getModel()
    inst.dispose()

    expect(model?.dispose).toHaveBeenCalledTimes(1)
    expect(editor.dispose).toHaveBeenCalledTimes(1)

    ctx.putObject.mockClear()
    dispatchSave(el)
    await flush()
    expect(ctx.putObject).not.toHaveBeenCalled()
    expect(el.innerHTML).toBe('') // 容器清空
  })
})
