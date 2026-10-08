import { ElMessage } from 'element-plus'
import { ApiError } from '@/api/errorCodes'

/**
 * 统一错误处理入口
 * <p>
 * 全项目唯一调用 ElMessage.error 的地方。
 * 业务层捕获异常后调用此函数。
 *
 * @param err 捕获到的错误对象
 * @param fallback 默认错误信息（当 err 没有 message 时使用）
 *
 * @example
 * ```ts
 * try {
 *   await loadGroups()
 * } catch (e) {
 *   handleError(e, '加载群组失败')
 * }
 * ```
 */
export function handleError(err: unknown, fallback = '操作失败'): void {
  // ApiError 类型，提取 message + 字段级 details
  if (err instanceof ApiError) {
    if (err.silent) return
    if (err.details && err.details.length > 0) {
      // 字段级错误: 拼成 "顶层 message + 字段: 描述" 多行展示
      const lines = [err.message, ...err.details.map(d => {
        const head = d.field ? `${d.field}: ` : ''
        const rej = d.rejectedValue !== undefined && d.rejectedValue !== null
          ? ` (${formatRejected(d.rejectedValue)})`
          : ''
        return `${head}${d.message}${rej}`
      })]
      ElMessage({
        type: 'error',
        message: lines.join('\n'),
        dangerouslyUseHTMLString: false,
        duration: 6 * 1000,
        customClass: 'api-error-with-details',
        grouping: true,
      })
      return
    }
    if (err.message) {
      ElMessage.error(err.message)
      return
    }
  }

  // 普通 Error
  if (err instanceof Error) {
    if (err.message) {
      ElMessage.error(err.message)
      return
    }
  }

  // 其他类型
  ElMessage.error(fallback)
}

/**
 * 格式化 rejectedValue (字符串截断, 数字/布尔直显)
 */
function formatRejected(v: unknown): string {
  if (typeof v === 'string') {
    return v.length > 60 ? `"${v.slice(0, 60)}..."` : `"${v}"`
  }
  return String(v)
}

/**
 * errMsg — 类型安全地取错误信息.
 *
 * 替代 `catch (err: any)` + `err.message` 模式:
 *   try { ... } catch (err) { logger.warn('failed:', errMsg(err)) }
 *
 * 与 `String(err)` 区别: 对 Error 返回纯 message (不附 'Error:' 前缀).
 */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * 成功提示
 */
export function showSuccess(message: string): void {
  ElMessage.success(message)
}

/**
 * 警告提示
 */
export function showWarning(message: string): void {
  ElMessage.warning(message)
}
