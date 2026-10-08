import { ElMessage } from 'element-plus'
import i18n from '@/locales'

/**
 * 复制到剪贴板 (#22 复制即反馈).
 *
 * - 优先用 navigator.clipboard.writeText (HTTPS / localhost)
 * - 失败降级用 textarea + execCommand('copy')
 * - 成功 toast 显示 ux.toast.copied, 失败 toast 显示 ux.toast.copy-failed
 */
export function useClipboard() {
  async function copy(text: string): Promise<boolean> {
    const ok = await copySilent(text)
    if (ok) {
      ElMessage.success(i18n.global.t('ux.toast.copied'))
    } else {
      ElMessage.error(i18n.global.t('ux.toast.copy-failed'))
    }
    return ok
  }

  return { copy }
}

/**
 * 静默复制 (无 toast), 给已经在用 useClipboard 的复合场景复用.
 */
export async function copySilent(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fallthrough to fallback
  }

  // Fallback: textarea + execCommand
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}