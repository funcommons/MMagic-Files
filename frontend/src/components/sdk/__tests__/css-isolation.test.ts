import { describe, it, expect } from 'vitest'

/**
 * CSS 隔离守护 — 保证 SDK 可 copy 进宿主项目而不污染其全局样式.
 *
 * 规则 A: 组件的 <style> 必须 scoped. 例外白名单 = teleport 到 body 的浮层
 *         (scoped 对 teleport 出去的 DOM 失效, 必须全局).
 * 规则 B: 白名单里的全局 <style>, 顶层选择器必须以 .fc- 开头
 *         (禁止裸标签 / 非 fc 前缀类名泄漏到宿主).
 */

// 原始源码 (?raw), key 为相对路径
const raw = import.meta.glob('../**/*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// 允许全局样式的组件: teleport 到 body 的浮层 (scoped 失效) +
// 需穿透覆盖 EP 内部结构的组件. 仍受规则 B (.fc- 前缀) 约束.
const GLOBAL_WHITELIST = new Set([
  'FcDrawer',
  'FcDialog',
  'FcTooltip',
  'FcPopover',
  'FcPicker',
  'FcSidePanel',
  'FcNavGroup',
])

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function styleBlocks(src: string): { attrs: string; body: string }[] {
  const blocks: { attrs: string; body: string }[] = []
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) blocks.push({ attrs: m[1] ?? '', body: m[2] ?? '' })
  return blocks
}

// 按 brace 深度提取 depth-0 的选择器 (at-rule / 嵌套内部不下钻)
function topLevelSelectors(css: string): string[] {
  const sels: string[] = []
  let depth = 0
  let buf = ''
  for (const ch of css) {
    if (ch === '{') {
      if (depth === 0) sels.push(buf.replace(/\s+/g, ' ').trim())
      depth++
      buf = ''
    } else if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0) buf = ''
    } else if (depth === 0) {
      buf += ch
    }
  }
  return sels.filter(Boolean)
}

const entries = Object.entries(raw).map(([path, src]) => ({
  name: path.split('/').pop()!.replace('.vue', ''),
  src,
}))

describe('SDK CSS 隔离守护', () => {
  it('扫描到的 SDK 组件数应合理 (>30)', () => {
    expect(entries.length).toBeGreaterThan(30)
  })

  for (const { name, src } of entries) {
    const blocks = styleBlocks(src)
    if (!blocks.length) continue

    blocks.forEach((b, i) => {
      const scoped = /\bscoped\b/.test(b.attrs)

      it(`${name} 的 <style#${i}> 必须 scoped 或在浮层白名单`, () => {
        if (!scoped) {
          expect(
            GLOBAL_WHITELIST.has(name),
            `${name} 有非 scoped 全局样式却不在白名单; 若非 teleport 浮层请加 scoped`,
          ).toBe(true)
        }
      })

      if (!scoped && GLOBAL_WHITELIST.has(name)) {
        it(`${name} 的全局 <style#${i}> 顶层选择器须 .fc- 前缀`, () => {
          const sels = topLevelSelectors(stripComments(b.body))
          const bad = sels.filter(
            (s) =>
              !s.startsWith('@') &&
              !s.split(',').every((part) => part.trim().startsWith('.fc-')),
          )
          expect(bad, `泄漏风险选择器: ${bad.join(' | ')}`).toEqual([])
        })
      }
    })
  }
})
