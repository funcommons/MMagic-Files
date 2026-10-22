/**
 * 单体化管道（方案 §三）：HTML 文档内所有外部资源 → base64 dataURL 内联。
 * 三道闸中的前两道：open pass（打开时内联）/ save pass（保存前强制复跑 + 剥离漏网外链）。
 * 纯 DOM 逻辑（fetch 可注入 mock）——单测口径。
 */

export interface InlineReport {
  /** 成功内联的资源数 */
  inlined: number
  /** 内联失败的 URL 清单（CORS/404/超时/无基址相对路径） */
  failed: string[]
}

const FETCH_TIMEOUT_MS = 5_000
/** 1×1 透明 GIF：内联失败的 img 占位（保持布局不破） */
export const PLACEHOLDER_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** 已内联形态直接跳过 */
function isDataUrl(u: string): boolean {
  return /^data:/i.test(u)
}

/**
 * 原始 src/href → 可抓取的绝对 URL；不可内联返回 null。
 * - data: 跳过（已内联）
 * - http(s) 绝对 / 协议相对（//） / 站点相对（有 base 时）→ 绝对 URL
 * - blob: 原样返回（同源可 fetch，跨会话死链故也需内联）
 * - 纯相对路径且无 base → null（mem:// 等无基址域无法解析出处，交由调用方占位）
 */
export function resolveInlineUrl(raw: string, base?: string): string | null {
  const u = raw.trim()
  if (!u || isDataUrl(u)) return null
  try {
    if (/^blob:/i.test(u)) return u
    if (/^https?:/i.test(u)) return new URL(u).toString()
    if (u.startsWith('//')) return base ? new URL(`https:${u}`).toString() : null
    if (base) return new URL(u, base).toString()
    return null
  } catch {
    return null
  }
}

async function fetchBlob(url: string, fetcher?: FetchLike): Promise<Blob> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const f = fetcher ?? (globalThis.fetch as unknown as FetchLike)
    const res = await f(url, { signal: ac.signal, credentials: 'omit' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.blob()
  } finally {
    clearTimeout(timer)
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'))
    fr.readAsDataURL(blob)
  })
}

/** 最小 fetch 形状（依赖注入口：单测注入 stub，生产=globalThis.fetch） */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; credentials?: string },
) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob>; text(): Promise<string> }>

/** url → dataURL；失败抛错（调用方决定占位/剥离） */
export async function toDataUrl(url: string, fetcher?: FetchLike): Promise<string> {
  return blobToDataUrl(await fetchBlob(url, fetcher))
}

/** url(...) 匹配（引号/无引号三态） */
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

/**
 * CSS 文本里的 url() 内联：先并发结算全部候选，再同步替换（CSS 字符串串行重写）。
 * 失败的候选保留原样（save pass 的 strip 会兜底剥离）。
 */
async function inlineCssUrls(css: string, base: string | undefined, report: InlineReport, fetcher?: FetchLike): Promise<string> {
  const targets: { whole: string; abs: string }[] = []
  for (const m of css.matchAll(CSS_URL_RE)) {
    const abs = resolveInlineUrl(m[2], base)
    if (abs) targets.push({ whole: m[0], abs })
  }
  if (targets.length === 0) return css
  const settled = await Promise.all(
    targets.map(async (t) => {
      try {
        const d = await toDataUrl(t.abs, fetcher)
        report.inlined += 1
        return d
      } catch {
        report.failed.push(t.abs)
        return null
      }
    }),
  )
  let out = css
  targets.forEach((t, i) => {
    const d = settled[i]
    if (d) out = out.split(t.whole).join(d)
  })
  return out
}

/** img 占位：src 换透明 GIF，失败 URL 记入 data 属性（预览侧 title 提示） */
export function placeholderImg(img: Element, failedUrl: string): void {
  img.setAttribute('src', PLACEHOLDER_DATA_URL)
  img.setAttribute('data-mmx-inline-failed', failedUrl)
  img.removeAttribute('srcset')
}

/** 处理单个 src 系元素（img/source/video/audio/track/iframe） */
async function inlineSrcEl(el: Element, base: string | undefined, report: InlineReport, fetcher?: FetchLike): Promise<void> {
  const raw = el.getAttribute('src')
  if (!raw) return
  const abs = resolveInlineUrl(raw, base)
  if (!abs) {
    // 无基址的相对路径：img 占位，全部计入失败（状态栏汇总提示）
    report.failed.push(raw)
    if (el.tagName === 'IMG') placeholderImg(el, raw)
    return
  }
  try {
    el.setAttribute('src', await toDataUrl(abs, fetcher))
    el.removeAttribute('srcset')
    report.inlined += 1
  } catch {
    report.failed.push(abs)
    if (el.tagName === 'IMG') placeholderImg(el, abs)
  }
}

/**
 * open pass / save pass 共用：遍历文档内联全部外部资源。
 * @param opts.inlineScripts script[src] 是否内联为内联脚本（open pass=true 保留源码语义）
 */
export async function inlineAssets(
  doc: Document,
  opts: { base?: string; inlineScripts?: boolean; fetcher?: FetchLike } = {},
): Promise<InlineReport> {
  const report: InlineReport = { inlined: 0, failed: [] }
  const base = opts.base
  const fetcher = opts.fetcher // 各 job 闭包引用的裸标识符（漏解构=ReferenceError 被吞成 failed）
  const jobs: Promise<void>[] = []

  // 1) src 系元素（iframe 内联后成为 srcdoc 不可达——保留原 src 剥除交给 strip；此处也内联尝试）
  doc.querySelectorAll('img[src], source[src], video[src], audio[src], track[src], iframe[src]').forEach((el) => {
    jobs.push(inlineSrcEl(el, base, report, opts.fetcher))
  })
  // srcset（picture/source/img）：多候选全内联代价高——直接剥除，主 src 由上支内联
  doc.querySelectorAll('img[srcset], source[srcset]').forEach((el) => el.removeAttribute('srcset'))

  // 2) link：stylesheet → 内联 <style>（其中 url() 二次内联）；icon → dataURL（失败剥除）；其余剥除
  doc.querySelectorAll('link[href]').forEach((el) => {
    const rel = (el.getAttribute('rel') ?? '').toLowerCase()
    const href = el.getAttribute('href') ?? ''
    const abs = resolveInlineUrl(href, base)
    if (!abs) {
      report.failed.push(href)
      return
    }
    jobs.push(
      (async () => {
        try {
          if (rel.includes('stylesheet')) {
            const text = await (await fetchBlob(abs, fetcher)).text()
            const style = doc.createElement('style')
            style.textContent = await inlineCssUrls(text, base, report, fetcher)
            el.replaceWith(style)
          } else if (rel.includes('icon')) {
            el.setAttribute('href', await toDataUrl(abs, fetcher))
          } else {
            report.failed.push(abs)
            return
          }
          report.inlined += 1
        } catch {
          report.failed.push(abs)
          el.remove()
        }
      })(),
    )
  })

  // 3) <style> 与 style 属性里的 url()
  doc.querySelectorAll('style').forEach((el) => {
    const css = el.textContent ?? ''
    if (!css.includes('url(')) return
    jobs.push(
      inlineCssUrls(css, base, report, fetcher).then((next) => {
        if (next !== css) el.textContent = next
      }),
    )
  })
  doc.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') ?? ''
    if (!style.includes('url(')) return
    jobs.push(
      inlineCssUrls(style, base, report, fetcher).then((next) => {
        if (next !== style) el.setAttribute('style', next)
      }),
    )
  })

  // 4) script[src] → 内联文本（可选；失败剥除）
  if (opts.inlineScripts) {
    doc.querySelectorAll('script[src]').forEach((el) => {
      const abs = resolveInlineUrl(el.getAttribute('src') ?? '', base)
      if (!abs) return
      jobs.push(
        (async () => {
          try {
            const text = await (await fetchBlob(abs, fetcher)).text()
            const s = doc.createElement('script')
            s.textContent = text
            el.replaceWith(s)
            report.inlined += 1
          } catch {
            report.failed.push(abs)
            el.remove()
          }
        })(),
      )
    })
  }

  await Promise.all(jobs)
  return report
}

/**
 * save pass 兜底（方案 §3.3）：剥离一切仍指向外部（非 data:/blob:/锚点/about:）的资源引用，
 * 返回被剥离清单（toast「已保存，N 项外部资源被移除」）。恒保证落库 HTML 无外链。
 * 注意：<a href> 是跳转语义不是资源引用——预览侧代理处理，不在此剥离。
 */
export function stripExternalAssets(doc: Document): string[] {
  const removed: string[] = []
  const external = (v: string): boolean => {
    const u = v.trim()
    if (!u || isDataUrl(u) || u.startsWith('#') || u.startsWith('about:')) return false
    return true
  }
  doc.querySelectorAll('[src]').forEach((el) => {
    const v = el.getAttribute('src') ?? ''
    if (!external(v)) return
    removed.push(v)
    if (el.tagName === 'IMG') placeholderImg(el, v)
    else el.removeAttribute('src')
  })
  doc.querySelectorAll('link[href]').forEach((el) => {
    const v = el.getAttribute('href') ?? ''
    if (!external(v)) return
    removed.push(v)
    el.remove()
  })
  // CSS url() 残留外链：声明值置 none
  doc.querySelectorAll('style').forEach((el) => {
    const css = el.textContent ?? ''
    const next = css.replace(/url\(\s*(['"]?)(?:https?:|\/\/)[^'")]+\1\s*\)/gi, 'none')
    if (next !== css) el.textContent = next
  })
  doc.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') ?? ''
    const next = style.replace(/url\(\s*(['"]?)(?:https?:|\/\/)[^'")]+\1\s*\)/gi, 'none')
    if (next !== style) el.setAttribute('style', next)
  })
  return removed
}
