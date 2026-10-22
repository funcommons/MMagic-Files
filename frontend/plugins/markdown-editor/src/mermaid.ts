/**
 * mermaid 懒装配：首次用到才 import+initialize（模块顶层零 mermaid 引用，
 * 构建期 inlineDynamicImports 会内联但执行期推迟到首块渲染——失败不阻塞编辑器本体）。
 * 同码缓存（code→svg）：双窗防抖重渲染时未改动的图不重画，防闪烁。
 * 单块失败：静默降级普通代码块（textContent 注入防 HTML 逃逸），不中断其余块、无错误 UI。
 */

type MermaidApi = {
  initialize(config: Record<string, unknown>): void
  render(id: string, code: string): Promise<{ svg: string }>
}

let api: MermaidApi | null = null
let booting: Promise<MermaidApi> | null = null

async function getMermaid(): Promise<MermaidApi> {
  if (api) return api
  booting ??= import('mermaid').then((m) => {
    const mod = m.default as unknown as MermaidApi
    // suppressErrorRendering：mermaid 12 在 render() 解析失败时会自行向 DOM 注入全幅「炸弹」错误图——
    // 关掉，失败呈现统一走本插件的紧凑错误框（单块失败不劫持整页视野）
    mod.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true })
    api = mod
    return mod
  })
  return booting
}

/** code→svg 缓存（模块级：多 tab/多次渲染共享） */
const svgCache = new Map<string, string>()

export function clearMermaidCache(): void {
  svgCache.clear()
}

function findPlaceholder(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`.mm-md-mermaid[data-mmid="${id}"]`)
}

/** 失败静默降级：还原成普通代码围栏（markdown-it 默认形态，textContent 注入防 HTML 逃逸），不展示错误 UI */
function mountCodeFallback(slot: HTMLElement, code: string): void {
  slot.replaceChildren()
  const pre = document.createElement('pre')
  pre.setAttribute('data-mm-mermaid-fallback', '1')
  const codeEl = document.createElement('code')
  codeEl.className = 'language-mermaid'
  codeEl.textContent = code
  pre.appendChild(codeEl)
  slot.appendChild(pre)
}

function mountSvg(slot: HTMLElement, svg: string): void {
  slot.replaceChildren()
  const holder = document.createElement('div')
  holder.className = 'mm-md-mermaid-svg'
  holder.setAttribute('data-mm-mermaid-svg', '1')
  holder.innerHTML = svg // mermaid 输出的受信 SVG（securityLevel:strict）
  slot.appendChild(holder)
}

/**
 * 渲染 root 内全部占位块。逐块独立 try/catch：一图语法错不影响其余图与正文。
 * 返回 { ok, failed } 计数（E2E/调用方可断言）。
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  blocks: { id: string; code: string }[],
): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  if (blocks.length === 0) return { ok, failed }
  let mod: MermaidApi | null = null
  try {
    mod = await getMermaid()
  } catch {
    // mermaid 装载失败：全部占位静默降级普通代码块
    for (const b of blocks) {
      const slot = findPlaceholder(root, b.id)
      if (slot) mountCodeFallback(slot, b.code)
      failed += 1
    }
    return { ok, failed }
  }
  await Promise.all(
    blocks.map(async (b) => {
      const slot = findPlaceholder(root, b.id)
      if (!slot) return
      const cached = svgCache.get(b.code)
      if (cached) {
        mountSvg(slot, cached)
        ok += 1
        return
      }
      try {
        const { svg } = await mod.render(b.id, b.code)
        svgCache.set(b.code, svg)
        mountSvg(slot, svg)
        ok += 1
      } catch {
        mountCodeFallback(slot, b.code)
        failed += 1
      }
    }),
  )
  return { ok, failed }
}
