/**
 * useRecentList — localStorage 持久化的 LRU 列表 (最近使用).
 *
 * 从 composables/sdk/useRecentList.ts 搬入 (FcImagePicker / ColorPickerPopover 共用).
 * 移除了 @/utils/logger 依赖, 改用内联 console.warn (跟 FcImagePicker 一致).
 *
 * 用法:
 *   const { items, add, clear } = useRecentList<string>({
 *     key: 'my-feature:recent',
 *     limit: 12,
 *     validate: (s) => s.length > 0,
 *   })
 *
 * - 启动时自动从 localStorage 读
 * - add(item) → 去重 + 移到队首 + slice 到 limit + 写回
 * - items 是 Ref<T[]>, 可直接 v-for
 */
import { ref, type Ref } from 'vue'

// 内联最小 logger (替代 @/utils/logger, 消除 SDK 外部依赖)
const log = {
  warn: (...args: unknown[]) => console.warn(...args),
}

export interface UseRecentListOptions<T> {
  /** localStorage key */
  key: string
  /** 最多保留条数, 默认 12 */
  limit?: number
  /** 添加前过滤 (返回 false 跳过). 比如验证 hex 格式 */
  validate?: (item: T) => boolean
  /** 读取失败的 fallback, 默认 [] */
  fallback?: T[]
}

export function useRecentList<T>(options: UseRecentListOptions<T>) {
  const limit = options.limit ?? 12
  const items = ref<T[]>([]) as Ref<T[]>
  const tag = `[useRecentList:${options.key}]`

  function load() {
    try {
      const raw = localStorage.getItem(options.key)
      if (raw) items.value = JSON.parse(raw) as T[]
    } catch (err) {
      log.warn(`${tag} load failed:`, err)
    }
  }

  function persist() {
    try {
      localStorage.setItem(options.key, JSON.stringify(items.value))
    } catch (err) {
      log.warn(`${tag} persist failed:`, err)
    }
  }

  /** 去重 + 前置 + 截断, 并立即写回 */
  function add(item: T) {
    if (options.validate && !options.validate(item)) return
    const filtered = items.value.filter((existing) => existing !== item)
    filtered.unshift(item)
    items.value = filtered.slice(0, limit)
    persist()
  }

  function clear() {
    items.value = options.fallback ? [...options.fallback] : []
    try {
      localStorage.removeItem(options.key)
    } catch (err) {
      log.warn(`${tag} clear failed:`, err)
    }
  }

  /** 删除单项, 立即写回 */
  function remove(item: T) {
    items.value = items.value.filter((existing) => existing !== item)
    persist()
  }

  /** 复制快照 */
  function getAll(): T[] {
    return [...items.value]
  }

  load()

  return { items, add, remove, clear, getAll, limit }
}