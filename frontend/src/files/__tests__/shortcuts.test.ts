/**
 * shortcuts.ts 纯工具单测（Lane H-2）：
 * - matchesHotkey：组合键命中/未声明修饰键拒绝/大小写不敏感/ctrl-or-meta 平台无关口径；
 * - isTypingTarget：input/textarea/contenteditable 判定（真实 dispatch 置 target）。
 */
import { describe, expect, it } from 'vitest'
import { isTypingTarget, matchesHotkey } from '../ui/shortcuts'

/** 在真实挂载元素上 dispatch keydown（target=该元素），返回事件供断言 */
function keydownOn(el: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  document.body.appendChild(el)
  const ev = new KeyboardEvent('keydown', init)
  el.dispatchEvent(ev)
  el.remove()
  return ev
}

describe('matchesHotkey', () => {
  it('命中：声明的修饰键全按下', () => {
    const ev = keydownOn(document.createElement('div'), { key: 'ArrowUp', altKey: true })
    expect(matchesHotkey(ev, { key: 'ArrowUp', alt: true })).toBe(true)
  })

  it('拒绝：声明的修饰键缺失 / 未声明的修饰键多按', () => {
    const plain = keydownOn(document.createElement('div'), { key: 'ArrowUp' })
    expect(matchesHotkey(plain, { key: 'ArrowUp', alt: true })).toBe(false)

    const altShift = keydownOn(document.createElement('div'), { key: 'ArrowUp', altKey: true, shiftKey: true })
    expect(matchesHotkey(altShift, { key: 'ArrowUp', alt: true })).toBe(false)
  })

  it('大小写不敏感：声明 a 命中 A（shift 大写形态），反之亦然', () => {
    const lower = keydownOn(document.createElement('div'), { key: 'a' })
    expect(matchesHotkey(lower, { key: 'A' })).toBe(true)
    const upper = keydownOn(document.createElement('div'), { key: 'A', shiftKey: true })
    expect(matchesHotkey(upper, { key: 'a', shift: true })).toBe(true)
  })

  it('ctrl 声明按 ctrl 或 meta 命中（平台无关）；裸键不得被 Ctrl/Cmd 组合误触', () => {
    const withCtrl = keydownOn(document.createElement('div'), { key: 'm', ctrlKey: true })
    const withMeta = keydownOn(document.createElement('div'), { key: 'm', metaKey: true })
    expect(matchesHotkey(withCtrl, { key: 'M', ctrl: true })).toBe(true)
    expect(matchesHotkey(withMeta, { key: 'M', ctrl: true })).toBe(true)

    const bare = keydownOn(document.createElement('div'), { key: 'm' })
    expect(matchesHotkey(bare, { key: 'm', ctrl: true })).toBe(false)
    const cmdBare = keydownOn(document.createElement('div'), { key: 'x', metaKey: true })
    expect(matchesHotkey(cmdBare, { key: 'x' })).toBe(false)
  })

  it('meta 单独声明精确匹配；alt 独立判定不受 ctrl 位影响', () => {
    const withMeta = keydownOn(document.createElement('div'), { key: 'k', metaKey: true })
    expect(matchesHotkey(withMeta, { key: 'k', meta: true })).toBe(true)
    expect(matchesHotkey(withMeta, { key: 'k' })).toBe(false)

    const altCtrl = keydownOn(document.createElement('div'), { key: 'ArrowDown', altKey: true, ctrlKey: true })
    expect(matchesHotkey(altCtrl, { key: 'ArrowDown', alt: true })).toBe(false)
  })

  it('key 不同不命中', () => {
    const ev = keydownOn(document.createElement('div'), { key: 'ArrowLeft', altKey: true })
    expect(matchesHotkey(ev, { key: 'ArrowUp', alt: true })).toBe(false)
  })
})

describe('isTypingTarget', () => {
  it('input / textarea / contenteditable → true；普通元素 → false', () => {
    expect(isTypingTarget(keydownOn(document.createElement('input'), { key: 'a' }))).toBe(true)
    expect(isTypingTarget(keydownOn(document.createElement('textarea'), { key: 'a' }))).toBe(true)

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', '')
    expect(isTypingTarget(keydownOn(editable, { key: 'a' }))).toBe(true)

    expect(isTypingTarget(keydownOn(document.createElement('div'), { key: 'a' }))).toBe(false)
    expect(isTypingTarget(keydownOn(document.createElement('ul'), { key: 'Enter' }))).toBe(false)
  })
})
