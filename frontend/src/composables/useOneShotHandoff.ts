import { logger } from '@/utils'

/**
 * useOneShotHandoff — 跨路由一次性数据传递 (基于 localStorage).
 *
 * 适用场景: A 页面把一个值塞进去, B 页面在挂载时取一次后立即清除.
 * 比 Pinia 临时状态简单, 不需要持久化跨刷新的场景.
 *
 * 用法:
 *   // A 页面 (发送方)
 *   const handoff = useOneShotHandoff<string>('quick-edit:initial-image')
 *   handoff.set(work.url)
 *
 *   // B 页面 (接收方, 一般在 onActivated/onMounted)
 *   const url = handoff.consume()  // 读取后立即清除
 *
 * set 会覆盖之前的值 (避免旧值污染).
 * consume 原子操作: 读取 + 清除, 即使两次 B 页面同时挂载也只会有一个拿到值.
 */
export function useOneShotHandoff<T = string>(key: string) {
  const tag = `[useOneShotHandoff:${key}]`

  function set(value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (err) {
      logger.warn(`${tag} set failed:`, err)
    }
  }

  /** 读取并立即清除; 失败 / 不存在返回 null */
  function consume(): T | null {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
      if (raw !== null) localStorage.removeItem(key)
    } catch (err) {
      logger.warn(`${tag} consume failed:`, err)
      return null
    }
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch (err) {
      logger.warn(`${tag} parse failed:`, err)
      return null
    }
  }

  /** 仅读取, 不清除 (用于确认值是否存在) */
  function peek(): T | null {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? null : (JSON.parse(raw) as T)
    } catch {
      return null
    }
  }

  /** 主动清除 (无需读取) */
  function clear(): void {
    try {
      localStorage.removeItem(key)
    } catch (err) {
      logger.warn(`${tag} clear failed:`, err)
    }
  }

  return { set, consume, peek, clear }
}