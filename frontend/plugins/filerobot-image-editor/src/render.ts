/**
 * 渲染装配：Filerobot 图片编辑器（react-filerobot-image-editor 4.9 内核，vanilla 桥接）。
 * - **源一律 Blob**（复审 P1-2）：内核 loadImage 强制 img.crossOrigin='Anonymous'，直链跨源必须
 *   CORS 干净否则图片加载直接失败且无二段回落——图片 ≤50MB（预览闸）本就整读，blob-first 最稳；
 *   dispose 时 revokeObjectURL。
 * - 保存链：编辑器 Save 弹层 → onSave(goods) → imageCanvas/imageBase64 → Blob → ctx.putObject +
 *   ctx.notify('saved')。格式/质量**尊重弹层用户选择**（goods.mimeType/quality，复审 P2-2）；
 *   goods.imageBase64 兜底前校验 data: 前缀（复审 P2-1：fetch('') 会把宿主页 HTML 写坏对象）。
 * - 中文化：语义键词条（i18n-zh）+ `useBackendTranslations:false`（复审 P1-1：内核默认会外呼
 *   第三方 i18n 服务，断网时 Spinner 卡死直至 TCP 超时）。
 * - 生命周期：onModify 置脏 → beforeDispose 未保存确认（painter 同款 3s 竞态，复审 P2-5）；
 *   dispose = editor.terminate() + objectUrl 回收 + 根节点移除。
 */
import FilerobotImageEditor from 'filerobot-image-editor'
import { exportExtOf } from './options'
import { ZH_TRANSLATIONS } from './i18n-zh'
import type { EditorOptions, HostCtx, HostFile, HostInstance } from './types'

const MEDIA_LOAD_FAIL_KEY = 'app.media-load-fail'
const SAVED_KEY = 'app.filerobot-saved'
const SAVE_FAILED_KEY = 'app.filerobot-save-failed'

/** 悬停 hint 词表（按内核挂载 DOM 顺序；中文界面下 label 被 CSS 隐藏后靠 title 提供名称） */
const TAB_HINTS = ['调整', '微调', '滤镜', '水印', '标注', '尺寸']
const TOOL_HINTS = ['文字', '图片', '矩形', '椭圆', '多边形', '画笔', '直线', '箭头']

/** 保存按钮图标（软盘，currentColor 跟随按钮前景色） */
const SAVE_ICON_SVG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z'/></svg>\")"

/** 「添加图片」钮图标（图片框+山形+右上加号，currentColor） */
const IMG_ADD_ICON_SVG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M4 4h10v2H6v10h12v-5h2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm10-6h2v3h3v2h-3v3h-2V7h-3V5h3V2z'/></svg>\")"

/**
 * 界面风格覆写（用户口径：图标化/紧凑/扁平/重排——一次注入）：
 * - Tab 栏隐藏文字标签只留图标（窄轨）；工具条按钮 font-size:0 吞掉文本节点、只留 SVG；
 * - 顶栏重排（截图圈注①②③）：保存改软盘图标；重置/撤销/重做组从右端移到左侧（flex order）；
 *   尺寸/缩放组移到编辑区右下角浮动（absolute 锚 .FIE_root——topbar 必须 static 断锚）；
 *   底部工具面板（工具选择 + 选项）移到顶栏正下方居中。
 * - 全链紧凑化（按钮/间距/顶栏）；扁平化（去弹影、细描边）。
 * styled-components 类名特异性不稳，关键规则一律 !important。
 */
let uiStyleInjected = false
function injectUiStyles(): void {
  if (uiStyleInjected) return
  uiStyleInjected = true
  const st = document.createElement('style')
  st.textContent = `
/* Tab 轨并入顶栏（用户圈注：左轨箭头指向 topbar）——桌面轨道类名是 .FIE_tabs（.FIE_tabs-drawer
   不存在于桌面 DOM）；absolute 锚 .FIE_root（topbar 已 static），横排挂在撤销/重做组右侧，
   脱离 main-container 流后画布全高 */
.fie-root .FIE_tabs { position: absolute !important; top: 3px !important; left: 486px !important; bottom: auto !important; display: flex !important; flex-direction: row !important; width: auto !important; min-width: 0 !important; max-width: none !important; flex-basis: auto !important; height: 34px !important; padding: 0 !important; gap: 2px !important; background: transparent !important; z-index: 6 !important; }
.fie-root .FIE_tab { width: 44px !important; height: 34px !important; min-height: 34px !important; padding: 0 !important; margin: 0 !important; justify-content: center !important; box-shadow: none !important; border-radius: 6px !important; }
.fie-root .FIE_tab-label { display: none !important; }
.fie-root .FIE_tab svg { width: 16px !important; height: 16px !important; }
.fie-root .FIE_tools-bar { gap: 2px !important; padding: 0 6px !important; }
.fie-root .FIE_tools-bar [class*="-tool-button"] { font-size: 0 !important; gap: 0 !important; padding: 4px 6px !important; box-shadow: none !important; border-radius: 6px !important; }
.fie-root .FIE_tools-bar [class*="-tool-button"] * { font-size: 0 !important; }
.fie-root .FIE_tools-bar [class*="-tool-button"] svg { width: 15px !important; height: 15px !important; }
/* 顶栏重排：flex-start + order（undo/redo 组容器无 FIE_ 类名，用 :not 结构选择器命中）；
   topbar 降为 static，让缩放组的 absolute 锚到 .FIE_root（编辑区），落到右下角 */
.fie-root .FIE_topbar { position: static !important; display: flex !important; justify-content: flex-start !important; min-height: 40px !important; height: 40px !important; padding: 0 8px !important; box-shadow: none !important; }
.fie-root .FIE_topbar button { box-shadow: none !important; }
.fie-root .FIE_topbar-buttons-wrapper { order: 1 !important; }
.fie-root .FIE_topbar > div:not([class*="FIE_"]) { order: 2 !important; margin-left: 10px !important; }
.fie-root .FIE_topbar-center-options { order: 3 !important; position: absolute !important; top: auto !important; left: auto !important; right: 12px !important; bottom: 12px !important; z-index: 5 !important; background: #fff !important; border: 1px solid #e2e8f0 !important; border-radius: 8px !important; padding: 2px 6px !important; box-shadow: none !important; }
/* 保存 → 纯图标（font-size:0 吞「保存」文本 + ::before 软盘 mask） */
.fie-root .FIE_topbar-save-wrapper { min-width: 0 !important; width: auto !important; }
.fie-root .FIE_topbar-save-button { font-size: 0 !important; width: 28px !important; min-width: 28px !important; height: 26px !important; min-height: 26px !important; padding: 0 !important; border-radius: 6px !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
.fie-root .FIE_topbar-save-button * { font-size: 0 !important; }
.fie-root .FIE_topbar-save-button::before { content: '' !important; display: block !important; width: 14px !important; height: 14px !important; background: currentColor !important; -webkit-mask: ${SAVE_ICON_SVG} center/contain no-repeat !important; mask: ${SAVE_ICON_SVG} center/contain no-repeat !important; }
/* 无修改不可保存（用户口径）：disabled 灰态 */
.fie-root .FIE_topbar-save-button:disabled { opacity: 0.45 !important; cursor: not-allowed !important; }
/* 工具面板 → 顶栏正下方居中 + 左右布局（用户口径：上移贴顶；工具行竖排居左、属性区在右——
   原为上下堆叠：tool-options 在上、tools-bar 在下。控件统一 26px 高/12px 字/15px 图标） */
/* 面板统一上下布局（用户圈注：工具列横排单排 + 位置不够自动折上下二行）：
   wrapper column 居中，工具行横排在顶（order:-1）可折行，选项区（属性/滑条）在下。
   max-width 92% 提供折行约束——窄预览窗时工具钮自动折为两行 */
.fie-root .FIE_tools-bar-wrapper { position: absolute !important; top: 44px !important; bottom: auto !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 5 !important; display: flex !important; flex-direction: column !important; align-items: center !important; gap: 4px !important; max-width: 92% !important; }
.fie-root .FIE_tools-bar, .fie-root .FIE_tools-wrapper, .fie-root .FIE_tools-items { display: flex !important; flex-direction: row !important; flex-wrap: wrap !important; justify-content: center !important; }
.fie-root .FIE_tools-bar { order: -1 !important; width: 100% !important; }
.fie-root .FIE_tool-options-wrapper { padding: 4px 8px !important; align-self: stretch !important; }
.fie-root .FIE_annotations-options { gap: 6px !important; align-items: center !important; padding: 2px 0 !important; }
/* 属性区单行（用户圈注：改单行）——内核 flex-wrap:wrap 把对齐组挤到第二行，强 nowrap 收一行 */
.fie-root .FIE_annotations-options { flex-wrap: nowrap !important; }
.fie-root .FIE_annotations-options > * { flex-wrap: nowrap !important; }
/* Image 工具「添加图片」钮 → 图标（font-size:0 吞文本 + ::before 相册加号 mask，同保存钮口径；
   特异性须压过后面的 12px 通杀规则，故挂 .FIE_annotations-options 三级） */
.fie-root .FIE_annotations-options .FIE_image-tool-add-option-button { font-size: 0 !important; width: 26px !important; min-width: 26px !important; height: 26px !important; min-height: 26px !important; padding: 0 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; }
.fie-root .FIE_annotations-options .FIE_image-tool-add-option-button * { font-size: 0 !important; }
.fie-root .FIE_image-tool-add-option-button::before { content: '' !important; display: block !important; width: 14px !important; height: 14px !important; background: currentColor !important; -webkit-mask: ${IMG_ADD_ICON_SVG} center/contain no-repeat !important; mask: ${IMG_ADD_ICON_SVG} center/contain no-repeat !important; }
.fie-root .FIE_annotations-options label, .fie-root .FIE_annotations-options span, .fie-root .FIE_annotations-options div { font-size: 12px !important; }
.fie-root .FIE_annotations-options button { font-size: 12px !important; height: 26px !important; min-height: 26px !important; padding: 2px 6px !important; }
.fie-root .FIE_annotations-options svg { width: 15px !important; height: 15px !important; }
.fie-root .FIE_annotations-options input[type="color"], .fie-root .FIE_annotations-options [class*="SfxSelect-Container"] { height: 26px !important; min-height: 26px !important; }
.fie-root .FIE_annotations-options input { font-size: 12px !important; height: 26px !important; min-height: 26px !important; padding: 0 6px !important; }
/* 字体/字号控件对齐（用户圈注：字号框文字下沉）——input 单行文字 line-height=盒高垂直居中，容器去基线对齐；
   number spinner（appearance:auto）占位挤偏文字——去 spinner + 数值居中 */
.fie-root .FIE_annotations-options input { line-height: normal !important; padding-top: 0 !important; padding-bottom: 0 !important; }
.fie-root .FIE_annotations-options input { appearance: textfield !important; -moz-appearance: textfield !important; }
.fie-root .FIE_annotations-options input::-webkit-outer-spin-button, .fie-root .FIE_annotations-options input::-webkit-inner-spin-button { -webkit-appearance: none !important; margin: 0 !important; }
.fie-root .FIE_annotations-options { align-items: center !important; }
/* 字号框下沉真凶：SfxInput 壳（.FIE_text-size-option 等）自带 padding-top:8px（label 预留位，
   label 未渲染 padding 却在）——26px 壳内 input 被压溢出 9px。清子层 padding 收齐 */
.fie-root .FIE_annotations-options > * { padding: 0 !important; }
/* 字号/控件高全量统一（B/I 等样式钮是 styled Label 非 button，需 * 通杀；styled 自身规则以 !important 顶住） */
.fie-root .FIE_annotations-options * { font-size: 12px !important; }
.fie-root .FIE_annotations-options [class*="SfxSelect"], .fie-root .FIE_annotations-options [class*="SfxButton"], .fie-root .FIE_annotations-options [class*="SfxInput"], .fie-root .FIE_annotations-options label { height: 26px !important; min-height: 26px !important; }
.fie-root .FIE_annotations-options [class*="color"], .fie-root .FIE_annotations-options [class*="picker"] { width: 26px !important; height: 26px !important; min-height: 26px !important; min-width: 26px !important; }
.fie-root .FIE_topbar-zoom-label { font-size: 12px !important; }
.fie-root .FIE_tool-options-wrapper { padding: 6px !important; }
`
  document.head.appendChild(st)
}

interface FilerobotBridge {
  render(additionalConfig?: Record<string, unknown>): void
  terminate(): void
}

interface SaveGoods {
  imageCanvas?: HTMLCanvasElement | null
  imageBase64?: string
  mimeType?: string
  extension?: string
  quality?: number
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 空结果'))),
      mime,
      quality,
    )
  })
}

export async function renderEditor(
  el: HTMLElement,
  file: HostFile,
  ctx: HostCtx,
  options: Required<EditorOptions>,
  _savedState?: unknown,
): Promise<HostInstance> {
  const prevPos = el.style.position
  el.style.position = 'relative'

  const root = document.createElement('div')
  root.className = 'fie-root'
  root.style.cssText = 'position:absolute;inset:0;background:#fff;z-index:0'
  injectUiStyles()
  const stage = document.createElement('div')
  stage.className = 'fie-stage'
  stage.style.cssText = 'position:absolute;inset:0'
  const badge = document.createElement('span')
  badge.className = 'fie-saved-badge'
  badge.style.cssText =
    'position:absolute;top:8px;right:12px;z-index:2;font-size:12px;pointer-events:none;opacity:0;transition:opacity .3s'
  root.append(stage, badge)
  el.appendChild(root)

  let disposed = false
  let modified = false
  let editor: FilerobotBridge | null = null
  let objectUrl: string | null = null

  /** 悬停 hint：label 被 CSS 隐藏后给 Tab/工具钮/保存图标补 title（按挂载顺序对齐词表） */
  const applyHints = (): void => {
    if (disposed) return
    root.querySelectorAll('.FIE_tab').forEach((b, i) => {
      b.setAttribute('title', TAB_HINTS[i] ?? '')
    })
    root.querySelectorAll('.FIE_tools-bar [class*="-tool-button"]').forEach((b, i) => {
      b.setAttribute('title', TOOL_HINTS[i] ?? '')
    })
    // 保存钮已图标化（文本被吞），补 title；撤销/重做/缩放组内核自带中文 title 不动
    root.querySelectorAll('.FIE_topbar-save-button').forEach((b) => {
      b.setAttribute('title', '保存')
    })
    syncSaveBtn()
  }

  /** 徽标闪现（成功绿/失败红——复审 P2-3：保存失败不得静默） */
  const flash = (text: string, color: string): void => {
    if (disposed) return
    badge.textContent = text
    badge.style.color = color
    badge.style.opacity = '1'
    setTimeout(() => {
      badge.style.opacity = '0'
    }, 2000)
  }

  /** 保存钮可用态同步（用户口径：无修改不可保存）——disabled 跟随 modified；保存成功后复位重禁 */
  const syncSaveBtn = (): void => {
    if (disposed) return
    root.querySelectorAll('.FIE_topbar-save-button').forEach((b) => {
      ;(b as HTMLButtonElement).disabled = !modified
    })
  }

  /** 保存链：尊重弹层用户选择（extension/mimeType/quality），saving 闸防连点双写 */
  let saving = false
  const persist = async (goods: SaveGoods): Promise<void> => {
    if (disposed || saving) return
    saving = true
    try {
      // 弹层选择优先；缺省按原扩展（png/jpg/jpeg/webp，bmp/gif 回落 png——内核无此二类导出器）
      const ext = typeof goods.extension === 'string' && goods.extension !== '' ? goods.extension : exportExtOf(file.name)
      let mime = goods.mimeType ?? (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
      // 内核 goods.mimeType 不做 jpg→jpeg 归一——'image/jpg' 非法编码类型，toBlob 按规范回落 PNG，
      // 会把 PNG 字节静默写进 .jpg 键（复审二轮 P2）
      if (mime === 'image/jpg') mime = 'image/jpeg'
      const quality = typeof goods.quality === 'number' ? goods.quality : ext === 'png' ? undefined : 0.92
      let blob: Blob
      if (goods.imageCanvas) {
        blob = await canvasToBlob(goods.imageCanvas, mime, quality)
      } else if (typeof goods.imageBase64 === 'string' && goods.imageBase64.startsWith('data:')) {
        blob = await (await fetch(goods.imageBase64)).blob()
      } else {
        // 复审 P2-1：fetch('') 会按 base URL 拉宿主页 HTML 静默写坏对象——显式失败
        throw new Error('编辑器未产出图片数据（imageCanvas/imageBase64 均缺位）')
      }
      await ctx.putObject(file.key, blob, mime)
      ctx.notify('saved', { key: file.key })
      // 保存成功 → 脏态复位（未修改不可保存口径 + beforeDispose 不再无谓询问）
      modified = false
      syncSaveBtn()
      flash(ctx.t(SAVED_KEY), '#16a34a')
    } catch (err) {
      console.warn('FIE_SAVE_ERR', String(err)?.slice(0, 200))
      flash(ctx.t('app.filerobot-save-failed'), '#dc2626')
    } finally {
      saving = false
    }
  }

  const instance: HostInstance = {
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        editor?.terminate()
      } catch {
        // 内核未完成初始化等竞态静默——root.remove 兜底
      }
      editor = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      root.remove()
      el.style.position = prevPos
    },
    // 复审 P2-5：编辑器丢一画布改动比丢几笔更痛——onModify 置脏 + 关 tab 未保存确认（painter 口径）
    beforeDispose: () => {
      if (!modified) return true
      const ans = window.confirm(ctx.t('app.code-unsaved')) as boolean | Promise<boolean>
      return Promise.race([Promise.resolve(ans), new Promise<boolean>((r) => setTimeout(() => r(true), 3000))])
    },
  }

  // 源一律 Blob（复审 P1-2：内核强制 crossOrigin 匿名读像素，直链跨源无 CORS=图片加载直接失败；
  // 图片受全局预览闸 ≤50MB 约束，整读无 Range 收益）
  let source: string
  try {
    const blob = await ctx.getObject(file.key)
    objectUrl = URL.createObjectURL(blob)
    source = objectUrl
  } catch {
    const tip = document.createElement('div')
    tip.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;color:#94a3b8;font-size:13px'
    tip.textContent = ctx.t(MEDIA_LOAD_FAIL_KEY)
    root.replaceChildren(tip)
    return instance
  }

  try {
    editor = new FilerobotImageEditor(stage, {
      source,
      // 复审 P2-4：内核键为 defaultSavedImageName（filename 是死键）
      defaultSavedImageName: file.name,
      defaultTabId: options.defaultTab,
      defaultSavedImageType: exportExtOf(file.name),
      defaultSavedImageQuality: 0.92,
      translations: ZH_TRANSLATIONS,
      // 复审 P1-1：关掉第三方 i18n 外呼（断网时 Spinner 卡死）；本地词条照常合并
      useBackendTranslations: false,
      // 复审 P2-5：内核变更回调（标注/工具操作均触发）——脏标记供 beforeDispose 确认 + 保存钮解禁
      onModify: () => {
        if (!modified) {
          modified = true
          syncSaveBtn()
        }
      },
      // 保存：弹层 Save 按钮 → persist（内核保存后保持打开；其 closeAfterSave 缺省 false，同语义）
      onSave: (goods: SaveGoods) => {
        void persist(goods)
      },
    } as unknown as Record<string, unknown>) as unknown as FilerobotBridge
    editor.render()
    // React 挂载完成后补 hint（label 已图标化隐藏）
    setTimeout(() => {
      if (!disposed) applyHints()
    }, 2500)
  } catch (err) {
    console.warn('FIE_MOUNT_ERR', String(err)?.slice(0, 200))
    try {
      editor?.terminate()
    } catch {
      // 静默
    }
    editor = null
    const tip = document.createElement('div')
    tip.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;color:#94a3b8;font-size:13px'
    tip.textContent = ctx.t(MEDIA_LOAD_FAIL_KEY)
    root.replaceChildren(tip)
  }

  return instance
}
