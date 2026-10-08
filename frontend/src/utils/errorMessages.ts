import { ApiErrorCode } from '@/api/errorCodes'

/**
 * 错误码 → 友好 i18n key 映射.
 *
 * 后端 ApiError.message 通常已经是可读的中文/英文, 但偶尔会变或缺失.
 * 这里兜底用 ux.error.<KEY> 给每个 ApiErrorCode 配一份友好文案,
 * 业务侧通过 getFriendlyMessage() 拿到 key, 由 i18n 决定最终语言.
 *
 * 用法:
 *   import { getFriendlyMessage } from '@/utils/errorMessages'
 *   const msgKey = getFriendlyMessage(apiError.code)  // → 'ux.error.TOKEN_EXPIRED'
 *   t(msgKey)  // → '登录已过期,请重新登录' (zh) / 'Session expired, please log in again' (en)
 */

const CODE_TO_KEY: Record<number, string> = {
  [ApiErrorCode.SYSTEM_ERROR]: 'ux.error.SYSTEM_ERROR',
  [ApiErrorCode.SERVICE_UNAVAILABLE]: 'ux.error.SERVICE_UNAVAILABLE',
  [ApiErrorCode.SERVICE_TIMEOUT]: 'ux.error.SERVICE_TIMEOUT',

  [ApiErrorCode.INVALID_PARAMETER]: 'ux.error.INVALID_PARAMETER',
  [ApiErrorCode.REQUIRED_PARAMETER_MISSING]: 'ux.error.REQUIRED_PARAMETER_MISSING',
  [ApiErrorCode.PARAMETER_FORMAT_ERROR]: 'ux.error.PARAMETER_FORMAT_ERROR',

  [ApiErrorCode.UNAUTHORIZED]: 'ux.error.UNAUTHORIZED',
  [ApiErrorCode.TOKEN_EXPIRED]: 'ux.error.TOKEN_EXPIRED',
  [ApiErrorCode.TOKEN_INVALID]: 'ux.error.TOKEN_INVALID',
  [ApiErrorCode.ACCOUNT_DISABLED]: 'ux.error.ACCOUNT_DISABLED',

  [ApiErrorCode.FORBIDDEN]: 'ux.error.FORBIDDEN',

  [ApiErrorCode.RESOURCE_NOT_FOUND]: 'ux.error.RESOURCE_NOT_FOUND',
  [ApiErrorCode.DATA_ALREADY_EXISTS]: 'ux.error.DATA_ALREADY_EXISTS',
  [ApiErrorCode.DATA_STATUS_CONFLICT]: 'ux.error.DATA_STATUS_CONFLICT',

  [ApiErrorCode.RATE_LIMIT_EXCEEDED]: 'ux.error.RATE_LIMIT_EXCEEDED',
  [ApiErrorCode.DUPLICATE_SUBMISSION]: 'ux.error.DUPLICATE_SUBMISSION',
  [ApiErrorCode.THIRD_PARTY_ERROR]: 'ux.error.THIRD_PARTY_ERROR',
}

/**
 * 返回错误码对应的 i18n key; 找不到时返回 null (调用方应回退到 ApiError.message).
 */
export function getFriendlyMessage(code: number): string | null {
  return CODE_TO_KEY[code] ?? null
}

/**
 * 是否需要全局 toaster 兜底 (即业务层没处理时, 全局 errorHandler 应该提示的码).
 * 目前所有业务码都列上, 由各业务层自行 decide 是否要 catch 后转友好提示.
 */
export function isKnownCode(code: number): boolean {
  return code in CODE_TO_KEY
}