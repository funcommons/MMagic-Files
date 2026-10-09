/**
 * SessionController 单测（契约《方案设计.md》§4.2 /《JSSDK 接口文档.md》§三）
 * 覆盖：TTL 到点自毁 / T-5min 预警恰一次 / expiresAt 优先 / destroy 终态 / stop 重入 / DI 计时器
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXPIRE_WARN_BEFORE_MS } from '../constants'
import { SessionController } from '../session'
import type { SessionTimers } from '../session'

const WARN_MS = EXPIRE_WARN_BEFORE_MS

describe('SessionController', () => {
  // 显式 toFake Date：expiresAt 用例依赖 Date.now 可控
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('TTL 到点触发 onExpire("ttl") 恰一次，isExpired/remainingMs 收口', () => {
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 60, onExpire })
    c.start()
    vi.advanceTimersByTime(59_999)
    expect(onExpire).not.toHaveBeenCalled()
    expect(c.isExpired()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith('ttl')
    expect(c.isExpired()).toBe(true)
    expect(c.remainingMs()).toBe(0)
    // 终态后时间继续走也不重复触发
    vi.advanceTimersByTime(60_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('T-5min 触发 onWarn 恰一次（到期时也不重复）', () => {
    const onWarn = vi.fn()
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 600, onWarn, onExpire })
    c.start()
    vi.advanceTimersByTime(600_000 - WARN_MS - 1)
    expect(onWarn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1) // 恰到 T-5min
    expect(onWarn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(WARN_MS - 1)
    expect(onWarn).toHaveBeenCalledTimes(1)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith('ttl')
    expect(onWarn).toHaveBeenCalledTimes(1)
  })

  it('剩余本就 ≤ 预警阈值：start 即同步 warn 一次', () => {
    const onWarn = vi.fn()
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 60, onWarn, onExpire })
    c.start()
    expect(onWarn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(onWarn).toHaveBeenCalledTimes(1)
    expect(c.isExpired()).toBe(true)
  })

  it('expiresAt 优先于 ttlSeconds', () => {
    vi.setSystemTime(1_000_000)
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 3600, expiresAt: Date.now() + 30_000, onExpire })
    c.start()
    expect(c.remainingMs()).toBe(30_000)
    vi.advanceTimersByTime(29_999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith('ttl')
  })

  it('destroy → onExpire("destroyed") 恰一次，且 ttl 定时器被拆除', () => {
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 60, onExpire })
    c.start()
    c.destroy()
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith('destroyed')
    expect(c.isExpired()).toBe(true)
    expect(c.remainingMs()).toBe(0)
    vi.advanceTimersByTime(120_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
    c.destroy() // 重入 no-op
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('ttl 自然到期后 destroy 不再回调（终态先到先得）', () => {
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 10, onExpire })
    c.start()
    vi.advanceTimersByTime(10_000)
    c.destroy()
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith('ttl')
  })

  it('stop() 可重入且不发事件；重启后能正常到期', () => {
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 30, onExpire })
    c.start()
    c.stop()
    c.stop()
    expect(onExpire).not.toHaveBeenCalled()
    expect(c.isExpired()).toBe(false)
    vi.advanceTimersByTime(60_000)
    expect(onExpire).not.toHaveBeenCalled()
    c.start() // 重新起表（同一 deps，重算 30s）
    vi.advanceTimersByTime(29_999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('expiresAt 已过去：start 即 ttl（起表即过期）', () => {
    vi.setSystemTime(1_000_000)
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 3600, expiresAt: 999_999, onExpire })
    c.start()
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith('ttl')
    expect(c.isExpired()).toBe(true)
  })

  it('ttlSeconds/expiresAt 双缺省：永不到期（无前端死线，单文件常态）', () => {
    const onExpire = vi.fn()
    const c = new SessionController({ onExpire })
    c.start()
    expect(c.remainingMs()).toBe(Number.POSITIVE_INFINITY)
    vi.advanceTimersByTime(24 * 3600 * 1000)
    expect(onExpire).not.toHaveBeenCalled()
    expect(c.isExpired()).toBe(false)
  })

  it('未 start：isExpired=false、remainingMs=Infinity', () => {
    const c = new SessionController({ ttlSeconds: 60, onExpire: vi.fn() })
    expect(c.isExpired()).toBe(false)
    expect(c.remainingMs()).toBe(Number.POSITIVE_INFINITY)
  })

  it('可注入 timers：调度与时刻均走注入点（不经全局 setTimeout）', () => {
    let now = 0
    let fired: (() => void) | undefined
    const timers: SessionTimers = {
      set: (fn, ms) => {
        fired = fn
        return ms
      },
      clear: () => {},
      now: () => now,
    }
    const onWarn = vi.fn()
    const onExpire = vi.fn()
    const c = new SessionController({ ttlSeconds: 5, onWarn, onExpire, timers })
    c.start()
    expect(onWarn).toHaveBeenCalledTimes(1) // 5s < 5min → 启动即预警
    now = 4_999
    expect(c.remainingMs()).toBe(1)
    fired?.()
    expect(onExpire).toHaveBeenCalledWith('ttl')
    expect(c.remainingMs()).toBe(0)
    expect(c.isExpired()).toBe(true)
  })
})
