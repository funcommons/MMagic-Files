/** AcroForm 层（方案 §4.4 P2 行 + §8.4 XFA 红线）：字段检视（定位到页+pt 矩形）、值应用、XFA 检测 */
import { PDFDocument, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, PDFName, PDFDict, PDFArray } from 'pdf-lib'

export type FieldType = 'text' | 'checkbox' | 'dropdown' | 'radio' | 'option'

export interface FieldInfo {
  name: string
  type: FieldType
  page: number // 1-based
  /** PDF 用户空间（左下原点），与标注模型同系 */
  rect: { x: number; y: number; w: number; h: number }
  options?: string[]
}

/** XFA 检测（§8.4）：AcroForm 字典含 XFA 键即判定——表单填写整链禁用，覆盖层标注不受影响 */
export function hasXFA(pdf: PDFDocument): boolean {
  try {
    const acro = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    if (!acro) return false
    const xfa = acro.get(PDFName.of('XFA'))
    return xfa !== undefined && (xfa instanceof PDFArray || xfa instanceof PDFDict)
  } catch {
    return false
  }
}

/** 字段检视：name/类型/首个 widget 的页号与矩形（radio 组取首选项；MVP 口径） */
export function inspectFields(pdf: PDFDocument): FieldInfo[] {
  let form
  try {
    form = pdf.getForm()
  } catch {
    return []
  }
  let fields
  try {
    fields = form.getFields()
  } catch {
    return []
  }
  const pages = pdf.getPages()
  const out: FieldInfo[] = []
  for (const f of fields) {
    try {
      const widgets = f.acroField.getWidgets()
      if (widgets.length === 0) continue
      const w0 = widgets[0]
      const r = w0.getRectangle()
      const pageIdx = pages.findIndex((p) => p.ref === w0.P())
      if (pageIdx < 0) continue
      const ctor = f.constructor.name
      let type: FieldType = 'text'
      let options: string[] | undefined
      if (f instanceof PDFCheckBox) type = 'checkbox'
      else if (f instanceof PDFDropdown) {
        type = 'dropdown'
        options = f.getOptions()
      } else if (f instanceof PDFRadioGroup) {
        type = 'radio'
        options = f.getOptions()
      } else if (f instanceof PDFOptionList) {
        type = 'option'
        options = f.getOptions()
      } else if (!(f instanceof PDFTextField)) {
        continue // 签名域等不进填写面
      }
      out.push({
        name: f.getName(),
        type,
        page: pageIdx + 1,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        ...(options ? { options } : {}),
      })
    } catch {
      // 单字段异常不阻断其余字段
    }
  }
  return out
}

/** 值应用 + 外观压平（§4.4 P2 行）。仅当存在 AcroForm 字段时 flatten；异常逐字段吞（不阻断压平主链） */
export function applyFormValuesAndFlatten(pdf: PDFDocument, values: Record<string, string | boolean>): { applied: number; flattened: boolean } {
  let applied = 0
  let flattened = false
  try {
    const form = pdf.getForm()
    for (const [name, v] of Object.entries(values)) {
      try {
        const f = form.getField(name)
        if (f instanceof PDFTextField) {
          f.setText(String(v ?? ''))
          applied++
        } else if (f instanceof PDFCheckBox) {
          v ? f.check() : f.uncheck()
          applied++
        } else if (f instanceof PDFDropdown && typeof v === 'string' && f.getOptions().includes(v)) {
          f.select(v)
          applied++
        } else if (f instanceof PDFRadioGroup && typeof v === 'string' && f.getOptions().includes(v)) {
          f.select(v)
          applied++
        } else if (f instanceof PDFOptionList && typeof v === 'string' && f.getOptions().includes(v)) {
          f.select(v)
          applied++
        }
      } catch {
        // 单字段失败不阻断
      }
    }
    if (applied > 0) {
      // 仅在有值被应用时压平：纯标注保存不得销毁 AcroForm 可填性
      form.flatten()
      flattened = true
    }
  } catch {
    // 表单链整体失败：压平主链（标注）继续
  }
  return { applied, flattened }
}
