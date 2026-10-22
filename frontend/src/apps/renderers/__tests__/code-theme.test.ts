/**
 * code-editor 主题适配单测（code-editor升级建议 P1-1）
 * 被测：src/apps/renderers/code-theme.ts——normalizeHexColor / isDarkHost /
 *       buildMonacoTheme（8 类核心 token 映射+兜底）/ observeHostTheme（MutationObserver 联动）
 * readHostThemeVars 是 getComputedStyle 薄层不单测（jsdom 变量为空——buildMonacoTheme 的 null
 * 兜底分支即为其全 null 形态的覆盖）。
 */
import { describe, expect, it, vi } from 'vitest'
import { buildMonacoTheme, isDarkHost, normalizeHexColor, observeHostTheme, type HostThemeVars } from '../code-theme'

// ───────────────────────── normalizeHexColor ─────────────────────────

describe('normalizeHexColor：CSS 色值 → #RRGGBB[AA]', () => {
  it('十六系：#RGB 展开 / #RRGGBB / #RRGGBBAA 原样（小写归一）', () => {
    expect(normalizeHexColor('#fff')).toBe('#ffffff')
    expect(normalizeHexColor('#F0E68C')).toBe('#f0e68c')
    expect(normalizeHexColor('#80808080')).toBe('#80808080')
  })

  it('函数色：rgb()/rgba() → hex（alpha 乘 255 四舍五入）', () => {
    expect(normalizeHexColor('rgb(16, 24, 32)')).toBe('#101820')
    expect(normalizeHexColor('rgba(255, 0, 0, 0.25)')).toBe('#ff000040') // 0.25*255≈64=0x40
    expect(normalizeHexColor('rgba(0,0,0,0)')).toBe('#00000000')
    expect(normalizeHexColor('rgba(1,2,3,1)')).toBe('#010203ff')
  })

  it('垃圾输入 → null（color-mix/渐变/空/越界）', () => {
    expect(normalizeHexColor('')).toBeNull()
    expect(normalizeHexColor('  ')).toBeNull()
    expect(normalizeHexColor('color-mix(in srgb, #fff 10%, transparent)')).toBeNull()
    expect(normalizeHexColor('linear-gradient(#fff, #000)')).toBeNull()
    expect(normalizeHexColor('rgb(300, 0, 0)')).toBeNull() // 越界
    expect(normalizeHexColor('rgba(1,2,3,1.5)')).toBeNull() // alpha 越界
    expect(normalizeHexColor('var(--x)')).toBeNull()
  })

  it('前后空白容忍', () => {
    expect(normalizeHexColor('  #abc ')).toBe('#aabbcc')
  })
})

// ───────────────────────── isDarkHost ─────────────────────────

describe('isDarkHost：data-theme 非 light 即暗（orange-black 同按暗基线）', () => {
  it('light / 缺省 → false；dark / orange-black → true（真实 documentElement 逐值）', () => {
    const de = document.documentElement
    const cases: Array<[string | null, boolean]> = [
      [null, false],
      ['light', false],
      ['dark', true],
      ['orange-black', true],
    ]
    for (const [v, expected] of cases) {
      if (v === null) de.removeAttribute('data-theme')
      else de.setAttribute('data-theme', v)
      expect(isDarkHost(document), `data-theme=${v}`).toBe(expected)
    }
    de.removeAttribute('data-theme')
  })

  it('真实 document：jsdom 默认无 data-theme → light', () => {
    expect(isDarkHost(document)).toBe(false)
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(isDarkHost(document)).toBe(true)
    document.documentElement.setAttribute('data-theme', 'light')
    expect(isDarkHost(document)).toBe(false)
    document.documentElement.removeAttribute('data-theme')
  })
})

// ───────────────────────── buildMonacoTheme ─────────────────────────

/** 全量变量（亮色典型值） */
const LIGHT_VARS: HostThemeVars = {
  bgCard: '#ffffff',
  bgMuted: '#f5f7fa',
  textPrimary: '#1d1d1f',
  textSecondary: '#6e6e73',
  textTertiary: '#999999',
  primary: '#409eff',
  separator: '#dcdfe6',
}

describe('buildMonacoTheme：8 类核心 token 映射', () => {
  it('亮色：base=vs、变量直映（bg/fg/行号/选区带 alpha/行高亮）', () => {
    const t = buildMonacoTheme(LIGHT_VARS, false)
    expect(t.base).toBe('vs')
    expect(t.inherit).toBe(true) // 长尾 token 基线兜底
    expect(t.colors['editor.background']).toBe('#ffffff')
    expect(t.colors['editor.foreground']).toBe('#1d1d1f')
    expect(t.colors['editorLineNumber.foreground']).toBe('#999999')
    expect(t.colors['editor.selectionBackground']).toBe('#409eff4d') // 30% 透明主色
    expect(t.colors['editor.lineHighlightBackground']).toBe('#f5f7fa')
    expect(t.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: 'comment', foreground: '#999999' }),
        expect.objectContaining({ token: 'keyword', foreground: '#409eff' }),
        expect.objectContaining({ token: 'string', foreground: '#0b7a3e' }),
        expect.objectContaining({ token: 'number', foreground: '#098658' }),
      ]),
    )
  })

  it('暗色：base=vs-dark、语法近似色切暗系（string/number 亮绿系）', () => {
    const t = buildMonacoTheme(
      { ...LIGHT_VARS, bgCard: '#1b1f24', textPrimary: '#e5eaf3', primary: '#3d8bfd' },
      true,
    )
    expect(t.base).toBe('vs-dark')
    expect(t.colors['editor.background']).toBe('#1b1f24')
    expect(t.colors['editor.selectionBackground']).toBe('#3d8bfd4d')
    const by = (tok: string) => t.rules.find((r) => r.token === tok)
    expect(by('string')!.foreground).toBe('#98c379')
    expect(by('number')!.foreground).toBe('#b5cea8')
  })

  it('变量缺失（全 null）：亮/暗双兜底色（vs/vs-dark 口径）', () => {
    const empty: HostThemeVars = {
      bgCard: null, bgMuted: null, textPrimary: null, textSecondary: null,
      textTertiary: null, primary: null, separator: null,
    }
    const light = buildMonacoTheme(empty, false)
    expect(light.colors['editor.background']).toBe('#ffffff')
    expect(light.colors['editor.foreground']).toBe('#333333')
    const dark = buildMonacoTheme(empty, true)
    expect(dark.colors['editor.background']).toBe('#1e1e1e')
    expect(dark.colors['editor.foreground']).toBe('#d4d4d4')
    expect(dark.rules.find((r) => r.token === 'keyword')!.foreground).toBe('#3794ff')
  })

  it('rules 前景 alpha 截断：带 alpha 的变量值截为 #RRGGBB（rules 不认 alpha）', () => {
    const t = buildMonacoTheme({ ...LIGHT_VARS, textTertiary: '#99999966' }, false)
    expect(t.rules.find((r) => r.token === 'comment')!.foreground).toBe('#999999')
  })
})

// ───────────────────────── observeHostTheme ─────────────────────────

describe('observeHostTheme：data-theme/data-brand 变更联动', () => {
  it('切 data-theme / data-brand 触发回调；解绑后不再触发', async () => {
    const cb = vi.fn()
    const stop = observeHostTheme(document, cb)
    expect(cb).not.toHaveBeenCalled()

    document.documentElement.setAttribute('data-theme', 'dark')
    await Promise.resolve() // MutationObserver 微任务投递
    expect(cb).toHaveBeenCalledTimes(1)

    document.documentElement.setAttribute('data-brand', 'apple')
    await Promise.resolve()
    expect(cb).toHaveBeenCalledTimes(2)

    document.documentElement.setAttribute('data-theme', 'dark') // 同值重复设置：attributes 变更仍触发（保守联动可接受）
    await Promise.resolve()
    expect(cb).toHaveBeenCalledTimes(3)

    stop()
    document.documentElement.setAttribute('data-theme', 'light')
    await Promise.resolve()
    expect(cb).toHaveBeenCalledTimes(3) // 解绑后静默
    document.documentElement.removeAttribute('data-brand')
    document.documentElement.removeAttribute('data-theme')
  })

  it('无关属性变更不触发', async () => {
    const cb = vi.fn()
    const stop = observeHostTheme(document, cb)
    document.documentElement.setAttribute('data-foo', 'x')
    document.documentElement.setAttribute('lang', 'en')
    await new Promise((r) => setTimeout(r, 10))
    expect(cb).not.toHaveBeenCalled()
    stop()
    document.documentElement.removeAttribute('data-foo')
    document.documentElement.removeAttribute('lang')
  })
})
