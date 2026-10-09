import { describe, expect, it } from 'vitest'
import { formatRemaining } from '../session-format'

describe('formatRemaining（复审 #10 头部倒计时口径）', () => {
  it('≥1h →「Hh Mm」，整点省分钟', () => {
    expect(formatRemaining(3_600_000 * 2 + 60_000 * 5)).toBe('2h 5m')
    expect(formatRemaining(3_600_000)).toBe('1h')
    expect(formatRemaining(3_600_000 * 25)).toBe('25h')
  })

  it('5min≤ms<1h →「N min」', () => {
    expect(formatRemaining(300_000)).toBe('5 min')
    expect(formatRemaining(599_999)).toBe('9 min')
    expect(formatRemaining(3_599_999)).toBe('59 min')
  })

  it('<5min →「M:SS」逐秒；0 与亚秒兜底', () => {
    expect(formatRemaining(299_999)).toBe('4:59')
    expect(formatRemaining(300_000 - 1)).toBe('4:59')
    expect(formatRemaining(5_000)).toBe('0:05')
    expect(formatRemaining(0)).toBe('0:00')
    expect(formatRemaining(999)).toBe('0:00')
  })
})
