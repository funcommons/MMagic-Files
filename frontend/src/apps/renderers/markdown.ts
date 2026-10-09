/**
 * Markdown 渲染器（M2-R1）——内置应用 markdown-renderer 的渲染实现
 * 契约：AppDefinition['renderer']（src/sdk/types.ts §应用模型）
 * 管线：ctx.getObject(file.key) → Blob.text() → markdown-it → el.innerHTML
 * 安全基线：html:false（原样 HTML 一律转义为文本）、linkify:true、typographer:false；
 *          渲染后统一为链接补 target=_blank + rel=noopener（防 tab-nabbing）。
 * mermaid：```mermaid 围栏块渲染后动态 import('mermaid') 尝试增强；
 *          失败（jsdom/弱网）静默降级为普通代码块——绝不进模块顶层，控制 bundle 重量。
 * 超限：契约预览策略文本 > 5MB 只读提示（ctx.t('app.markdown-too-large')），不进渲染管线。
 */
import MarkdownIt from 'markdown-it'
import type { AppCtx, AppDefinition, AppInstance } from '../../sdk/types'

/** 文本类预览上限：5MB（契约预览策略；按 Blob 字节数判定，避免先读全文） */
const MAX_BYTES = 5 * 1024 * 1024

/** 超限提示 i18n 键（文案在宿主 locales 词典；键缺省时 t 回退键名） */
const TOO_LARGE_KEY = 'app.markdown-too-large'

/** markdown-it 单例（无状态可复用）：html:false=安全默认，输入视为可信文档文本仍不执行原样 HTML */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false })

/** mermaid 围栏块选择器：markdown-it 输出形如 <pre><code class="language-mermaid"> */
const MERMAID_SELECTOR = 'pre > code.language-mermaid'

/** 渲染后处理：所有出站链接新窗口打开并断开 opener */
function hardenLinks(root: HTMLElement): void {
  const anchors = root.querySelectorAll('a[href]')
  for (const a of Array.from(anchors)) {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
}

/** mermaid 增强：拿到围栏块后动态 import；任何一步失败都原样保留 markdown-it 输出 */
async function enhanceMermaid(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR))
  if (nodes.length === 0) return
  try {
    // 动态 import：mermaid 体积大，绝不入主 bundle；jsdom/弱网下失败走 catch 降级
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false })
    await mermaid.run({ nodes })
  } catch {
    // 静默降级：保留普通代码块形态，不影响正文其余部分
  }
}

/** 超限只读提示：不读全文、不进渲染管线（契约预览策略） */
function showTooLargeTip(el: HTMLElement, ctx: AppCtx): AppInstance {
  const tip = document.createElement('div')
  tip.className = 'markdown-too-large-tip'
  tip.style.padding = '16px'
  tip.style.color = 'var(--app-text-secondary, #888)'
  tip.textContent = ctx.t(TOO_LARGE_KEY)
  el.replaceChildren(tip)
  return { dispose: () => void (el.innerHTML = '') }
}

/**
 * markdown 渲染器：拉字节流 → 文本 → markdown-it → 内联渲染 + 链接加固 + mermaid 增强
 * 渲染失败（getObject/读文本异常）直接向上抛，由 openFile 链路统一兜底；
 * 本渲染器自身只保证：正常路径返回可清理的 AppInstance，mermaid 增强可失败降级。
 */
export const markdownRenderer: AppDefinition['renderer'] = async (el, file, ctx) => {
  const blob = await ctx.getObject(file.key)

  // 超限：按 Blob 字节数先判，避免读入 5MB+ 全文再渲染
  if (blob.size > MAX_BYTES) {
    return showTooLargeTip(el, ctx)
  }

  const text = await blob.text()
  el.innerHTML = md.render(text)
  hardenLinks(el)
  await enhanceMermaid(el)

  const instance: AppInstance = {
    dispose: () => void (el.innerHTML = ''),
  }
  return instance
}
