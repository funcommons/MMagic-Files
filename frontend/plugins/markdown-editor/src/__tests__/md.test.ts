/**
 * md.ts 单测（插件纯逻辑：markdown → HTML 字符串 + mermaid 源码收集，无 DOM）
 * 被测：plugins/markdown-editor/src/md.ts（renderMarkdown）
 * 契约：markdown-it { html:false（原样 HTML 转义为可见文本）, linkify:true, typographer:false }；
 *       fence 钩子拦截 lang=mermaid 围栏 → 占位 div.mm-md-mermaid[data-mmid=mm-md-mmd-N] + 源码收集，
 *       其余围栏走 markdown-it 默认 <pre><code>；占位 id 由模块级计数器递增（跨渲染唯一、非确定，
 *       断言用正则匹配形态 + 数值严格递增，不写死具体数字）。
 * 断言口径备注（先探针实测 markdown-it v15 真实输出再定）：
 *   - javascript: 链接：validateLink 拒绝后整个 inline link 解析失败 → 原样文本、不产出 <a>（v15 实测）；
 *   - <img ... onerror=...>：html:false 转义后 `onerror=alert(1)` 会作为「可见文本」保留（这是转义的目的），
 *     因此 XSS 断言针对「真实标签/真实属性」（/<img\b/、/<[^>]+\sonerror=/），不能断言裸串 onerror= 不存在。
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../md'

// ───────────────────────── 块级与行内结构 ─────────────────────────

describe('基础块级/行内语法', () => {
  it('ATX 标题 → <h1>/<h2>', () => {
    expect(renderMarkdown('# 标题一').html).toBe('<h1>标题一</h1>\n')
    expect(renderMarkdown('## 标题二').html).toBe('<h2>标题二</h2>\n')
  })

  it('无序列表 → <ul><li>', () => {
    expect(renderMarkdown('- 甲\n- 乙\n').html).toBe('<ul>\n<li>甲</li>\n<li>乙</li>\n</ul>\n')
  })

  it('行内代码 → <code>', () => {
    expect(renderMarkdown('用 `code` 标记').html).toBe('<p>用 <code>code</code> 标记</p>\n')
  })

  it('粗体 → <strong>', () => {
    expect(renderMarkdown('**粗体** 文本').html).toBe('<p><strong>粗体</strong> 文本</p>\n')
  })
})

// ───────────────────────── 原样 HTML 注入（html:false 转义） ─────────────────────────

describe('原样 HTML 注入 → 转义为可见文本', () => {
  it('<script> 不以标签形态出现，转义为实体文本', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>')
    // 无真实 script 标签
    expect(html).not.toMatch(/<script\b/i)
    // 转义后的可见文本保留（html:false 的语义：显示源码而非执行）
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('alert(1)')
  })

  it('<img src=x onerror=...> 不产出真实 img 标签/属性，只剩实体文本', () => {
    const { html } = renderMarkdown('<img src=x onerror=alert(1)>')
    // 无真实 img 标签；无任何真实标签携带 onerror 属性
    // （注：不能断言裸串 "onerror=" 不存在——转义后它是可见文本，禁止的是标签形态）
    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toMatch(/<[^>]+\sonerror=/i)
    // 转义后的可见文本
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

// ───────────────────────── 链接 ─────────────────────────

describe('链接', () => {
  it('普通 http 链接 → <a href>', () => {
    // 链接加固（target/rel）在 DOM 层 render.ts，此处只断言字符串层 href
    expect(renderMarkdown('[a](https://x.com)').html).toContain('<a href="https://x.com"')
  })

  it('javascript: 链接 → markdown-it v15 默认：拒绝后不产出 <a>，原样为文本', () => {
    for (const label of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))']) {
      const { html } = renderMarkdown(label)
      expect(html).not.toMatch(/<a\b/i)
      expect(html).not.toContain('href')
      // inline link 解析整体失败 → 方括号原文保留
      expect(html).toContain(label)
    }
  })
})

// ───────────────────────── 围栏：普通 vs mermaid ─────────────────────────

describe('普通代码围栏（不被 mermaid 钩子拦截）', () => {
  it('```py → 默认 <pre><code class="language-py">，不收集 mermaidBlocks', () => {
    const { html, mermaidBlocks } = renderMarkdown('```py\nprint(1)\n```\n')
    expect(html).toBe('<pre><code class="language-py">print(1)\n</code></pre>\n')
    expect(html).not.toMatch(/mm-md-mermaid/)
    expect(mermaidBlocks).toEqual([])
  })
})

describe('mermaid 围栏 → 占位 div + 源码收集', () => {
  it('占位 div 形态正确、不进 <pre><code>，code 为围栏原文（含换行结构）', () => {
    const { html, mermaidBlocks } = renderMarkdown('前文\n\n```mermaid\ngraph TD\nA-->B\n```\n\n后文\n')
    // 占位 div（id 非确定，按形态正则匹配）
    expect(html).toMatch(/<div class="mm-md-mermaid" data-mmid="mm-md-mmd-\d+"><\/div>/)
    expect(html).not.toContain('<pre><code class="language-mermaid">')
    // 前后普通段落不受影响
    expect(html).toContain('<p>前文</p>')
    expect(html).toContain('<p>后文</p>')
    // 收集：长度 1 + 围栏原文（token.content 原样，含首尾换行结构）+ id 与占位一致
    expect(mermaidBlocks).toHaveLength(1)
    expect(mermaidBlocks[0].code).toBe('graph TD\nA-->B\n')
    const inHtml = html.match(/data-mmid="(mm-md-mmd-\d+)"/)?.[1]
    expect(mermaidBlocks[0].id).toBe(inHtml)
    expect(mermaidBlocks[0].id).toMatch(/^mm-md-mmd-\d+$/)
  })

  it('多个 mermaid 块 → 数量/顺序一致，id 互不相同', () => {
    const codes = ['graph TD\nA-->B\n', 'sequenceDiagram\nA->>B: hi\n', 'pie\n"甲": 1\n']
    // 围栏间用独立段落分隔（闭合围栏行不能带其他文本，否则按 CommonMark 不算闭合）
    const src = codes.map((c) => '```mermaid\n' + c + '```\n').join('\n中间段落\n\n')
    const { html, mermaidBlocks } = renderMarkdown(src)
    // 数量一致：3 个占位 div、3 条收集
    expect(mermaidBlocks).toHaveLength(3)
    expect(html.match(/class="mm-md-mermaid"/g)).toHaveLength(3)
    // 顺序一致：html 中占位出现顺序 === 收集数组顺序 === 文档顺序
    const htmlIds = [...html.matchAll(/data-mmid="(mm-md-mmd-\d+)"/g)].map((m) => m[1])
    expect(htmlIds).toEqual(mermaidBlocks.map((b) => b.id))
    expect(mermaidBlocks.map((b) => b.code)).toEqual(codes)
    // id 互不相同
    expect(new Set(htmlIds).size).toBe(3)
  })

  it('混合围栏：只有 lang=mermaid 被收集，py 围栏照常渲染', () => {
    const { html, mermaidBlocks } = renderMarkdown('```py\nprint(1)\n```\n\n```mermaid\ngraph LR\nX-->Y\n```\n')
    expect(mermaidBlocks).toHaveLength(1)
    expect(mermaidBlocks[0].code).toBe('graph LR\nX-->Y\n')
    expect(html).toContain('<pre><code class="language-py">')
    expect(html).toMatch(/<div class="mm-md-mermaid" data-mmid="mm-md-mmd-\d+"><\/div>/)
  })
})

// ───────────────────────── 跨渲染 id 唯一（模块级计数器） ─────────────────────────

describe('跨渲染占位 id 唯一', () => {
  it('两次 renderMarkdown 各含 mermaid 块 → id 不重复且计数器递增', () => {
    const a = renderMarkdown('```mermaid\nA\n```')
    const b = renderMarkdown('```mermaid\nA\n```')
    const ids = [...a.mermaidBlocks, ...b.mermaidBlocks].map((m) => m.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    // 模块计数器单调递增：后一次渲染的 id 数值严格大于前一次
    const numA = Number(a.mermaidBlocks[0]!.id.match(/(\d+)$/)![1])
    const numB = Number(b.mermaidBlocks[0]!.id.match(/(\d+)$/)![1])
    expect(numB).toBeGreaterThan(numA)
  })
})

// ───────────────────────── linkify ─────────────────────────

describe('linkify（纯文本 URL 自动成链）', () => {
  it('纯文本中的 URL → <a href>，链接文本为原文', () => {
    const { html } = renderMarkdown('见 https://example.com/a?b=1 即可')
    expect(html).toBe('<p>见 <a href="https://example.com/a?b=1">https://example.com/a?b=1</a> 即可</p>\n')
  })
})
