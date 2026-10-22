/**
 * options.ts 单测（插件纯逻辑：参数归一化 + 强调色解析）
 * 被测：plugins/artplayer-player/src/options.ts（FALLBACK_THEME / normalizeOptions / resolveTheme）
 * 契约：方案 §2.3——参数坏不击穿渲染链，非法值一律丢弃走缺省：
 *   - normalizeOptions：非对象（undefined/null/数组/字符串/原始值）→ { autoplay:false, theme:FALLBACK_THEME }；
 *     autoplay 严格 === true 才生效（'true'/1 等真值一律 false）；theme 仅收合法字符串且 trim，
 *     空串/纯空白/非字符串 → FALLBACK_THEME；返回对象只含 autoplay/theme 两键（多余字段不透出）。
 *   - resolveTheme：theme ≠ FALLBACK（自定义值）短路原样返回、不触碰 DOM；
 *     theme = FALLBACK 时读宿主 --app-primary，取空/纯空白（trim 后空）/读的过程抛异常 → FALLBACK_THEME。
 * 环境：jsdom 29 实测 getComputedStyle 可读回内联 CSS 自定义属性（探针验证），
 *       注入用例直接 documentElement.style.setProperty；异常/取空分支用 getComputedStyle spy 注入，
 *       afterEach 统一 restoreAllMocks + removeProperty('--app-primary') 防跨用例泄漏。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_THEME, normalizeOptions, resolveTheme } from '../options'

// 文件级清理：spy（含抛错型 getComputedStyle mock）与内联 CSS 变量不跨用例泄漏
afterEach(() => {
  document.documentElement.style.removeProperty('--app-primary')
  vi.restoreAllMocks()
})

// ───────────────────────── FALLBACK_THEME 兜底值 ─────────────────────────

describe('FALLBACK_THEME', () => {
  it('为 Artplayer 出厂强调色 #23ade5（契约值钉死）', () => {
    expect(FALLBACK_THEME).toBe('#23ade5')
  })
})

// ───────────────────────── normalizeOptions · 非法入参走缺省 ─────────────────────────

describe('normalizeOptions · 非对象入参 → 全缺省', () => {
  it('undefined / null → { autoplay:false, theme:FALLBACK_THEME }', () => {
    expect(normalizeOptions(undefined)).toEqual({ autoplay: false, theme: FALLBACK_THEME })
    expect(normalizeOptions(null)).toEqual({ autoplay: false, theme: FALLBACK_THEME })
  })

  it('数组 / 字符串 → 全缺省（Array.isArray 挡数组，typeof 挡原始值）', () => {
    expect(normalizeOptions([])).toEqual({ autoplay: false, theme: FALLBACK_THEME })
    expect(normalizeOptions([{ autoplay: true, theme: '#ff0000' }])).toEqual({
      autoplay: false,
      theme: FALLBACK_THEME,
    })
    expect(normalizeOptions('{ "autoplay": true }')).toEqual({
      autoplay: false,
      theme: FALLBACK_THEME,
    })
  })

  it('其余原始值（数字/布尔/NaN）→ 全缺省', () => {
    expect(normalizeOptions(1)).toEqual({ autoplay: false, theme: FALLBACK_THEME })
    expect(normalizeOptions(false)).toEqual({ autoplay: false, theme: FALLBACK_THEME })
    expect(normalizeOptions(NaN)).toEqual({ autoplay: false, theme: FALLBACK_THEME })
  })
})

// ───────────────────────── normalizeOptions · autoplay 严格布尔 ─────────────────────────

describe('normalizeOptions · autoplay 仅 === true 生效', () => {
  it('autoplay: true → true', () => {
    expect(normalizeOptions({ autoplay: true }).autoplay).toBe(true)
  })

  it('真值但非严格 true（字符串/数字/对象/非零）→ false', () => {
    expect(normalizeOptions({ autoplay: 'true' }).autoplay).toBe(false)
    expect(normalizeOptions({ autoplay: 1 }).autoplay).toBe(false)
    expect(normalizeOptions({ autoplay: 'yes' }).autoplay).toBe(false)
    expect(normalizeOptions({ autoplay: {} }).autoplay).toBe(false)
  })

  it('缺省 / false / null → false', () => {
    expect(normalizeOptions({}).autoplay).toBe(false)
    expect(normalizeOptions({ autoplay: false }).autoplay).toBe(false)
    expect(normalizeOptions({ autoplay: null }).autoplay).toBe(false)
  })
})

// ───────────────────────── normalizeOptions · theme 清洗 ─────────────────────────

describe('normalizeOptions · theme 合法字符串 trim 保留', () => {
  it('两侧空白被 trim，内部原样保留', () => {
    expect(normalizeOptions({ theme: '  #ff0000  ' }).theme).toBe('#ff0000')
    expect(normalizeOptions({ theme: '\t #23ade5 \n' }).theme).toBe('#23ade5')
    expect(normalizeOptions({ theme: '#  ff0000' }).theme).toBe('#  ff0000')
  })

  it('空串 / 纯空白 / 非字符串 → FALLBACK_THEME', () => {
    expect(normalizeOptions({ theme: '' }).theme).toBe(FALLBACK_THEME)
    expect(normalizeOptions({ theme: '   ' }).theme).toBe(FALLBACK_THEME)
    expect(normalizeOptions({ theme: 123 }).theme).toBe(FALLBACK_THEME)
    expect(normalizeOptions({ theme: null }).theme).toBe(FALLBACK_THEME)
    expect(normalizeOptions({ theme: undefined }).theme).toBe(FALLBACK_THEME)
    expect(normalizeOptions({ theme: ['#fff'] }).theme).toBe(FALLBACK_THEME)
  })

  it('缺省 theme 键 → FALLBACK_THEME', () => {
    expect(normalizeOptions({}).theme).toBe(FALLBACK_THEME)
  })
})

// ───────────────────────── normalizeOptions · 只透出两键 ─────────────────────────

describe('normalizeOptions · 多余字段不透出', () => {
  it('输出仅含 autoplay/theme 两键，注入字段被丢弃', () => {
    const out = normalizeOptions({
      autoplay: true,
      theme: ' #112233 ',
      volume: 0.5,
      extra: 'x',
      // 故意塞 Object.prototype 同名键（原型污染形态），验证不透出
      toString: 'polluted',
    })
    expect(out).toEqual({ autoplay: true, theme: '#112233' })
    expect(Object.keys(out).sort()).toEqual(['autoplay', 'theme'])
  })
})

// ───────────────────────── resolveTheme · 自定义 theme 短路 ─────────────────────────

describe('resolveTheme · 自定义 theme（≠ FALLBACK）原样返回', () => {
  it('不触碰 DOM：getComputedStyle 抛错也不影响返回', () => {
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('DOM 不可用')
    })
    expect(resolveTheme({ autoplay: false, theme: '#ff0000' })).toBe('#ff0000')
    expect(resolveTheme({ autoplay: false, theme: ' #abc ' })).toBe(' #abc ') // 原样, 不 trim 不校验格式
    expect(spy).not.toHaveBeenCalled()
  })
})

// ───────────────────────── resolveTheme · FALLBACK 时读宿主 --app-primary ─────────────────────────

describe('resolveTheme · theme=FALLBACK 读 --app-primary', () => {
  it('宿主主色存在 → 返回该值（真实 DOM 注入，jsdom 29 支持内联变量读回）', () => {
    document.documentElement.style.setProperty('--app-primary', '#ff0000')
    expect(resolveTheme({ autoplay: false, theme: FALLBACK_THEME })).toBe('#ff0000')
  })

  it('读到的值取空（空串）/ 纯空白 → trim 后为空, 走 FALLBACK_THEME', () => {
    const empty = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue: () => '' } as unknown as CSSStyleDeclaration)
    expect(resolveTheme({ autoplay: false, theme: FALLBACK_THEME })).toBe(FALLBACK_THEME)
    expect(empty).toHaveBeenCalledWith(document.documentElement)

    const blank = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue: () => '   ' } as unknown as CSSStyleDeclaration)
    expect(resolveTheme({ autoplay: false, theme: FALLBACK_THEME })).toBe(FALLBACK_THEME)
    expect(blank).toHaveBeenCalled()
  })

  it('getComputedStyle 抛异常（documentElement 未就绪等）→ FALLBACK_THEME, 不外抛', () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => resolveTheme({ autoplay: false, theme: FALLBACK_THEME })).not.toThrow()
    expect(resolveTheme({ autoplay: false, theme: FALLBACK_THEME })).toBe(FALLBACK_THEME)
  })

  it('宿主主色 ≠ 兜底值时优先宿主主色（#123456）', () => {
    document.documentElement.style.setProperty('--app-primary', '#123456')
    expect(resolveTheme({ autoplay: false, theme: FALLBACK_THEME })).toBe('#123456')
  })
})
