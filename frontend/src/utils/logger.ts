/**
 * logger — 集中 console 输出, 便于将来切换到 Sentry / pino 等.
 *
 * 用法:
 *   import { logger } from '@/utils'
 *   logger.warn('[foo] failed:', err)
 *   logger.debug('[foo] state:', state)   // 仅 dev 环境输出
 *
 * 与直接 console.* 的差别:
 * - debug/log 在 production 自动 no-op (避免泄漏敏感信息到用户浏览器)
 * - warn/error 始终输出, 与 console.warn/error 一致 (开发期会看到, prod 也会记录到 devtools)
 * - 统一 prefix 格式, 后续接入 APM 时只需替换这里
 */
const isDev = import.meta.env.DEV

export const logger = {
  debug: (...args: unknown[]) => { if (isDev) console.debug(...args) },
  log: (...args: unknown[]) => { if (isDev) console.log(...args) },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
}
