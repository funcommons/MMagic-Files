/**
 * HTML 预览渲染器（内置应用 html-viewer）——html/htm 的默认打开应用（注册序先于 code-editor）。
 * 预览语义与 html-editor 插件「预览」态同口径（htmlSandbox.ts 复刻）：
 * - 净化式静态预览：sandbox="allow-scripts" + srcdoc（剥脚本面；拦截脚本是唯一脚本）
 * - 一切跳转/打开统一代理为「提示确认后新 tab 打开」：message（event.source===iframe）→
 *   normalizeOpenUrl 白名单 → 会话级信任域名直接开 / 否则确认条（复用 app.html-open-* 词典键）
 * - 拒绝面：非法 scheme → notify('html-open-rejected')；文件拉取/读失败 → 就地错误提示（pdf/csv 口径）
 * 布局：el 注入 relative → root absolute inset:0（code.ts 同口径）；iframe 满区 + 确认条底部浮层。
 * 生命周期：dispose=摘 message 监听（AbortController）+ 清容器。
 */
import type { AppCtx, AppDefinition } from '../../sdk/types'
import { buildPreviewDoc, normalizeOpenUrl, parseOpenRequest, PREVIEW_SANDBOX } from './htmlSandbox'

/** 预览上限：对齐 html-editor 插件口径（20MB——html 资产内联后的合理上界） */
const HTML_VIEWER_MAX_BYTES = 20 * 1024 * 1024

/** 会话级「不再询问」域名表（模块级：同页多实例共享；不持久化——同插件口径） */
const trustedOrigins = new Set<string>()

const VIEWER_CSS = `
.mmagix-html-viewer { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; background: var(--app-bg-page, #f2f3f5); }
.mmagix-html-viewer__frame { flex: 1 1 auto; min-height: 0; width: 100%; border: none; background: var(--app-bg-card, #fff); }
.mmagix-html-viewer__confirm { display: none; flex: none; align-items: center; gap: 10px; padding: 8px 12px; border-top: 1px solid var(--app-separator, rgba(127,127,127,.2)); background: var(--app-bg-card, #fffdf5); font-size: 12px; color: var(--app-text-primary, #1f2328); box-shadow: 0 -2px 8px rgba(0,0,0,.06); }
.mmagix-html-viewer__confirm[data-active='true'] { display: flex; }
.mmagix-html-viewer__confirm-url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-text-secondary, #57606a); }
.mmagix-html-viewer__confirm button { padding: 3px 10px; border: 1px solid var(--app-separator, rgba(127,127,127,.3)); border-radius: var(--app-radius-button, 5px); background: var(--app-bg-card, #fff); color: var(--app-text-primary); cursor: pointer; font-size: 12px; }
.mmagix-html-viewer__confirm button.is-primary { background: var(--app-primary, #1f6feb); border-color: var(--app-primary, #1f6feb); color: #fff; }
.mmagix-html-viewer__confirm label { display: inline-flex; align-items: center; gap: 4px; color: var(--app-text-secondary, #57606a); cursor: pointer; white-space: nowrap; }
.mmagix-html-viewer__tip { padding: 16px; color: var(--app-text-secondary, #888); font-size: 13px; }
`

/** 失败/超限提示节点（pdf/csv 同款失败面：就地提示，不向调用侧抛） */
function showTip(el: HTMLElement, ctx: AppCtx, key: string, params?: Record<string, unknown>): { dispose(): void } {
  const tip = document.createElement('div')
  tip.className = 'mmagix-html-viewer__tip'
  tip.textContent = ctx.t(key, params)
  el.replaceChildren(tip)
  return { dispose: () => el.replaceChildren() }
}

export const htmlViewerRenderer: AppDefinition['renderer'] = async (el, file, ctx) => {
  // 字节流（file.size 预检超限不拉流）
  if (file.size > HTML_VIEWER_MAX_BYTES) {
    return showTip(el, ctx, 'app.html-too-large', { limit: '20 MB' })
  }
  let text: string
  try {
    const blob = await ctx.getObject(file.key)
    if (blob.size > HTML_VIEWER_MAX_BYTES) {
      return showTip(el, ctx, 'app.html-too-large', { limit: '20 MB' })
    }
    text = await blob.text()
  } catch {
    return showTip(el, ctx, 'app.html-load-fail')
  }

  // 骨架：root（relative 锚）+ iframe + 确认条
  el.style.position = 'relative'
  const root = document.createElement('div')
  root.className = 'mmagix-html-viewer'
  const styleEl = document.createElement('style')
  styleEl.textContent = VIEWER_CSS
  const frame = document.createElement('iframe')
  frame.className = 'mmagix-html-viewer__frame'
  frame.setAttribute('sandbox', PREVIEW_SANDBOX)
  frame.setAttribute('srcdoc', buildPreviewDoc(text))
  frame.title = file.name

  const confirmBar = document.createElement('div')
  confirmBar.className = 'mmagix-html-viewer__confirm'
  confirmBar.dataset.active = 'false'
  const confirmText = document.createElement('span')
  confirmText.className = 'mmagix-html-viewer__confirm-url'
  const confirmTrust = document.createElement('label')
  const confirmTrustBox = document.createElement('input')
  confirmTrustBox.type = 'checkbox'
  confirmTrust.appendChild(confirmTrustBox)
  confirmTrust.appendChild(document.createTextNode(ctx.t('app.html-open-trust')))
  const btnNo = document.createElement('button')
  btnNo.type = 'button'
  btnNo.textContent = ctx.t('app.html-open-cancel')
  const btnYes = document.createElement('button')
  btnYes.type = 'button'
  btnYes.className = 'is-primary'
  btnYes.textContent = ctx.t('app.html-open-open')
  confirmBar.append(confirmText, confirmTrust, btnNo, btnYes)
  root.append(styleEl, frame, confirmBar)
  el.replaceChildren(root)

  const ac = new AbortController()
  /** 待打开 URL（确认条在显 = 非空） */
  let pendingUrl: string | null = null

  const openExternal = (abs: string): void => {
    window.open(abs, '_blank', 'noopener,noreferrer')
  }
  const hideConfirm = (): void => {
    pendingUrl = null
    confirmTrustBox.checked = false
    confirmBar.dataset.active = 'false'
  }

  // 跳转代理：message 校验 source===iframe → 白名单 → 信任域名直开 / 确认条
  window.addEventListener(
    'message',
    (ev) => {
      if (ev.source !== frame.contentWindow) return
      const req = parseOpenRequest(ev.data)
      if (!req) return
      const abs = normalizeOpenUrl(req.url)
      if (!abs) {
        ctx.notify('html-open-rejected', { url: req.url })
        return
      }
      let origin: string
      try {
        origin = new URL(abs).origin
      } catch {
        ctx.notify('html-open-rejected', { url: req.url })
        return
      }
      if (trustedOrigins.has(origin)) {
        openExternal(abs)
        return
      }
      pendingUrl = abs
      confirmText.textContent = ctx.t('app.html-open-confirm', {
        url: abs.length > 80 ? abs.slice(0, 80) + '…' : abs,
      })
      confirmBar.dataset.active = 'true'
    },
    { signal: ac.signal },
  )

  btnYes.addEventListener(
    'click',
    () => {
      const abs = pendingUrl
      if (abs) {
        if (confirmTrustBox.checked) {
          try {
            trustedOrigins.add(new URL(abs).origin)
          } catch {
            /* 不可能：abs 已 normalize */
          }
        }
        openExternal(abs)
      }
      hideConfirm()
    },
    { signal: ac.signal },
  )
  btnNo.addEventListener('click', hideConfirm, { signal: ac.signal })

  return {
    dispose: () => {
      ac.abort()
      el.replaceChildren()
      el.style.removeProperty('position')
    },
  }
}
