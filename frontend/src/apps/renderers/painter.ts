/**
 * 图片画板渲染器（内置应用 image-painter 的 renderer，M2-R6，计划表最后一个内置应用）
 * 契约：《documents/第一期文件类型支持计划.md》§一（image-painter 行）+
 *       《动态插件方案.md》V1.1 §二 ctx 能力面 + AppInstance 生命周期。
 *
 * 数据流：挂载（canvas 白底 + 工具条）→ ctx.getObject(key) 底图异步加载（不挡 AppInstance 返回，
 *       对齐 image.ts 口径）→ <img> 解码 → 按画布等比居中绘制为底；任一环节失败 → 空白画布继续（可从零画）。
 * 绘制：pointerdown/move/up 手绘（lineTo + round cap/join）；按下即置 dirty；清空钮也置 dirty。
 * 保存（Lane F6 格式保留）：pickExportFormat 按原文件扩展名选 mime——png→image/png、
 *       jpg/jpeg→image/jpeg(0.92)、其余（svg 等）维持 PNG（canvas 位图无法回写 svg 矢量，见函数注释）
 *       → canvas.toBlob(mime, quality) → ctx.putObject(key, blob, mime) → ctx.notify('saved') → dirty=false。
 *       保存仍直接覆盖原 key（契约未禁止）；【决策留痕】M2 曾一律导出 PNG，F6 起按原格式保留。
 *       降级确认（R2-08）：原扩展非 png/jpg/jpeg（即导出 mime ≠ 原格式）时保存前先 confirm
 *       （app.painter-format-hint，与 beforeDispose 同一 askUser 形态）——false=取消本次保存
 *       （不导出不上传、dirty 保持可再问）；此前 svg 保存被静默光栅化成 PNG 字节，用户零感知。
 * 工具条（R2-12）：按钮统一套 fc-button 全局外观类（DOM 构建加 class 即可；色板为色块语义，
 *       套 fc-button-icon xs，底色仍由内联 style 提供）。
 * beforeDispose：同 code.ts 契约（自含实现）——非 dirty 同步放行；dirty 弹 confirm（false=暂缓）；
 *       并与 3s 超时 Promise.race，confirm 卡死时强制放行，防 tab 永久悬挂。
 * dispose：AbortController 摘全部监听 + revokeObjectURL（底图 objectURL，若有）+ 清容器；可重入幂等。
 * savedState：getState 只回 {dirty}；savedState 恢复暂不做笔画重建（切回即底图+空白画布），后续按需补。
 * 底图解码统一走 <img>+objectURL（不用 createImageBitmap）：浏览器覆盖面一致，且 jsdom 可由测试
 *       手动派发 load/error 驱动，路径单一。
 */
import type { AppDefinition } from '../../sdk/types'

// ───────────────────────── 常量 ─────────────────────────

/** i18n key：2d 不可用提示 / 保存钮 / 未保存关闭确认 / 导出格式降级确认（R2-08，词典已备）。
 *  宿主词典无 plugin.* 命名空间（plugin.save 不可用），保存钮落新 key app.painter-save；
 *  app.painter-unsupported / app.painter-unsaved 同为新 key——缺省时 t 回退键名。 */
const UNSUPPORTED_KEY = 'app.painter-unsupported'
const SAVE_KEY = 'app.painter-save'
const UNSAVED_KEY = 'app.painter-unsaved'
const FORMAT_HINT_KEY = 'app.painter-format-hint'

/** 清空钮文案：复用宿主既有通用键 common.clear（词典已含，不新增） */
const CLEAR_KEY = 'common.clear'

/** beforeDispose 超时：confirm 卡死 3s 后强制放行（契约，同 code.ts） */
const BEFORE_DISPOSE_TIMEOUT_MS = 3000

/** 色板（黑红蓝绿）与笔宽 3 档（px）；默认黑 + 中档 */
const COLORS = ['#000000', '#ff0000', '#0000ff', '#008000'] as const
const WIDTHS = [2, 5, 10] as const

/** 容器不可测（jsdom clientWidth=0 / 未布局）时的画布兜底尺寸 */
const FALLBACK_W = 800
const FALLBACK_H = 600

/**
 * confirm 应答 → Promise<boolean>：
 * window.confirm 原生为同步 API，包装成 Promise 以便与 3s 超时 Promise.race；
 * 同时兼容宿主把 confirm 替换为异步对话框（返回 thenable）——超时兜底对两者都成立。
 */
function askUser(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const answer = window.confirm(message) as boolean | Promise<boolean>
    const thenable = answer as {
      then?: (onOk: (v: boolean) => void, onErr: () => void) => void
    }
    if (thenable && typeof thenable.then === 'function') {
      thenable.then(resolve, () => resolve(true)) // 异步应答拒绝也放行（异常 dialog 不该卡死 tab）
      return
    }
    resolve(answer as boolean)
  })
}

// ───────────────────────── 保存导出格式（Lane F6：按原文件格式保留） ─────────────────────────

export interface ExportFormat {
  mime: string
  /** canvas.toBlob quality（仅 jpeg 通道有意义；其余 undefined） */
  quality?: number
}

/**
 * 保存导出 mime 选择（纯函数，按原文件扩展名）：
 * - png → image/png（无损原样）
 * - jpg/jpeg → image/jpeg(0.92)——画板内容本就是位图，回写 jpeg 保格式且体积友好
 *   （画布已白铺，jpeg 无透明通道也不会出黑底）；
 * - 其余（svg 等）→ 维持 image/png：canvas 是位图光栅，drawImage 解码后矢量信息已丢失，
 *   无法回写合法 svg（强行输出 .svg 扩名的 PNG 字节才是真损坏），故降级 PNG 并在此留痕。
 * 扩展名大小写不敏感；无扩展名按 PNG 兜底。
 */
export function pickExportFormat(fileName: string): ExportFormat {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  if (ext === 'jpg' || ext === 'jpeg') return { mime: 'image/jpeg', quality: 0.92 }
  return { mime: 'image/png' }
}

/**
 * 保存格式降级判定（R2-08，纯函数）：原扩展不在 {png, jpg, jpeg}（即 pickExportFormat 会以
 * image/png 光栅化覆盖非 png 文件）→ true，保存链据此先征询用户；png/jpg/jpeg 原格式保留不询问。
 */
export function needsFormatConfirm(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ''
  return ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg'
}

// ───────────────────────── 渲染器 ─────────────────────────

/**
 * Canvas 画板渲染器（内置应用 image-painter）
 * 2d 探测失败（jsdom/老环境 getContext 返回 null）只挂错误提示节点，不抛；
 * 正常路径保证返回完整 AppInstance：dispose / getState / beforeDispose 三件套。
 * savedState 第 4 参未接（不做笔画重建，见文件头）。
 */
export const imagePainterRenderer: AppDefinition['renderer'] = async (el, file, ctx) => {
  // 1) 2d 能力探测先行：getContext 为 null → 错误提示节点收场（不拉字节流、不建画布、不抛）
  const canvas = document.createElement('canvas')
  const probed = canvas.getContext('2d')
  if (!probed) {
    const tip = document.createElement('div')
    tip.className = 'mmagic-painter-unsupported'
    tip.style.padding = '16px'
    tip.style.color = 'var(--app-text-secondary, #888)'
    tip.textContent = ctx.t(UNSUPPORTED_KEY)
    el.replaceChildren(tip)
    return { dispose: () => el.replaceChildren() }
  }
  // 收窄后的新常量（显式非空类型）：闭包（paintWhite/手绘/底图绘制）内保持非空，免逐处断言
  const c2d: CanvasRenderingContext2D = probed

  // 2) 状态闸：color/width=工具当前值；dirty=有未保存笔画；drawing=笔画进行中；
  //    saving=保存中（防重入）；objectUrl=底图 objectURL（dispose 统一回收）
  let color: string = COLORS[0]
  let width: number = WIDTHS[1]
  let dirty = false
  let drawing = false
  let disposed = false
  let saving = false
  let objectUrl: string | null = null
  const ac = new AbortController()

  // 3) 画布尺寸：容器可测则随容器，否则兜底常量（测试环境 clientWidth=0）
  canvas.width = el.clientWidth > 0 ? el.clientWidth : FALLBACK_W
  canvas.height = el.clientHeight > 0 ? el.clientHeight : FALLBACK_H
  canvas.className = 'mmagic-painter-canvas'
  canvas.style.background = '#ffffff' // CSS 白底兜底；位图白底由白铺 fillRect 保证（导出非透明）

  // 白铺：初始与清空共用（保证画布底为白，导出 PNG 底非透明黑）
  function paintWhite(): void {
    c2d.fillStyle = '#ffffff'
    c2d.fillRect(0, 0, canvas.width, canvas.height)
  }
  paintWhite()

  // 4) DOM 骨架：工具条（色板/笔宽/清空/保存）+ 画布；监听统一 AbortController，dispose 一并摘除
  const root = document.createElement('div')
  root.className = 'mmagic-painter'
  const bar = document.createElement('div')
  bar.className = 'mmagic-painter-bar'
  root.append(bar, canvas)

  /** 选中态同步：同组按钮按 data-* 是否等于当前值翻转 aria-pressed */
  function pressAll(selector: string, attr: 'color' | 'width', active: string): void {
    for (const b of bar.querySelectorAll<HTMLButtonElement>(selector)) {
      b.setAttribute('aria-pressed', String(b.dataset[attr] === active))
    }
  }

  for (const c of COLORS) {
    const b = document.createElement('button')
    b.type = 'button'
    // R2-12：套 fc-button 全局外观（色块语义用 icon 方形档；底色仍由内联 style 提供）
    b.className = 'mmagic-painter-swatch fc-button fc-button-icon fc-button-xs'
    b.dataset.color = c
    b.style.background = c
    b.title = c
    b.addEventListener(
      'click',
      () => {
        color = c
        pressAll('[data-color]', 'color', c)
      },
      { signal: ac.signal },
    )
    bar.appendChild(b)
  }
  for (const w of WIDTHS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'mmagic-painter-width fc-button fc-button-outline fc-button-xs' // R2-12
    b.dataset.width = String(w)
    b.textContent = String(w)
    b.title = `${w}px`
    b.addEventListener(
      'click',
      () => {
        width = w
        pressAll('[data-width]', 'width', String(w))
      },
      { signal: ac.signal },
    )
    bar.appendChild(b)
  }

  // 清空：白铺重铺 + 置 dirty（契约：清空也算改动，关闭仍需确认）
  const clearBtn = document.createElement('button')
  clearBtn.type = 'button'
  clearBtn.className = 'mmagic-painter-clear fc-button fc-button-outline fc-button-xs' // R2-12
  clearBtn.dataset.action = 'clear'
  clearBtn.textContent = ctx.t(CLEAR_KEY)
  clearBtn.addEventListener(
    'click',
    () => {
      paintWhite()
      dirty = true
    },
    { signal: ac.signal },
  )

  // 保存钮：文案走 ctx.t（app.painter-save 待词典补录，见常量注释）
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.className = 'mmagic-painter-save fc-button fc-button-primary fc-button-xs' // R2-12
  saveBtn.dataset.action = 'save'
  saveBtn.textContent = ctx.t(SAVE_KEY)
  saveBtn.addEventListener(
    'click',
    () => {
      void save()
    },
    { signal: ac.signal },
  )
  bar.append(clearBtn, saveBtn)
  el.replaceChildren(root)
  pressAll('[data-color]', 'color', color) // 初始选中态（默认色/默认宽）
  pressAll('[data-width]', 'width', String(width))

  // 5) 手绘：down 起 path（round cap/join + 当前色/宽），move 连线即时 stroke，up 收笔 closePath
  /** 客户端坐标 → 画布本地坐标（getBoundingClientRect 偏移） */
  function posOf(ev: Event): { x: number; y: number } {
    const e = ev as PointerEvent
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  function onDown(ev: Event): void {
    if (drawing || disposed) return
    drawing = true
    dirty = true
    // 指针捕获：移出画布也能收到 up（jsdom/老环境无此 API 或抛错——静默降级，不影响绘制）
    const e = ev as PointerEvent
    const id = typeof e.pointerId === 'number' ? e.pointerId : 0
    try {
      if (typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(id)
    } catch {
      /* 捕获失败忽略 */
    }
    ev.preventDefault() // 拦触控滚动/选中
    c2d.strokeStyle = color
    c2d.lineWidth = width
    c2d.lineCap = 'round'
    c2d.lineJoin = 'round'
    const p = posOf(ev)
    c2d.beginPath()
    c2d.moveTo(p.x, p.y)
  }
  function onMove(ev: Event): void {
    if (!drawing || disposed) return
    const p = posOf(ev)
    c2d.lineTo(p.x, p.y)
    c2d.stroke()
  }
  function onUp(ev: Event): void {
    if (!drawing || disposed) return
    drawing = false
    const p = posOf(ev)
    c2d.lineTo(p.x, p.y) // 补末段（纯点击也落一个圆头点）
    c2d.stroke()
    c2d.closePath()
  }
  canvas.addEventListener('pointerdown', onDown, { signal: ac.signal })
  canvas.addEventListener('pointermove', onMove, { signal: ac.signal })
  canvas.addEventListener('pointerup', onUp, { signal: ac.signal })

  // 6) 底图：异步加载不挡 AppInstance 返回（对齐 image.ts 口径）；任一环节失败 → 空白画布继续
  void (async () => {
    try {
      const blob = await ctx.getObject(file.key)
      if (disposed) return // dispose 先至：不再建 URL/节点（防泄漏）
      const url = URL.createObjectURL(blob)
      objectUrl = url
      const img = document.createElement('img')
      img.alt = file.name
      img.style.display = 'none' // 底图只作解码源；入 DOM 便于生命周期归口（dispose 随 root 移除）
      root.appendChild(img)
      await new Promise<void>((resolve, reject) => {
        img.addEventListener('load', () => resolve(), { once: true })
        img.addEventListener('error', () => reject(new Error('base image decode failed')), { once: true })
        img.src = url
      })
      if (disposed) return
      // 等比缩放居中（只缩小不放大；无尺寸信息按画布全幅兜底）
      const iw = img.naturalWidth || canvas.width
      const ih = img.naturalHeight || canvas.height
      const scale = Math.min(canvas.width / iw, canvas.height / ih, 1)
      const dw = Math.max(1, Math.round(iw * scale))
      const dh = Math.max(1, Math.round(ih * scale))
      c2d.drawImage(img, Math.round((canvas.width - dw) / 2), Math.round((canvas.height - dh) / 2), dw, dh)
    } catch {
      // 解码失败：撤底图节点（空白画布可从零画）；URL 留待 dispose 回收（重复 revoke 无害）
      root.querySelector('img')?.remove()
    }
  })()

  // 7) 保存链：格式降级先征询（R2-08）→ toBlob(按原格式，Lane F6) → putObject（mime 随导出格式覆盖原 key）
  //    → notify('saved') → dirty 复位
  async function save(): Promise<void> {
    if (saving) return // 保存中：本次点击丢弃（防重入，不排队）
    saving = true
    try {
      const fmt = pickExportFormat(file.name)
      // 降级确认（R2-08）：svg 等非 png/jpg/jpeg 将被光栅化成 PNG 位图覆盖原文件——保存前明示，
      // 取消=不导出不上传（dirty 保持，用户可再问/改存他途）
      if (needsFormatConfirm(file.name)) {
        const ok = await askUser(ctx.t(FORMAT_HINT_KEY))
        if (!ok) return
      }
      const blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b), fmt.mime, fmt.quality)
        } catch {
          resolve(null) // jsdom 未装 canvas 包等环境 toBlob 抛错 → 视为导出失败
        }
      })
      if (!blob) return // 导出失败：保持 dirty（beforeDispose 仍拦），不误报已保存
      await ctx.putObject(file.key, blob, fmt.mime)
      ctx.notify('saved', { key: file.key })
      dirty = false
    } catch {
      // 保存失败：保持 dirty，不误报已保存；错误由调用链感知（对齐 code.ts 口径）
    } finally {
      saving = false
    }
  }

  // 8) 生命周期三件套
  return {
    // getState：切 tab 时只回 {dirty}；savedState 恢复暂不做笔画重建（文件头注释留档）
    getState: () => ({ dirty }),

    // beforeDispose 契约：非 dirty 同步放行；dirty 与 3s 超时竞速（confirm 卡死强制放行）
    beforeDispose: (): boolean | Promise<boolean> => {
      if (!dirty) return true
      let timer: ReturnType<typeof setTimeout> | undefined
      const guard = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), BEFORE_DISPOSE_TIMEOUT_MS)
      })
      const asked = askUser(ctx.t(UNSAVED_KEY)).finally(() => {
        if (timer !== undefined) clearTimeout(timer) // 用户先应答：撤掉超时闸
      })
      return Promise.race([asked, guard])
    },

    // dispose：先摘全部监听（工具条+指针），再回收底图 objectURL（若有），最后清容器
    dispose: () => {
      if (disposed) return
      disposed = true
      ac.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      root.remove()
    },
  }
}
