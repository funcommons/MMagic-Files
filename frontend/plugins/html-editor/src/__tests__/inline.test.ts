/** inline.ts 单测：URL 解析/内联管道（mock fetch）/save pass 剥离（方案 §三三道闸） */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inlineAssets, PLACEHOLDER_DATA_URL, resolveInlineUrl, stripExternalAssets } from '../inline'

/** 注入式 fetcher stub：按 URL 返回 Blob/文本/失败（绕开环境 Response 实现差异） */
type Route = Blob | string | 'FAIL'
function makeFetcher(routes: Record<string, Route>) {
  return vi.fn(async (url: string) => {
    const body = routes[url]
    if (body === 'FAIL' || body === undefined) return { ok: false, status: 404, blob: async () => new Blob(), text: async () => 'nope' }
    const blob = body instanceof Blob ? body : new Blob([body])
    return { ok: true, status: 200, blob: async () => blob, text: async () => (body instanceof Blob ? '' : body) }
  })
}

describe('resolveInlineUrl', () => {
  it('data: 跳过（已内联）→ null', () => {
    expect(resolveInlineUrl('data:image/png;base64,xx')).toBeNull()
  })
  it('http(s)/协议相对/相对路径+base → 绝对 URL', () => {
    expect(resolveInlineUrl('https://a.com/x.png')).toBe('https://a.com/x.png')
    expect(resolveInlineUrl('//a.com/x.png', 'https://o.com/p/')).toBe('https://a.com/x.png')
    expect(resolveInlineUrl('img/x.png', 'https://o.com/p/')).toBe('https://o.com/p/img/x.png')
  })
  it('相对路径无 base → null（mem:// 无基址域不可解析）', () => {
    expect(resolveInlineUrl('img/x.png')).toBeNull()
  })
  it('blob: 原样返回（同源可 fetch，跨会话死链需内联）', () => {
    expect(resolveInlineUrl('blob:https://o.com/abc')).toBe('blob:https://o.com/abc')
  })
})

describe('inlineAssets（open pass）', () => {
  it('img 外链 → dataURL；srcset 剥除；CORS 失败 → 占位+data 属性', async () => {
    const png = new Blob(['png-bytes'], { type: 'image/png' })
    const fetcher = makeFetcher({ 'https://cdn.com/ok.png': png, 'https://cdn.com/bad.png': 'FAIL' })
    const doc = new DOMParser().parseFromString(
      '<div><img src="https://cdn.com/ok.png" srcset="a.png 1x"><img src="https://cdn.com/bad.png"></div>',
      'text/html',
    )
    const [okImg, badImg] = [...doc.querySelectorAll('img')]
    const r = await inlineAssets(doc, { fetcher })
    expect(r.inlined).toBe(1)
    expect(okImg.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(okImg.hasAttribute('srcset')).toBe(false)
    expect(badImg.getAttribute('src')).toBe(PLACEHOLDER_DATA_URL)
    expect(badImg.getAttribute('data-mmx-inline-failed')).toBe('https://cdn.com/bad.png')
    expect(r.failed).toContain('https://cdn.com/bad.png')
  })

  it('link stylesheet → 内联 <style>（其中 url() 二次内联）；script[src] 内联为文本', async () => {
    const css = new Blob(['body{background:url(https://cdn.com/bg.png)}'], { type: 'text/css' })
    const js = new Blob(['console.log(1)'], { type: 'text/javascript' })
    const png = new Blob(['bg'], { type: 'image/png' })
    const fetcher = makeFetcher({ 'https://cdn.com/a.css': css, 'https://cdn.com/app.js': js, 'https://cdn.com/bg.png': png })
    const doc = new DOMParser().parseFromString(
      '<head><link rel="stylesheet" href="https://cdn.com/a.css"></head><body><script src="https://cdn.com/app.js"></script></body>',
      'text/html',
    )
    const r = await inlineAssets(doc, { inlineScripts: true, fetcher })
    expect(r.inlined).toBe(3)
    expect(doc.querySelector('style')?.textContent).toMatch(/data:image\/png;base64,/)
    expect(doc.querySelector('script')?.textContent).toBe('console.log(1)')
    expect(doc.querySelector('script')?.hasAttribute('src')).toBe(false)
  })

  it('无基址相对路径 img → 占位并记失败；meta refresh 不归本管道（sandbox 负责）', async () => {
    const doc = new DOMParser().parseFromString('<img src="local/pic.png">', 'text/html')
    const r = await inlineAssets(doc, { fetcher: makeFetcher({}) })
    expect(r.failed).toContain('local/pic.png')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(PLACEHOLDER_DATA_URL)
  })
})

describe('stripExternalAssets（save pass 兜底）', () => {
  it('外链 src/href 剥离并返回清单；data:/锚点保留；CSS 外链 url() 置 none', () => {
    const doc = new DOMParser().parseFromString(
      `<div>
        <img src="https://x.com/a.png">
        <img src="data:image/png;base64,xx">
        <img src="#anchor">
        <link rel="stylesheet" href="https://x.com/b.css">
        <a href="https://x.com/page">link（跳转语义不剥）</a>
        <style>.a{background:url(https://x.com/c.png)}.b{background:url(data:image/gif;base64,xx)}</style>
      </div>`,
      'text/html',
    )
    const removed = stripExternalAssets(doc)
    expect(removed).toEqual(['https://x.com/a.png', 'https://x.com/b.css'])
    const imgs = [...doc.querySelectorAll('img')]
    expect(imgs[0]!.getAttribute('src')).toBe(PLACEHOLDER_DATA_URL)
    expect(imgs[1]!.getAttribute('src')).toMatch(/^data:/)
    expect(imgs[2]!.getAttribute('src')).toBe('#anchor')
    expect(doc.querySelector('link')).toBeNull()
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://x.com/page')
    const css = doc.querySelector('style')!.textContent!
    expect(css).toContain('none')
    expect(css).toContain('data:image/gif')
  })
})
