import { watch, onBeforeUnmount, ref, type Ref } from 'vue'
import { saveJSON, loadJSON } from '@/utils/storage'

/**
 * 表单草稿自动保存与恢复 (#10 草稿自动恢复).
 *
 * 用法:
 *   const form = reactive({ name: '', description: '' })
 *   const draft = useFormDraft(form, 'benefit-items:create', { ttlMs: 7 * 24 * 3600 * 1000 })
 *
 *   onMounted(() => draft.restore())
 *
 *   if (draft.hasDraft.value) show banner with restore/discard
 *
 * 行为:
 *   1. deep watch form → 立即写入 localStorage (key: <prefix>draft:<scope>)
 *   2. 写入时附带 { savedAt, version }, 读取时校验 TTL
 *   3. clear() 后再写入, 清掉草稿
 *   4. hasDraft 在初始化时一次性读取, 用于 UI 弹恢复提示
 */

interface DraftEnvelope<T> {
  data: T
  savedAt: number
  version: number
}

export interface UseFormDraftOptions {
  /** 草稿存活时间, 默认 7 天 */
  ttlMs?: number
  /** schema 版本, 业务结构变更后 bump 一下, 旧草稿自动失效 */
  version?: number
  /** 写入防抖, 默认 400ms (避免每键击都序列化) */
  debounceMs?: number
  /** 自定义前缀, 默认 'ux' */
  prefix?: string
}

export interface UseFormDraftReturn {
  /** 是否有可用草稿 (初始化时同步读一次) */
  hasDraft: Ref<boolean>
  /** 把 form 恢复到草稿 */
  restore(): boolean
  /** 丢弃草稿 (UI 选了 "不恢复" 或提交成功后) */
  discard(): void
  /** 主动写入一次 (防抖后的) */
  flush(): void
  /** 草稿最后保存时间, 用于 UI 显示 "已自动保存于 X" */
  savedAt: Ref<number | null>
}

export function useFormDraft<T extends object>(
  form: T,
  scope: string,
  options: UseFormDraftOptions = {},
): UseFormDraftReturn {
  const { ttlMs = 7 * 24 * 3600 * 1000, version = 1, debounceMs = 400, prefix = 'ux' } = options
  const key = `${prefix}:draft:${scope}`

  const hasDraft = ref(false)
  const savedAt = ref<number | null>(null)

  const initial = loadJSON<DraftEnvelope<T> | null>(key, null, { prefix: '' })
  if (initial && Date.now() - initial.savedAt < ttlMs && initial.version === version) {
    hasDraft.value = true
    savedAt.value = initial.savedAt
  } else if (initial) {
    // 过期 / 旧版本 → 顺手清掉
    localStorage.removeItem(key)
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  function write() {
    const env: DraftEnvelope<T> = {
      data: JSON.parse(JSON.stringify(form)),
      savedAt: Date.now(),
      version,
    }
    saveJSON(key, env, { prefix: '' })
    savedAt.value = env.savedAt
  }

  watch(
    form,
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(write, debounceMs)
    },
    { deep: true },
  )

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })

  function restore(): boolean {
    const env = loadJSON<DraftEnvelope<T> | null>(key, null, { prefix: '' })
    if (!env || Date.now() - env.savedAt >= ttlMs) return false
    Object.assign(form, env.data)
    savedAt.value = env.savedAt
    return true
  }

  function discard() {
    localStorage.removeItem(key)
    hasDraft.value = false
    savedAt.value = null
  }

  function flush() {
    if (timer) clearTimeout(timer)
    write()
  }

  return { hasDraft, restore, discard, flush, savedAt }
}