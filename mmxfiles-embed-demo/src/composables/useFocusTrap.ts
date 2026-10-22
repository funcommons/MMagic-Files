import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * 焦点陷阱 (#8 命令面板, 任意需要 keyboard-only 操作的浮层).
 *
 * 用法:
 *   const rootRef = ref<HTMLElement>()
 *   useFocusTrap(rootRef, isOpen)
 *
 * 当 isOpen=true:
 *   1. 自动把焦点送到第一个 [autofocus] / [tabindex="0"] / button / input / select / textarea
 *   2. 限制 Tab/Shift+Tab 在容器内循环
 *   3. Esc 触发 onEscape (可选)
 *   4. 卸载时把焦点还给之前激活的元素
 */
export interface FocusTrapOptions {
  onEscape?: () => void
  /** 自动 focus 第一个可选元素; 默认 true */
  autoFocus?: boolean
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
}

export function useFocusTrap(
  rootRef: Ref<HTMLElement | null | undefined>,
  activeRef: Ref<boolean>,
  options: FocusTrapOptions = {},
) {
  const { onEscape, autoFocus = true } = options
  let previouslyFocused: HTMLElement | null = null

  function onKeydown(e: KeyboardEvent) {
    if (!activeRef.value) return
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault()
      onEscape()
      return
    }
    if (e.key !== 'Tab') return
    const root = rootRef.value
    if (!root) return
    const focusables = getFocusable(root)
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function activate() {
    previouslyFocused = document.activeElement as HTMLElement | null
    if (autoFocus) {
      // 等待一帧让 DOM 完成更新
      requestAnimationFrame(() => {
        const root = rootRef.value
        if (!root) return
        const focusables = getFocusable(root)
        focusables[0]?.focus()
      })
    }
  }

  function deactivate() {
    previouslyFocused?.focus?.()
    previouslyFocused = null
  }

  watch(activeRef, (open) => {
    if (open) {
      activate()
      window.addEventListener('keydown', onKeydown, true)
    } else {
      window.removeEventListener('keydown', onKeydown, true)
      deactivate()
    }
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, true)
    deactivate()
  })
}