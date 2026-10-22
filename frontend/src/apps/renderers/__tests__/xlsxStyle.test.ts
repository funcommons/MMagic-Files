/**
 * xlsxStyle 纯函数单测（xlsx-viewer B 方案）：颜色（argb/theme+tint）、边框映射、
 * 值提取（formula/richText/hyperlink/Date/error）、列宽/行高换算、合并区解析与索引。
 */
import { describe, expect, it } from 'vitest'
import {
  borderCss,
  buildMergeIndex,
  cellValueText,
  colLetterToIndex,
  colWidthPx,
  colorToCss,
  parseMergeRange,
  rowHeightPx,
} from '../xlsxStyle'

// ───────────────────────── 颜色 ─────────────────────────

describe('colorToCss：ExcelJS 颜色对象 → CSS 色', () => {
  it('argb 8 位取后 6；rgb 6 位直用', () => {
    expect(colorToCss({ argb: 'FFFF0000' })).toBe('#ff0000')
    expect(colorToCss({ rgb: '00FF00' })).toBe('#00ff00')
  })

  it('tint：>0 变亮（向白插值）、<0 变暗', () => {
    const up = colorToCss({ rgb: '808080', tint: 0.5 })
    expect(up).toBe('#c0c0c0') // 128 + (255-128)*0.5 ≈ 192
    const down = colorToCss({ rgb: '808080', tint: -0.5 })
    expect(down).toBe('#404040') // 128 - 128*0.5 = 64
  })

  it('theme 色走 Office 默认主题近似表 + tint', () => {
    expect(colorToCss({ theme: 0 })).toBe('#ffffff') // lt1
    expect(colorToCss({ theme: 1 })).toBe('#000000') // dk1
    expect(colorToCss({ theme: 4 })).toBe('#4f81bd') // accent1
    const light = colorToCss({ theme: 1, tint: 0.75 }) // 黑色提亮 75%（灰字常见做法）
    expect(light).toBe('#bfbfbf')
  })

  it('无效输入 → null（undefined/空对象/垃圾 argb/越界 theme）', () => {
    expect(colorToCss(undefined)).toBeNull()
    expect(colorToCss({})).toBeNull()
    expect(colorToCss({ argb: 'XYZ' })).toBeNull()
    expect(colorToCss({ theme: 99 })).toBeNull()
  })
})

// ───────────────────────── 边框 ─────────────────────────

describe('borderCss：ExcelJS 边框 → CSS', () => {
  it('常见线型映射（thin/medium/thick/dashed/dotted/double）带色', () => {
    expect(borderCss({ style: 'thin', color: { rgb: 'FF0000' } })).toBe('1px solid #ff0000')
    expect(borderCss({ style: 'medium' })).toBe('2px solid')
    expect(borderCss({ style: 'thick' })).toBe('3px solid')
    expect(borderCss({ style: 'dashed' })).toBe('1px dashed')
    expect(borderCss({ style: 'dotted' })).toBe('1px dotted')
    expect(borderCss({ style: 'double' })).toBe('3px double')
  })

  it('缺 style / 未知线型 / undefined → null', () => {
    expect(borderCss(undefined)).toBeNull()
    expect(borderCss({ color: { rgb: '000000' } })).toBeNull()
    expect(borderCss({ style: 'diagonalCross' as string })).toBeNull()
  })
})

// ───────────────────────── 值提取 ─────────────────────────

describe('cellValueText：单元格值 → 显示文本', () => {
  it('基础类型：null/number/boolean/string', () => {
    expect(cellValueText(null)).toBe('')
    expect(cellValueText(undefined)).toBe('')
    expect(cellValueText(3.14)).toBe('3.14')
    expect(cellValueText(true)).toBe('true')
    expect(cellValueText('hello')).toBe('hello')
  })

  it('公式取缓存结果（递归）；无结果显示空', () => {
    expect(cellValueText({ formula: 'A1+B1', result: 42 })).toBe('42')
    expect(cellValueText({ formula: 'A1', result: { error: '#DIV/0!' } })).toBe('#DIV/0!')
    expect(cellValueText({ formula: 'NOW()' })).toBe('')
  })

  it('richText 拼接纯文本；hyperlink 取锚文本', () => {
    expect(cellValueText({ richText: [{ text: 'ab' }, { text: 'cd' }] })).toBe('abcd')
    expect(cellValueText({ text: '官网', hyperlink: 'https://x' })).toBe('官网')
  })

  it('Date → YYYY-MM-DD 本地化', () => {
    expect(cellValueText(new Date(2026, 9, 21))).toBe('2026-10-21')
  })
})

// ───────────────────────── 尺寸换算 ─────────────────────────

describe('列宽/行高换算', () => {
  it('列宽字符单位 → px（×7+5）；无效返回 null', () => {
    expect(colWidthPx(10)).toBe(75)
    expect(colWidthPx(undefined)).toBeNull()
    expect(colWidthPx(0)).toBeNull()
    expect(colWidthPx(-3)).toBeNull()
  })

  it('行高 pt → px（×4/3）；无效返回 null', () => {
    expect(rowHeightPx(15)).toBe(20)
    expect(rowHeightPx(undefined)).toBeNull()
  })
})

// ───────────────────────── 合并区 ─────────────────────────

describe('合并区解析与索引', () => {
  it('colLetterToIndex：A→0 / Z→25 / AA→26；非字母 → -1', () => {
    expect(colLetterToIndex('A')).toBe(0)
    expect(colLetterToIndex('Z')).toBe(25)
    expect(colLetterToIndex('AA')).toBe(26)
    expect(colLetterToIndex('a1')).toBe(-1)
  })

  it('parseMergeRange：A1:C3 → 0 基含端点；单格自引用；非法 null', () => {
    expect(parseMergeRange('A1:C3')).toEqual({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 })
    expect(parseMergeRange('B2')).toEqual({ startRow: 1, startCol: 1, endRow: 1, endCol: 1 })
    expect(parseMergeRange('C3:A1')).toEqual({ startRow: 2, startCol: 2, endRow: 2, endCol: 2 }) // 端点归一
    expect(parseMergeRange('junk')).toBeNull()
    expect(parseMergeRange('A0:B2')).toBeNull() // 0 行非法
  })

  it('buildMergeIndex：起点跨度 + 从格跳过集合', () => {
    const { spans, skipped } = buildMergeIndex(['A1:B2', 'D1'])
    expect(spans.get('0:0')).toEqual({ rowSpan: 2, colSpan: 2 })
    expect(spans.has('0:3')).toBe(false) // 单格引用不算合并跨度
    expect(skipped.has('0:1')).toBe(true)
    expect(skipped.has('1:0')).toBe(true)
    expect(skipped.has('1:1')).toBe(true)
    expect(skipped.has('0:0')).toBe(false) // 起点自身不跳过
    expect(skipped.size).toBe(3)
  })
})
