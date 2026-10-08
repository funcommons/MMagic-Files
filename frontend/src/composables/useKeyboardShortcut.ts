import { onBeforeUnmount, onMounted } from 'vue'

/**
 * 全局快捷键注册 (#9 快捷键体系).
 *
 * 支持组合键写法 (大小写无关):
 *   'mod+k'        → Cmd+K (mac) / Ctrl+K (其它)
 *   'mod+s'        → Cmd/Ctrl+S
 *   'mod+shift+z'  → Cmd/Ctrl+Shift+Z
 *   'esc'          → Escape
 *   'enter'        → Enter
 *
 * 注册在 window keydown 上, 自动在组件卸载时清理.
 *
 * 用法:
 *   useKeyboardShortcut('mod+k', () => paletteOpen.value = true)
 */

export type ShortcutHandler = (e: KeyboardEvent) => void
export type ShortcutCombo = string

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function isModKey(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

function match(combo: ShortcutCombo, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split('+').map(s => s.trim())
  const expectMod = parts.includes('mod')
  const expectShift = parts.includes('shift')
  const expectAlt = parts.includes('alt')
  const key = parts[parts.length - 1]

  if (expectMod !== isModKey(e)) return false
  if (expectShift !== e.shiftKey) return false
  if (expectAlt !== e.altKey) return false

  const ek = e.key.toLowerCase()
  if (key === 'esc') return ek === 'escape'
  if (key === 'enter') return ek === 'enter'
  if (key === 'space') return ek === ' ' || ek === 'spacebar'
  return ek === key
}

export function useKeyboardShortcut(combo: ShortcutCombo, handler: ShortcutHandler) {
  const wrapped = (e: KeyboardEvent) => {
    if (match(combo, e)) {
      e.preventDefault()
      handler(e)
    }
  }
  onMounted(() => window.addEventListener('keydown', wrapped))
  onBeforeUnmount(() => window.removeEventListener('keydown', wrapped))
}