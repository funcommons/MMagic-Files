/** 写回层（方案 §4.4）：annotation 模型 → pdf-lib 压平进原字节。
 *  text 含 CJK → canvas 光栅化图章化（标准 14 字体无 CJK 字形） */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Annotation } from './types'

const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/

/** 文本光栅化（图章化）：透明底 PNG，2x 抗锯齿 */
function textToPngDataUrl(text: string, fontSize: number, color: string): { dataUrl: string; w: number; h: number } {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${fontSize}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.font = font
  const lines = text.split('\n')
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const lineH = fontSize * 1.4
  canvas.width = Math.ceil(w) + 4
  canvas.height = Math.ceil(lineH * lines.length) + 4
  const ctx2 = canvas.getContext('2d')!
  ctx2.font = font
  ctx2.fillStyle = color
  ctx2.textBaseline = 'top'
  lines.forEach((l, i) => ctx2.fillText(l, 2, 2 + i * lineH))
  return { dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }
}

async function embedDataUrl(pdf: PDFDocument, dataUrl: string) {
  const b64 = dataUrl.split(',')[1] ?? ''
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return pdf.embedPng(bytes)
}

/** hex → pdf-lib rgb（非法输入回退红） */
function toRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return rgb(0.8, 0.2, 0.2)
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function flattenAnnotations(originalBytes: ArrayBuffer, annotations: Annotation[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(originalBytes)
  const font: PDFFont = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()

  for (const ann of annotations) {
    const page: PDFPage | undefined = pages[ann.page - 1]
    if (!page) continue
    const { height: pH } = page.getSize()
    const color = toRgb(ann.style.color)
    const sw = ann.style.strokeWidth ?? 1.5
    if (ann.type === 'rect' && ann.rect) {
      page.drawRectangle({
        x: ann.rect.x,
        y: ann.rect.y,
        width: ann.rect.w,
        height: ann.rect.h,
        borderColor: color,
        borderWidth: sw,
      })
    } else if (ann.type === 'text' && ann.text) {
      const fontSize = ann.style.fontSize ?? 14
      if (CJK_RE.test(ann.text)) {
        // CJK 图章化（§4.4）：canvas 光栅 → embedPng；ann.rect.y=基线，光栅含行高下坠
        const { dataUrl, w, h } = textToPngDataUrl(ann.text, fontSize, ann.style.color)
        const img = await embedDataUrl(pdf, dataUrl)
        page.drawImage(img, { x: ann.rect?.x ?? 40, y: ann.rect!.y - h * 0.25, width: w, height: h })
      } else {
        page.drawText(ann.text, { x: ann.rect?.x ?? 40, y: ann.rect!.y, size: fontSize, font, color })
      }
    } else if (ann.type === 'ink' && ann.points && ann.points.length >= 2) {
      for (let i = 1; i < ann.points.length; i++) {
        page.drawLine({
          start: { x: ann.points[i - 1].x, y: ann.points[i - 1].y },
          end: { x: ann.points[i].x, y: ann.points[i].y },
          thickness: sw,
          color,
        })
      }
    } else if (ann.type === 'stamp' && ann.dataUrl) {
      const img = await embedDataUrl(pdf, ann.dataUrl)
      const w = ann.rect?.w ?? 140
      const h = ann.rect?.h ?? (w * (img.height / img.width))
      page.drawImage(img, { x: ann.rect?.x ?? 40, y: ann.rect?.y ?? 40, width: w, height: h })
    }
  }
  return pdf.save()
}

/** 签名板笔迹平滑：等距重采样 + 圆角连线（canvas 端渲染用） */
export function smoothPoints(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const prev = points[i - 1]
    const mx = (p.x + prev.x) / 2
    const my = (p.y + prev.y) / 2
    d += ` Q ${prev.x} ${prev.y} ${mx} ${my}`
  }
  return d
}
