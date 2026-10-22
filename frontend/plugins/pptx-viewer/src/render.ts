/**
 * pptx 预览渲染器：pptx-preview（纯前端 DOM 复刻，中上保真；高保真 LibreOffice→PDF 路线留作部署升级项）。
 * 链路：ctx.getObject → arrayBuffer → 动态 import('pptx-preview')（闭源 npm 产物内联进单体，
 * 只依赖不修改不重分发源码）→ init(wrapper, {width, height}) → previewer.preview(buffer)。
 * 自适应：pptx-preview 的 init 固定渲染宽高（无 resize API）——首帧按容器宽 init（16:9 推导高），
 * ResizeObserver 防抖 300ms 后整建重建（buffer 缓存零重复拉取，重建成本可接受）。
 * 布局红线（code.ts 同口径）：el 注入 relative → root absolute inset:0 填满宿主预览区，
 * wrapper overflow:auto 纵向滚多页；底色走宿主 CSS 变量（light/dark 随宿主）。
 * 错误面：字节流失败/解析抛错 → 就地错误提示（ctx 无错误通道，同 code.ts too-large 口径）。
 */
import type { HostCtx, HostInstance, PptxPreviewer } from './types'

/** 容器渲染宽度边界（px）：pptx-preview 按给定宽等比渲染——太窄文字不可读、太宽横向溢出 */
const RENDER_WIDTH_MIN = 480
const RENDER_WIDTH_MAX = 1400

/** resize 重建防抖（ms）：pptx-preview 无 resize API，窗口拖动中频繁重建浪费 */
const RESIZE_DEBOUNCE_MS = 300

/** pptx 宽高比缺省（16:9——init 的 height 仅作占位，库内部按 slide 实际尺寸渲染） */
const SLIDE_RATIO = 9 / 16

/** 渲染宽度自适应：容器可用宽（留滚动条余量）夹取边界 */
export function resolveRenderWidth(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 960
  return Math.min(RENDER_WIDTH_MAX, Math.max(RENDER_WIDTH_MIN, Math.round(containerWidth - 24)))
}

/** 超限/错误提示节点（不建 previewer、无工具栏；文案走 ctx.t 词典键） */
export function renderTip(el: HTMLElement, ctx: HostCtx, key: string, params?: Record<string, unknown>): HostInstance {
  const tip = document.createElement('div')
  tip.className = 'pptx-viewer-tip'
  tip.style.cssText = 'padding:16px;color:var(--app-text-secondary, #888);font-size:13px;'
  tip.textContent = ctx.t(key, params)
  el.replaceChildren(tip)
  return { dispose: () => el.replaceChildren() }
}

/**
 * 预览器装配：build(el, buffer, opts) 可重复调用（resize 重建复用同一 buffer）。
 * 返回 { instance, rebuild }——rebuild 供 ResizeObserver 防抖后重渲染，instance.dispose 统一收口。
 */
export async function renderPptx(
  el: HTMLElement,
  ctx: HostCtx,
  buffer: ArrayBuffer,
  onParseError: () => void,
): Promise<HostInstance> {
  el.style.position = 'relative' // 布局红线：root absolute 定位锚（code.ts 同口径）
  const root = document.createElement('div')
  root.className = 'pptx-viewer'
  root.style.cssText =
    'position:absolute;inset:0;overflow:auto;background:var(--app-bg-page, #f2f3f5);display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px;'
  el.replaceChildren(root)

  const { init } = await import('pptx-preview')
  let previewer: PptxPreviewer | undefined
  let disposed = false

  const build = (): void => {
    if (disposed) return
    root.replaceChildren()
    const page = document.createElement('div')
    page.className = 'pptx-viewer__page'
    page.style.cssText = 'box-shadow:0 2px 12px rgba(0,0,0,.14);background:var(--app-bg-card, #fff);'
    root.appendChild(page)
    const width = resolveRenderWidth(root.clientWidth || el.clientWidth)
    try {
      previewer = init(page, { width, height: Math.round(width * SLIDE_RATIO) })
      previewer.preview(buffer)
    } catch (err) {
      console.warn('[pptx-viewer] render failed:', String(err)?.slice(0, 160))
      onParseError()
      page.remove()
    }
  }
  build()

  // resize 自适应：pptx-preview 无 resize API——防抖后整建重建（buffer 已缓存）
  let timer: ReturnType<typeof setTimeout> | undefined
  const ro = new ResizeObserver(() => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      build()
    }, RESIZE_DEBOUNCE_MS)
  })
  ro.observe(root)

  return {
    dispose: () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      ro.disconnect()
      previewer = undefined
      el.replaceChildren()
      el.style.removeProperty('position')
    },
  }
}
