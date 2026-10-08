import { customRef } from 'vue'

/**
 * 带防抖的 ref (#3 字段实时校验, #10 草稿).
 *
 * 与 useDebouncedFn 区别: 返回的不是 getter 函数, 而是一个完整的 ref,
 * 模板可直接 v-model 用; 写入立即反映, 读取延迟到指定 ms 后.
 *
 * 用法:
 *   const nameInput = useDebouncedRef('', 300)   // 输入 v-model, 校验 watch(nameInput, ...)
 *
 * 实现: 基于 Vue 3 customRef, set 立即触发 trigger, get 节流延时.
 */
export function useDebouncedRef<T>(initial: T, delayMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let cached: T = initial
  return customRef<T>((track, trigger) => {
    return {
      get() {
        track()
        return cached
      },
      set(value: T) {
        cached = value
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => trigger(), delayMs)
      },
    }
  })
}

/**
 * 防抖函数包装 (用于事件 / 副作用, 比如 search 输入).
 */
export function useDebouncedFn<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs = 300,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delayMs)
  }
}