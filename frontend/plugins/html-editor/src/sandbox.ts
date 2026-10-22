/**
 * 预览沙箱（方案 §四）：净化式静态预览 + 一切跳转 → 「提示后新标签页打开」。
 * - sanitizeForPreview：剥 <script>/on* 内联事件/javascript: href/<meta refresh>/<base>/object|embed
 *   （DOMParser 解析不执行脚本——净化自身零执行风险）
 * - buildPreviewDoc：净化 + 注入唯一保留的拦截脚本（a 点击/form submit → postMessage 给父）
 * - 沙箱 iframe 属性：sandbox="allow-scripts"（无 allow-same-origin/allow-top-navigation/allow-popups）
 * - 残余边界（方案 §4.3）：净化后无脚本 → location 跳转/弹窗不存在；导航类沙箱属性全关
 */

/** 预览 iframe 的 sandbox 属性值（常量导出供 render.ts 使用） */
export const PREVIEW_SANDBOX = 'allow-scripts'

/** 父↔沙箱消息命名空间（postMessage 双向校验） */
export const MSG_NS = 'mm-html-editor'

/** 需要整体移除的元素（脚本执行面 / 元刷新 / 可嵌恶意文档的容器） */
const REMOVE_SELECTORS = [
  'script',
  'noscript',
  'meta[http-equiv="refresh" i]',
  'meta[http-equiv="set-cookie" i]',
  'base[href]', // 防改写相对跳转基址
  'object, embed, applet',
]

/** 内联事件属性前缀（on*） */
function isEventAttr(name: string): boolean {
  return name.toLowerCase().startsWith('on')
}

/** javascript:/vbscript: 系危险 scheme */
function isScriptScheme(url: string): boolean {
  return /^\s*(javascript|vbscript|data:text\/html)/i.test(url)
}

/** 清掉元素上的危险属性（on* 与 script-scheme URL），返回是否整体该移除 */
function scrubAttrs(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase()
    if (isEventAttr(name)) {
      el.removeAttribute(attr.name)
      continue
    }
    const value = attr.value
    if ((name === 'href' || name === 'src' || name === 'xlink:href') && isScriptScheme(value)) {
      if (tag === 'a' && name === 'href') {
        el.setAttribute('href', '#') // 链接降级为锚点（拦截脚本按无外链处理）
      } else {
        el.removeAttribute(attr.name)
      }
    }
  }
  return false
}

/**
 * 预览净化：返回净化后的完整 HTML 字符串（结构保留，脚本面清零）。
 * 解析失败（理论不发生，DOMParser 容错）原样返回。
 */
export function sanitizeForPreview(html: string): string {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return html
  }
  for (const sel of REMOVE_SELECTORS) {
    doc.querySelectorAll(sel).forEach((el) => el.remove())
  }
  doc.querySelectorAll('*').forEach((el) => scrubAttrs(el))
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

/**
 * 沙箱内拦截脚本（唯一保留的脚本）：
 * - a[href] 点击 / form submit → postMessage(open-request) 给父窗口（url 原样上送，父侧校验）
 * - 锚点（#x）不外出：同文档滚动
 * - target=_blank 同样拦截（浏览器弹窗被 sandbox 无 allow-popups 兜底）
 */
const INTERCEPT_SCRIPT = `<script>(function(){
  var NS='${MSG_NS}';
  function send(u){ try{ parent.postMessage({ ns:NS, type:'open-request', url:u }, '*'); }catch(e){} }
  document.addEventListener('click', function(e){
    var a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    var href=a.getAttribute('href')||'';
    if(href.charAt(0)==='#'){
      e.preventDefault();
      var t=document.getElementById(href.slice(1))||document.getElementsByName(href.slice(1))[0];
      if(t&&t.scrollIntoView) t.scrollIntoView({behavior:'smooth'});
      return;
    }
    e.preventDefault();
    send(a.href||href);
  }, true);
  document.addEventListener('submit', function(e){
    e.preventDefault();
    send(location.href);
  }, true);
  window.open=function(u){ if(u) send(String(u)); return null; };
})();</script>`

/**
 * 生成预览 srcdoc：净化 + 注入拦截脚本。
 * 净化已剥全部脚本 → 拦截脚本是文档内唯一脚本（静态排版 + 跳转上送）。
 */
export function buildPreviewDoc(html: string): string {
  const clean = sanitizeForPreview(html)
  // 注入到 </body> 前（无 body 的片段 DOMParser 会补全结构）
  const i = clean.lastIndexOf('</body>')
  if (i === -1) return clean + INTERCEPT_SCRIPT
  return clean.slice(0, i) + INTERCEPT_SCRIPT + clean.slice(i)
}

/** 预览发来的 open-request 是否可信：ns/type 匹配（source 校验在消费侧用 event.source===iframe.contentWindow） */
export interface OpenRequest {
  url: string
}

export function parseOpenRequest(data: unknown): OpenRequest | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.ns !== MSG_NS || d.type !== 'open-request') return null
  if (typeof d.url !== 'string' || d.url === '') return null
  return { url: d.url }
}

/**
 * 新标签页 URL 白名单（方案 §4.2）：仅 http/https；协议相对（//）按 https 处理。
 * data:/javascript:/怪 scheme 一律拒绝。
 */
export function normalizeOpenUrl(raw: string): string | null {
  const u = raw.trim()
  if (!u) return null
  try {
    const abs = u.startsWith('//') ? new URL(`https:${u}`) : new URL(u)
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null
    return abs.toString()
  } catch {
    return null
  }
}
