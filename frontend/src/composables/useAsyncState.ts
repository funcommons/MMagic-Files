import { ref, shallowRef, type Ref } from 'vue'

/**
 * async 状态封装 (#7 错误边界 + 重试).
 *
 * 用法:
 *   const items = useAsyncState(() => fetchItems(), { initial: [] })
 *   items.reload()
 *
 *   <template v-if="items.loading.value"> ... <FcSkeleton /> ... </template>
 *   <template v-else-if="items.error.value"> ... <Retry @click="items.reload" /> ... </template>
 *   <template v-else> ... {{ items.data.value }} ... </template>
 *
 * 设计: data 用 shallowRef (避免深响应), error 单独 ref, loading 单独 ref.
 * reload() 会重新执行 fetcher, 失败时 error 更新, 不抛 (let UI decide).
 */

export interface AsyncStateReturn<T> {
  data: Ref<T | undefined>
  loading: Ref<boolean>
  error: Ref<unknown>
  reload(): Promise<void>
}

export interface AsyncStateOptions<T> {
  initial?: T
}

export function useAsyncState<T>(
  fetcher: () => Promise<T>,
  options: AsyncStateOptions<T> = {},
): AsyncStateReturn<T> {
  const data = shallowRef<T | undefined>(options.initial)
  const loading = ref(false)
  const error = ref<unknown>(null)

  async function reload() {
    loading.value = true
    error.value = null
    try {
      data.value = await fetcher()
    } catch (e) {
      error.value = e
    } finally {
      loading.value = false
    }
  }

  // 第一次执行
  reload()

  return { data, loading, error, reload }
}