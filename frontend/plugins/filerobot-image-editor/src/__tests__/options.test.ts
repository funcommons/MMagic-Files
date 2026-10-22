/**
 * 纯逻辑单测：options.ts（normalizeOptions / exportExtOf / TAB_IDS）× types.ts（EDITABLE_EXTS）。
 * 无 DOM 依赖，jsdom 环境下直接跑。
 */
import { describe, it, expect } from 'vitest'
import { TAB_IDS, DEFAULT_TAB, normalizeOptions, exportExtOf } from '../options'
import { EDITABLE_EXTS } from '../types'

describe('normalizeOptions — 非对象输入走缺省', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['数组', ['Crop']],
    ['字符串', 'Crop'],
    ['数字', 42],
  ])('%s → { defaultTab: "Annotate" }', (_label, raw) => {
    expect(normalizeOptions(raw)).toEqual({ defaultTab: DEFAULT_TAB })
  })
})

describe('normalizeOptions — defaultTab 合法值逐个保留', () => {
  it.each(TAB_IDS.map((tab) => [tab, tab] as const))('%s 保留', (_label, tab) => {
    expect(normalizeOptions({ defaultTab: tab })).toEqual({ defaultTab: tab })
  })
})

describe('normalizeOptions — defaultTab 非法值回落 Annotate', () => {
  it.each([
    ['旧缺省 Crop（已移出枚举）', 'Crop'],
    ['不存在的标识 Annotates', 'Annotates'],
    ['小写 adjust', 'adjust'],
    ['数字', 123],
    ['空串', ''],
  ])('%s → "Annotate"', (_label, bad) => {
    expect(normalizeOptions({ defaultTab: bad })).toEqual({ defaultTab: DEFAULT_TAB })
  })
})

describe('normalizeOptions — 多余字段不透出', () => {
  it('输出精确只含 defaultTab 单键', () => {
    expect(normalizeOptions({ defaultTab: 'Filters', foo: 1, bar: 'x', baz: null })).toEqual({
      defaultTab: 'Filters',
    })
    expect(Object.keys(normalizeOptions({ defaultTab: 'Filters', foo: 1 }))).toEqual(['defaultTab'])
  })
})

describe('exportExtOf', () => {
  it.each([
    ['a.png', 'png'],
    ['a.jpg', 'jpg'],
    ['a.jpeg', 'jpeg'],
    ['a.webp', 'webp'],
    ['a.bmp', 'png'],
    ['a.gif', 'png'],
    ['noext', 'png'],
    ['A.JPG', 'jpg'],
  ])('exportExtOf(%s) → %s', (name, ext) => {
    expect(exportExtOf(name)).toBe(ext)
  })

  it('与 EDITABLE_EXTS 对齐：png/jpg/jpeg/webp 原样导出，bmp/gif 回落 png', () => {
    expect(new Set(EDITABLE_EXTS)).toEqual(new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']))
    for (const ext of EDITABLE_EXTS) {
      expect(exportExtOf(`file.${ext}`)).toBe(['jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png')
    }
  })
})

describe('TAB_IDS', () => {
  it('恰含 6 个且与实现白名单一致', () => {
    expect(TAB_IDS).toHaveLength(6)
    expect([...TAB_IDS]).toEqual([
      'Adjust',
      'Finetune',
      'Filters',
      'Annotate',
      'Resize',
      'Watermark',
    ])
    expect(new Set(TAB_IDS).size).toBe(6)
  })

  it('DEFAULT_TAB 为 Annotate 且在枚举内', () => {
    expect(DEFAULT_TAB).toBe('Annotate')
    expect(TAB_IDS).toContain(DEFAULT_TAB)
  })
})
