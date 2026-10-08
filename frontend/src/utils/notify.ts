import { ElNotification, type NotificationOptions } from 'element-plus'
import { ApiError } from '@/api/errorCodes'

/**
 * 重要业务通知工具（右上角 Notification, 10 秒自动关闭）
 *
 * 适用场景:
 *   - 创作任务提交成功/失败
 *   - 算力/订单相关成功/失败
 *   - 群组加入成功/失败
 *   - 其他需要让用户明确感知结果的重要操作
 *
 * 普通操作仍用 showSuccess / handleError (ElMessage 顶部居中 3 秒).
 */

const BASE_OPTIONS: Partial<NotificationOptions> = {
  position: 'top-right',
  duration: 10000,
  offset: 16
}

function buildOptions(
  type: 'success' | 'error' | 'warning' | 'info',
  title: string,
  message: string
): NotificationOptions {
  return {
    ...BASE_OPTIONS,
    type,
    title,
    message
  } as NotificationOptions
}

export function notifySuccess(title: string, message: string): void {
  ElNotification(buildOptions('success', title, message))
}

export function notifyError(title: string, message: string): void {
  ElNotification(buildOptions('error', title, message))
}

export function notifyWarning(title: string, message: string): void {
  ElNotification(buildOptions('warning', title, message))
}

export function notifyInfo(title: string, message: string): void {
  ElNotification(buildOptions('info', title, message))
}

/**
 * 从异常对象中提取可展示的错误描述
 *
 * 优先级:
 *   1. ApiError.message（后端业务码 / HTTP 错误 的友好提示）
 *   2. 普通 Error.message
 *   3. fallback
 *
 * 用于失败通知中拼接口真实报错, 例如:
 *   notifyError('创作启动失败', `${extractErrorMessage(err)}, 已自动退还算力`)
 *
 * `withTrace` 为 true 时, 若 err 是 ApiError 且有 traceId, 会自动追加
 * "(trace: xxx)" 后缀, 便于客服/开发侧关联日志。
 */
export function extractErrorMessage(
  err: unknown,
  fallback = '接口返回错误，请稍后重试',
  withTrace = true,
): string {
  let msg = fallback
  if (err instanceof ApiError) {
    if (err.message && err.message.trim().length > 0) msg = err.message.trim()
  } else if (err instanceof Error) {
    if (err.message && err.message.trim().length > 0) msg = err.message.trim()
  }
  if (withTrace && err instanceof ApiError && err.traceId) {
    return `${msg} (trace: ${err.traceId})`
  }
  return msg
}
