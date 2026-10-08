import { ref, watch, type Ref } from 'vue'

/**
 * useLocalStorage — 把 localStorage[key] 绑定到响应式 Ref, 双向同步.
 *
 * 用法:
 *   const lastModel = useLocalStorage<string | null>('create-image-last-model', null)
 *   const userPrefs = useLocalStorage<{ theme: string }>('user-prefs', { theme: 'light' })
 *
 * - 初始值从 localStorage 读 (不存在则用 defaultValue)
 * - ref 变化时自动写回 localStorage (JSON.stringify)
 * - 仅在客户端执行 (SSR safe — typeof window 判断)
 * - 解析失败时降级为 defaultValue
 */
export function useLocalStorage<T>(key: string, defaultValue: T): Ref<T> {
  const stored = read(key, defaultValue)
  const value = ref(stored) as Ref<T>

  watch(value, v => write(key, v), { deep: true })

  return value
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota exceeded / private mode — silently fail (caller 仍持有 in-memory state)
  }
}