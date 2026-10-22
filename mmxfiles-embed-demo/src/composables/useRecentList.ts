import { ref, watch, type Ref } from 'vue'
import { loadJSON, saveJSON } from '@/utils/storage'

/**
 * 通用最近使用 (#13 最近使用 / 历史).
 *
 * 把已有 useRecentImages/useRecentProvider 思路抽成任意对象类型的最近记录,
 * 通用"我最近访问过"快速入口,适用于任意业务列表.
 *
 * 用法:
 *   const recent = useRecentList<BenefitItem>({
 *     key: 'benefit-items:recent',
 *     max: 8,
 *     idKey: 'id',
 *     labelKey: 'name',
 *   })
 *
 *   recent.pick(item)   // 推入最近
 *   recent.list         // Ref<BenefitItem[]> (最新在前, 去重)
 *
 * 持久化: localStorage; SSR 安全.
 */

export interface RecentItem {
  id?: string | number
}

export interface UseRecentListOptions<T extends RecentItem> {
  key: string
  max?: number
  /** id 字段名, 默认 'id' */
  idKey?: keyof T
  /** 列表展示用的 label 字段名 (业务可读, 仅做记录, 渲染时由 UI 自己取) */
  labelKey?: keyof T
  prefix?: string
}

export function useRecentList<T extends RecentItem>(
  options: UseRecentListOptions<T>,
) {
  const { key, max = 10, idKey = 'id' as keyof T, prefix = 'ux' } = options
  const storageKey = `${prefix}:recent:${key}`

  const list = ref<T[]>(loadJSON<T[]>(storageKey, [], { prefix: '' })) as Ref<T[]>

  function pick(item: T) {
    const id = item[idKey]
    if (id === undefined || id === null) return
    const filtered = list.value.filter((x: T) => x[idKey] !== id)
    filtered.unshift(item)
    list.value = filtered.slice(0, max)
  }

  function clear() {
    list.value = []
  }

  function remove(id: T[keyof T]) {
    list.value = list.value.filter((x: T) => x[idKey] !== id)
  }

  watch(list, (v) => saveJSON(storageKey, v, { prefix: '' }), { deep: true })

  return { list, pick, clear, remove }
}