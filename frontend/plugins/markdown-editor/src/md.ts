/**
 * Markdown 渲染管线（纯字符串层，无 DOM——单测口径）。
 * 安全基线对齐内置 markdown-renderer：html:false（原样 HTML 转义）、linkify:true、typographer:false；
 * 链接加固（target/rel）在 DOM 层做（render.ts），此处只产出 HTML 字符串。
 * mermaid：fence 渲染钩子拦截 ` ```mermaid ` 围栏 → 占位 div + 源码收集，渲染交给 mermaid.ts。
 */
import MarkdownIt from 'markdown-it'

export interface MermaidBlock {
  /** 占位元素 data-mmid（模块级递增，跨渲染唯一防双实例串扰） */
  id: string
  /** 围栏原文（缓存键与重渲染输入） */
  code: string
}

export interface RenderedMarkdown {
  html: string
  mermaidBlocks: MermaidBlock[]
}

/** markdown-it 单例（无状态可复用） */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

/** mermaid 围栏占位 id 前缀（ 渲染后用 [data-mmid] 定位注入 SVG） */
const MERMAID_ID_PREFIX = 'mm-md-mmd-'
let mermaidSeq = 0

// fence 钩子：lang=mermaid 的围栏不进 <pre><code>，改占位 div；其余围栏走默认渲染
const defaultFence = md.renderer.rules.fence
md.renderer.rules.fence = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]
  const lang = token.info.trim().split(/\s+/)[0]?.toLowerCase()
  if (lang === 'mermaid') {
    const id = `${MERMAID_ID_PREFIX}${(mermaidSeq += 1)}`
    ;(_env as { mmMermaidBlocks?: MermaidBlock[] }).mmMermaidBlocks?.push({ id, code: token.content })
    return `<div class="mm-md-mermaid" data-mmid="${id}"></div>`
  }
  return defaultFence ? defaultFence(tokens, idx, options, _env, self) : self.renderToken(tokens, idx, options)
}

/**
 * markdown → { html, mermaidBlocks }。
 * 纯函数口径（同输入同输出——占位 id 由模块计数器递增，唯一但非确定，测试以正则匹配 id 形态）。
 */
export function renderMarkdown(text: string): RenderedMarkdown {
  const env: { mmMermaidBlocks?: MermaidBlock[] } = { mmMermaidBlocks: [] }
  const html = md.render(text, env)
  return { html, mermaidBlocks: env.mmMermaidBlocks ?? [] }
}
