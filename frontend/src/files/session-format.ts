/**
 * 会话剩余时长格式化（复审 #10：头部倒计时）。
 * 口径：≥1h →「Hh Mm」（整点省分钟）；≥5min →「N min」；<5min →「M:SS」逐秒（临近到期收细颗粒）。
 */
export function formatRemaining(ms: number): string {
  if (ms >= 3_600_000) {
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  if (ms >= 300_000) return `${Math.max(1, Math.floor(ms / 60_000))} min`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}
