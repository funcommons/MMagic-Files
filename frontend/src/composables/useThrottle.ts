/**
 * 节流 (#22 复制即反馈 等高频事件).
 *
 * - leading=true: 立即执行, 之后 delay 内只允许一次
 * - trailing=true: 最后一次必触发 (用于保证最后一次一定会跑)
 *
 * 默认两者都开, 适合"前缘触发 + 收尾兜底".
 */
export function useThrottle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs = 300,
  options: { leading?: boolean; trailing?: boolean } = {},
): (...args: Args) => void {
  const { leading = true, trailing = true } = options
  let lastCall = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: Args | null = null

  const invoke = (...args: Args) => {
    lastCall = Date.now()
    pendingArgs = null
    timer = null
    fn(...args)
  }

  return (...args: Args) => {
    const now = Date.now()
    const elapsed = now - lastCall
    pendingArgs = args
    if (elapsed >= delayMs) {
      if (leading) {
        invoke(...args)
      } else if (!timer) {
        timer = setTimeout(() => invoke(...(pendingArgs ?? args)), delayMs)
      }
    } else if (!timer && trailing) {
      timer = setTimeout(() => invoke(...(pendingArgs ?? args)), delayMs - elapsed)
    }
  }
}