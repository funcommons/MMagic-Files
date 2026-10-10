/**
 * 文本/代码编辑器渲染器（Monaco）——M2-R4
 * 契约：《documents/第一期文件类型支持计划.md》§一（code-editor 行）+
 *       《动态插件方案.md》V1.1 §二 ctx 能力面（凭证不出、字节流进出）+ AppInstance 生命周期。
 * 链路：5MB 先判（file.size，超限不拉字节流）→ ctx.getObject → Blob.text() →
 *       monaco.editor.create（动态 import，绝不入主 bundle）→ dirty 跟踪 → Ctrl/Cmd+S 保存链。
 * 保存链：getValue → new Blob → ctx.putObject(key, blob) → ctx.notify('saved', {key}) → dirty=false；
 *         保存中防重入（saving 闸）；失败保持 dirty（beforeDispose 仍拦截），不误报已保存。
 * beforeDispose 契约：非 dirty 同步放行 true；dirty 弹 confirm（false=暂缓关闭）；
 *         并与 3s 超时 Promise.race——confirm 卡死时强制放行，防 tab 永久悬挂。
 * worker：MonacoEnvironment 挂占位 getWorker（空脚本 Blob Worker）——语法高亮走主线程、
 *         语言服务降级；vite 构建期 worker 打包策略后续收口（见《第一期文件类型支持计划》）。
 */
import type { editor as monacoEditorNS } from 'monaco-editor'
import { CODE_MAX_BYTES } from '../builtins'
import { formatBytes } from '../../files/format'
import type { AppCtx, AppDefinition, AppInstance } from '../../sdk/types'

// ───────────────────────── 常量 ─────────────────────────
// 文本类预览/编辑上限：5MiB（契约预览策略；按 file.size 先判，避免白拉超限字节流）。
// 与 code-editor spec.maxBytes 同源（builtins.ts，R2-03）——预览闸已按该线在上游拒绝，
// 此处保留作防御纵深（绕闸调用方/未登记 maxBytes 的注册路径）。
// 口径统一：原 5_000_000（十进制）废弃，改 5*1024*1024（1024 基）对齐 markdown/预览闸。

/** i18n key：超限只读提示 / 未保存关闭确认（词典在 locales，键缺省时 t 回退键名） */
const TOO_LARGE_KEY = 'app.code-too-large'
const UNSAVED_KEY = 'app.code-unsaved'

/** beforeDispose 超时：confirm 卡死 3s 后强制放行（契约） */
const BEFORE_DISPOSE_TIMEOUT_MS = 3000

// ───────────────────────── 语言映射 ─────────────────────────

/**
 * ext → monaco language id 映射表（纯函数查表，无运行时依赖）
 * 值均为 monaco basic-languages / 内建语言 id；SFC(vue) 无专有语言，落 html 兜底高亮。
 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html', vue: 'html',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown',
  py: 'python', pyw: 'python',
  java: 'java', go: 'go', rs: 'rust',
  sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
  yaml: 'yaml', yml: 'yaml', xml: 'xml',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  ini: 'ini', conf: 'ini', properties: 'ini',
  dockerfile: 'dockerfile', makefile: 'makefile',
}

/**
 * 扩展名 → monaco language id（导出供注册链/测试复用）
 * 归一化：忽略大小写与前导点；未命中/空值默认 'plaintext'。
 */
export function extToLanguage(ext: string): string {
  const key = ext.toLowerCase().replace(/^\.+/, '')
  return EXT_TO_LANGUAGE[key] ?? 'plaintext'
}

/** 文件名 → 扩展名（无后缀返回 ''，走 plaintext） */
function extOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1) : ''
}

// ───────────────────────── monaco 环境 ─────────────────────────

/**
 * MonacoEnvironment 占位 worker（幂等）：
 * monaco 创建语言 worker 前会问 MonacoEnvironment.getWorker；不挂会运行期报错。
 * 占位=空脚本 Blob Worker：主线程高亮可用，语言服务（补全/跳转）静默降级。
 * TODO(M2+): vite 构建期用 ?worker 打包 monaco 各语言 worker，替换此占位。
 */
function ensureMonacoEnv(): void {
  const g = self as unknown as { MonacoEnvironment?: { getWorker: () => Worker } }
  if (g.MonacoEnvironment) return
  g.MonacoEnvironment = {
    getWorker: () => new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' }))),
  }
}

/** 超限只读提示节点（不读全文、不建 editor；{limit} 与预览闸同源 formatBytes 口径，R2-05） */
function showTooLargeTip(el: HTMLElement, ctx: AppCtx): AppInstance {
  const tip = document.createElement('div')
  tip.className = 'code-too-large-tip'
  tip.style.padding = '16px'
  tip.style.color = 'var(--app-text-secondary, #888)'
  tip.textContent = ctx.t(TOO_LARGE_KEY, { limit: formatBytes(CODE_MAX_BYTES) })
  el.replaceChildren(tip)
  return { dispose: () => el.replaceChildren() }
}

// ───────────────────────── beforeDispose 契约 ─────────────────────────

/**
 * confirm 应答 → Promise<boolean>：
 * window.confirm 原生为同步 API，包装成 Promise 以便与 3s 超时 Promise.race；
 * 同时兼容宿主把 confirm 替换为异步对话框（返回 thenable）——超时兜底对两者都成立。
 */
function askUser(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const answer = window.confirm(message) as boolean | Promise<boolean>
    const thenable = answer as {
      then?: (onOk: (v: boolean) => void, onErr: () => void) => void
    }
    if (thenable && typeof thenable.then === 'function') {
      // 异步应答：拒绝也放行（异常 dialog 不该卡死 tab）
      thenable.then(resolve, () => resolve(true))
      return
    }
    resolve(answer as boolean)
  })
}

// ───────────────────────── 渲染器 ─────────────────────────

/**
 * Monaco 代码编辑器渲染器（内置应用 code-editor）
 * 渲染失败（getObject/读文本异常）向上抛，由 openFile 链路统一兜底（对齐 markdown 渲染器口径）；
 * 正常路径保证返回完整 AppInstance：dispose / getState / beforeDispose 三件套。
 */
export const codeEditorRenderer: AppDefinition['renderer'] = async (
  el,
  file,
  ctx,
  savedState,
) => {
  // 1) 5MiB 只读降级：先按 file.size 判，不建 editor、不拉字节流（契约预览策略；与闸关系见常量注）
  if (file.size > CODE_MAX_BYTES) {
    return showTooLargeTip(el, ctx)
  }

  // 2) 字节流 → 文本
  const blob = await ctx.getObject(file.key)
  const text = await blob.text()

  // 3) monaco 动态 import（顶层禁止 import——bundle 重量；类型走顶部 import type，编译期擦除）
  ensureMonacoEnv()
  const monaco = await import('monaco-editor')
  const editor: monacoEditorNS.IStandaloneCodeEditor = monaco.editor.create(el, {
    value: text,
    language: extToLanguage(extOf(file.name)),
    automaticLayout: true,
    minimap: { enabled: false },
  })

  // 4) 状态闸：dirty=有未保存修改；saving=保存中（防重入）
  let dirty = false
  let saving = false
  editor.onDidChangeModelContent(() => {
    dirty = true
  })

  // 5) 保存链：getValue → Blob → putObject → notify('saved') → dirty 复位
  async function save(): Promise<void> {
    if (saving) return // 保存中：本次按键丢弃（防重入，不排队）
    saving = true
    try {
      const value = editor.getValue()
      await ctx.putObject(file.key, new Blob([value], { type: 'text/plain;charset=utf-8' }))
      ctx.notify('saved', { key: file.key })
      dirty = false
    } catch {
      // 保存失败：保持 dirty（beforeDispose 仍会拦），不误报已保存；错误由调用链感知
    } finally {
      saving = false
    }
  }

  // 6) Ctrl/Cmd+S：容器捕获阶段监听（monaco 内部按键不吞捕获；测试可直接向 el 派发）
  function onKeyDown(ev: Event): void {
    const ke = ev as KeyboardEvent
    if ((ke.ctrlKey || ke.metaKey) && !ke.altKey && (ke.key === 's' || ke.key === 'S')) {
      ke.preventDefault() // 拦浏览器默认「保存网页」
      ke.stopPropagation()
      void save()
    }
  }
  el.addEventListener('keydown', onKeyDown, true)

  // 7) savedState 恢复：切回 tab 重跑时还原视口（光标/滚动），并夺焦
  const prev = savedState as { viewState?: monacoEditorNS.ICodeEditorViewState } | undefined
  if (prev && typeof prev === 'object' && 'viewState' in prev && prev.viewState) {
    editor.restoreViewState(prev.viewState)
    editor.focus()
  }

  return {
    // getState：切 tab 时存视口；savedState 形状统一为 { viewState }
    getState: () => ({ viewState: editor.saveViewState() }),

    // beforeDispose 契约：非 dirty 同步放行；dirty 与 3s 超时竞速（confirm 卡死强制放行）
    beforeDispose: (): boolean | Promise<boolean> => {
      if (!dirty) return true
      let timer: ReturnType<typeof setTimeout> | undefined
      const guard = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), BEFORE_DISPOSE_TIMEOUT_MS)
      })
      const asked = askUser(ctx.t(UNSAVED_KEY)).finally(() => {
        if (timer !== undefined) clearTimeout(timer) // 用户先应答：撤掉超时闸
      })
      return Promise.race([asked, guard])
    },

    // dispose：先摘监听，再销毁 model 与 editor，最后清容器
    dispose: () => {
      el.removeEventListener('keydown', onKeyDown, true)
      editor.getModel()?.dispose()
      editor.dispose()
      el.replaceChildren()
    },
  }
}
