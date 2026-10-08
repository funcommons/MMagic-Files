/**
 * date.ts — 公共日期格式化工具.
 * 从 5 个文件里重复的 formatDate 抽取统一实现.
 */

type I18nT = (key: string, params?: Record<string, unknown>) => string

/** 绝对日期 YYYY-MM-DD (用于列表/卡片展示). 输入空/无效返回 '-'. */
export function formatAbsoluteDate(dateStr?: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 绝对日期 i18n 版: 调用方传入 t + i18n key (key 必须包含 {year}/{month}/{day} 占位符). */
export function formatAbsoluteDateI18n(
  dateStr: string | null | undefined,
  t: I18nT,
  key: string,
): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return t(key, {
    year: d.getFullYear(),
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
  })
}

/**
 * 相对时间 i18n 版: 调用方传入 t + namespace, 自动拼接 just-now / minutes-ago / hours-ago /
 * time-yesterday / time-week / fallback 6 个 i18n key.
 *
 * namespace 例: 'assets' → 'assets.just-now', 'assets.minutes-ago' 等.
 *
 * 7 天以上回退到 formatAbsoluteDate (YYYY-MM-DD, 不走 i18n, 因为不同 locale 格式差异大).
 */
export function formatRelativeDateI18n(
  dateStr: string,
  t: I18nT,
  namespace = 'assets',
): string {
  const date = new Date(dateStr)
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60))
      return minutes < 1 ? t(`${namespace}.just-now`) : t(`${namespace}.minutes-ago`, { n: minutes })
    }
    return t(`${namespace}.hours-ago`, { n: hours })
  }
  if (days === 1) return t(`${namespace}.time-yesterday`)
  if (days < 7) return `${days}${t(`${namespace}.time-week`)}`
  return formatAbsoluteDate(dateStr)
}

/** 绝对日期时间 YYYY-MM-DD HH:mm (用于日志/详情). */
export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** HH:mm 时间格式 (用于日志/时间戳) */
export function formatTimeString(ts: number | string): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * 日期范围快捷选项 — 自定义面板内嵌按钮用.
 * <p>返回 { start, end } 均为 yyyy-MM-dd 字符串 (与后端 WorkListParams.startTime/endTime 对齐).
 *
 * <p>支持的 option:
 * <ul>
 *   <li>'last-7-days'      今天-6  → 今天</li>
 *   <li>'last-30-days'     今天-29 → 今天</li>
 *   <li>'last-month'       上月1日 → 上月最后一天</li>
 *   <li>'month-yyyy-mm'    指定 yyyy-MM 的该月1日 → 该月最后一天 (单月范围)</li>
 * </ul>
 */
export function getDateRange(
  option: 'last-7-days' | 'last-30-days' | 'last-month' | `month-${string}`
): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const toStr = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (option === 'last-7-days') {
    const start = new Date(today)
    start.setDate(today.getDate() - 6)
    return { start: toStr(start), end: toStr(today) }
  }
  if (option === 'last-30-days') {
    const start = new Date(today)
    start.setDate(today.getDate() - 29)
    return { start: toStr(start), end: toStr(today) }
  }
  if (option === 'last-month') {
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const lastOfPrevMonth = new Date(firstOfThisMonth)
    lastOfPrevMonth.setDate(0)
    const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1)
    return { start: toStr(firstOfPrevMonth), end: toStr(lastOfPrevMonth) }
  }
  // month-yyyy-mm 单月范围
  if (option.startsWith('month-')) {
    const yyyyMm = option.slice('month-'.length)
    const m = yyyyMm.match(/^(\d{4})-(\d{1,2})$/)
    if (!m) {
      throw new Error(`getDateRange: invalid month option "${option}"`)
    }
    const year = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12) {
      throw new Error(`getDateRange: month out of range "${option}"`)
    }
    const first = new Date(year, month - 1, 1)
    const last = new Date(year, month, 0) // month=0 → 上月最后一天, 自动得到 month 月的天数
    return { start: toStr(first), end: toStr(last) }
  }

  throw new Error(`getDateRange: unknown option "${option}"`)
}
