/** sandbox.ts 单测：净化（script、on* 事件、javascript: 链接、meta refresh、base）/拦截脚本注入/URL 白名单 */
import { describe, expect, it } from 'vitest'
import { buildPreviewDoc, normalizeOpenUrl, parseOpenRequest, PREVIEW_SANDBOX, sanitizeForPreview } from '../sandbox'

describe('sanitizeForPreview', () => {
  it('剥 <script>/on* 事件/javascript: href/meta refresh/base/object', () => {
    const out = sanitizeForPreview(`<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=https://evil.com">
      <base href="https://evil.com/">
      <script>alert(1)<\/script>
      </head><body>
      <button onclick="steal()">go</button>
      <a href="javascript:evil()">a</a>
      <a href="https://ok.com/x">b</a>
      <object data="x"></object>
      <p>keep</p>
      </body></html>`)
    expect(out).not.toContain('<script')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('refresh')
    expect(out).not.toContain('<base')
    expect(out).not.toContain('<object')
    expect(out).toContain('keep')
    expect(out).toContain('https://ok.com/x')
  })

  it('净化后注入唯一拦截脚本（buildPreviewDoc）；PREVIEW_SANDBOX 不含 top-navigation/popups', () => {
    const doc = buildPreviewDoc('<p>hi</p>')
    const scripts = doc.match(/<script>/g)?.length ?? 0
    expect(scripts).toBe(1) // 净化剥光 + 注入 1 个拦截脚本
    expect(doc).toContain('open-request')
    expect(PREVIEW_SANDBOX).not.toContain('allow-same-origin')
    expect(PREVIEW_SANDBOX).not.toContain('allow-top-navigation')
    expect(PREVIEW_SANDBOX).not.toContain('allow-popups')
  })
})

describe('open-request 消息与 URL 白名单', () => {
  it('parseOpenRequest：ns/type/url 三重校验', () => {
    expect(parseOpenRequest({ ns: 'mm-html-editor', type: 'open-request', url: 'https://a.com' })).toEqual({ url: 'https://a.com' })
    expect(parseOpenRequest({ ns: 'other', type: 'open-request', url: 'https://a.com' })).toBeNull()
    expect(parseOpenRequest({ ns: 'mm-html-editor', type: 'open-request', url: '' })).toBeNull()
    expect(parseOpenRequest('str')).toBeNull()
  })
  it('normalizeOpenUrl：仅 http/https；javascript:/data: 拒；协议相对按 https', () => {
    expect(normalizeOpenUrl('https://a.com/x')).toBe('https://a.com/x')
    expect(normalizeOpenUrl('http://a.com')).toBe('http://a.com/')
    expect(normalizeOpenUrl('//a.com/x')).toBe('https://a.com/x')
    expect(normalizeOpenUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeOpenUrl('data:text/html,x')).toBeNull()
    expect(normalizeOpenUrl('')).toBeNull()
  })
})
