/**
 * html-viewer 内置应用单测：htmlSandbox 纯函数（净化/拦截注入/open-request 解析/URL 白名单）+
 * 渲染器（srcdoc 沙箱挂载、message→确认条流、信任域名直开、拒绝面、dispose 收口）。
 * 与 html-editor 插件预览态同口径（插件 sandbox.test 的核心复刻 + 内置渲染器集成面）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { htmlViewerRenderer } from '../html'
import { buildPreviewDoc, MSG_NS, normalizeOpenUrl, parseOpenRequest, sanitizeForPreview } from '../htmlSandbox'
import type { AppCtx, AppInstance } from '../../../sdk/types'

// ───────────────────────── htmlSandbox 纯函数 ─────────────────────────

describe('htmlSandbox：净化', () => {
  it('剥 script/noscript/object/embed/meta refresh/base；on* 与 javascript: href 清零', () => {
    const dirty = `<!doctype html><html><head><meta http-equiv="refresh" content="1"><base href="https://evil"><script>alert(1)</script></head>
      <body onload="x"><a href="javascript:alert(2)" id="a1">bad</a><a href="https://ok.com">good</a>
      <object data="x"></object><img src="data:text/html,<script>"></body></html>`
    const clean = sanitizeForPreview(dirty)
    expect(clean).not.toContain('<script>')
    expect(clean).not.toContain('onload')
    expect(clean).not.toContain('javascript:')
    expect(clean).not.toContain('<object')
    expect(clean).not.toContain('<base')
    expect(clean).toContain('https://ok.com')
    expect(clean.toLowerCase()).toContain('<!doctype html>')
  })

  it('buildPreviewDoc 注入拦截脚本（ns=mmagix-html-viewer，与 html-editor 插件命名空间区分）', () => {
    const doc = buildPreviewDoc('<html><body><p>x</p></body></html>')
    expect(doc).toContain(`var NS='${MSG_NS}'`)
    expect(MSG_NS).toBe('mmagix-html-viewer')
    expect(doc.indexOf('open-request')).toBeGreaterThan(0)
  })
})

describe('htmlSandbox：open-request 解析与 URL 白名单', () => {
  it('parseOpenRequest：ns/type/url 三验；异 ns（html-editor 插件）不认', () => {
    expect(parseOpenRequest({ ns: MSG_NS, type: 'open-request', url: 'https://a.com' })).toEqual({ url: 'https://a.com' })
    expect(parseOpenRequest({ ns: 'mm-html-editor', type: 'open-request', url: 'https://a.com' })).toBeNull()
    expect(parseOpenRequest({ ns: MSG_NS, type: 'other', url: 'x' })).toBeNull()
    expect(parseOpenRequest({ ns: MSG_NS, type: 'open-request', url: '' })).toBeNull()
    expect(parseOpenRequest(null)).toBeNull()
  })

  it('normalizeOpenUrl：仅 http/https；协议相对按 https；怪 scheme 拒绝', () => {
    expect(normalizeOpenUrl('https://a.com/p')).toBe('https://a.com/p')
    expect(normalizeOpenUrl('//cdn.a.com/x')).toBe('https://cdn.a.com/x')
    expect(normalizeOpenUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeOpenUrl('data:text/html,x')).toBeNull()
    expect(normalizeOpenUrl('')).toBeNull()
    expect(normalizeOpenUrl('not a url')).toBeNull()
  })
})

// ───────────────────────── 渲染器集成 ─────────────────────────

const FILE = { key: 'pages/a.html', name: 'a.html', size: 100 }

function makeCtx(text: string): AppCtx {
  return {
    getObject: vi.fn(async () => new Blob([text], { type: 'text/html' })),
    putObject: vi.fn(async () => undefined),
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `T:${key}:${JSON.stringify(params)}` : `T:${key}`,
    notify: vi.fn(),
    theme: {},
  }
}

async function render(text: string): Promise<{ el: HTMLElement; ctx: AppCtx; inst: AppInstance }> {
  const el = document.createElement('div')
  const ctx = makeCtx(text)
  const inst = (await htmlViewerRenderer(el, FILE, ctx)) as AppInstance
  return { el, ctx, inst }
}

/** 以沙箱 iframe 的名义派发 message（渲染器校验 event.source===contentWindow——jsdom 下
 *  contentWindow 存在但派发侧 source 需指过去；用真实 contentWindow postMessage 不可行（srcdoc
 *  沙箱 jsdom 不加载），改为 window.dispatchEvent 构造 MessageEvent 且 source 指向 frame.contentWindow） */
async function dispatchFromFrame(el: HTMLElement, payload: unknown): Promise<void> {
  const frame = el.querySelector('iframe')!
  const ev = new MessageEvent('message', { data: payload, source: frame.contentWindow })
  window.dispatchEvent(ev)
  await new Promise((r) => setTimeout(r, 0))
}

let openSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  openSpy = vi.fn(() => ({ closed: false }) as unknown as Window)
  vi.stubGlobal('open', openSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('htmlViewerRenderer：挂载与跳转代理', () => {
  it('iframe 沙箱挂载：sandbox=allow-scripts + srcdoc 含净化与拦截脚本；dispose 清容器', async () => {
    const { el, inst } = await render('<html><body><h1>页</h1><a href="https://x.com">外链</a></body></html>')
    const frame = el.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
    const srcdoc = frame!.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain('页')
    expect(srcdoc).toContain(MSG_NS)
    inst.dispose()
    expect(el.innerHTML).toBe('')
    expect(el.style.getPropertyValue('position')).toBe('')
  })

  it('message→确认条：open-request 出确认条（文案/按钮），点打开 → window.open(_blank,noopener) + 条收起', async () => {
    const { el, ctx, inst } = await render('<html><body><a href="https://site.example/page">go</a></body></html>')
    try {
    await dispatchFromFrame(el, { ns: MSG_NS, type: 'open-request', url: 'https://site.example/page' })
    const bar = el.querySelector('.mmagix-html-viewer__confirm') as HTMLElement
    expect(bar.dataset.active).toBe('true')
    expect(bar.textContent).toContain('T:app.html-open-confirm')
    expect(bar.textContent).toContain('site.example/page')

    ;(bar.querySelector('button.is-primary') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    expect(openSpy).toHaveBeenCalledWith('https://site.example/page', '_blank', 'noopener,noreferrer')
    expect(bar.dataset.active).toBe('false')
    expect(ctx.notify).not.toHaveBeenCalled()
    } finally { inst.dispose() }
  })

  it('信任勾选：同 origin 二次跳过确认直接开（会话级 Set）；非信任 origin 仍确认', async () => {
    const { el, inst } = await render('<html><body>x</body></html>')
    try {
    await dispatchFromFrame(el, { ns: MSG_NS, type: 'open-request', url: 'https://trust.example/a' })
    const bar = el.querySelector('.mmagix-html-viewer__confirm') as HTMLElement
    ;(bar.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = true
    ;(bar.querySelector('button.is-primary') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    expect(openSpy).toHaveBeenCalledTimes(1)

    // 同 origin 再来：不确认直接开
    await dispatchFromFrame(el, { ns: MSG_NS, type: 'open-request', url: 'https://trust.example/b' })
    await new Promise((r) => setTimeout(r, 0))
    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(bar.dataset.active).toBe('false') // 未弹确认
    } finally { inst.dispose() }
  })

  it('拒绝面：怪 scheme URL → notify html-open-rejected，不弹确认不开窗', async () => {
    const { el, ctx, inst } = await render('<html><body>x</body></html>')
    try {
    await dispatchFromFrame(el, { ns: MSG_NS, type: 'open-request', url: 'javascript:alert(1)' })
    const bar = el.querySelector('.mmagix-html-viewer__confirm') as HTMLElement
    expect(bar.dataset.active).toBe('false')
    expect(ctx.notify).toHaveBeenCalledWith('html-open-rejected', { url: 'javascript:alert(1)' })
    expect(openSpy).not.toHaveBeenCalled()
    } finally { inst.dispose() }
  })

  it('异源 message（非本 iframe source / 异 ns）静默忽略', async () => {
    const { el, inst } = await render('<html><body>x</body></html>')
    try {
    // 异 ns
    await dispatchFromFrame(el, { ns: 'mm-html-editor', type: 'open-request', url: 'https://a.com' })
    // 异 source（别的 window）
    const alien = new MessageEvent('message', { data: { ns: MSG_NS, type: 'open-request', url: 'https://a.com' }, source: {} as unknown as Window })
    window.dispatchEvent(alien)
    await new Promise((r) => setTimeout(r, 0))
    const bar = el.querySelector('.mmagix-html-viewer__confirm') as HTMLElement
    expect(bar.dataset.active).toBe('false')
    expect(openSpy).not.toHaveBeenCalled()
    } finally { inst.dispose() }
  })

  it('失败面：getObject 拒绝 → 就地错误提示不抛出；file.size 超限不拉流', async () => {
    const el1 = document.createElement('div')
    const ctx1 = makeCtx('x')
    ctx1.getObject = vi.fn(async () => {
      throw new Error('net')
    })
    const inst1 = (await htmlViewerRenderer(el1, FILE, ctx1)) as AppInstance
    expect(el1.textContent).toBe('T:app.html-load-fail')

    const el2 = document.createElement('div')
    const inst2 = (await htmlViewerRenderer(el2, { ...FILE, size: 21 * 1024 * 1024 }, makeCtx('x'))) as AppInstance
    expect(el2.textContent).toBe('T:app.html-too-large:{"limit":"20 MB"}')
    inst1.dispose()
    inst2.dispose()
  })
})
