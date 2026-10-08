/**
 * API 错误码常量
 * <p>
 * 与后端 ErrorCode 枚举保持一致（参见 ldx2a-aigc-platform-model ErrorCode.java）。
 * 前端通过此常量对错误码进行类型化判断和文案映射。
 */

/**
 * 后端业务错误码（与 com.ldx2t.aigc.model.common.ErrorCode 对应）
 */
export const ApiErrorCode = {
  // 成功
  SUCCESS: 0,

  // 系统错误 (10000-10999)
  SYSTEM_ERROR: 10001,
  SERVICE_UNAVAILABLE: 10002,
  SERVICE_TIMEOUT: 10003,

  // 参数错误 (10100-10199)
  INVALID_PARAMETER: 10100,
  REQUIRED_PARAMETER_MISSING: 10101,
  PARAMETER_FORMAT_ERROR: 10102,

  // 认证授权 (10200-10299)
  UNAUTHORIZED: 10200,
  TOKEN_EXPIRED: 10201,
  TOKEN_INVALID: 10202,
  ACCOUNT_DISABLED: 10204,

  // 权限 (10300-10399)
  FORBIDDEN: 10300,

  // 资源 (10400-10499)
  RESOURCE_NOT_FOUND: 10400,
  DATA_ALREADY_EXISTS: 10401,
  DATA_STATUS_CONFLICT: 10402,

  // 限流 (10500-10599)
  RATE_LIMIT_EXCEEDED: 10500,
  DUPLICATE_SUBMISSION: 10501,
  THIRD_PARTY_ERROR: 10502,
} as const

export type ApiErrorCodeType = typeof ApiErrorCode[keyof typeof ApiErrorCode]

/**
 * HTTP 状态码常量
 */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

/**
 * 单条字段级校验错误 (来自后端 ApiResponse.error[].field / message).
 */
export interface ApiFieldError {
  /** 字段路径 (如 "code", "name") */
  field: string
  /** 字段级错误码 (FORMAT_INVALID / REQUIRED / 等) */
  code?: string
  /** 可读描述 */
  message: string
  /** 拒绝值 (用于给前端回显哪个值不对) */
  rejectedValue?: unknown
}

/**
 * 统一的 API 错误对象
 * <p>
 * axios 拦截器将 HTTP 错误 / 业务错误统一转换为 ApiError 抛出。
 * 业务层通过 try-catch 捕获后，调用 handleError() 统一提示。
 */
export class ApiError extends Error {
  /** 业务错误码（来自后端 ApiResponse.code） */
  public readonly code: number
  /** HTTP 状态码（仅在 HTTP 错误时有值） */
  public readonly status?: number
  /** 是否为静默请求（true 则 handleError 不提示） */
  public silent: boolean
  /** 链路追踪 ID (来自后端响应 trace_id / X-Trace-Id), 用于日志关联 */
  public readonly traceId?: string
  /** 字段级错误详情 (来自后端 ApiResponse.error[]), 用于 UI 展示具体哪个字段错了 */
  public readonly details?: ApiFieldError[]

  constructor(
    code: number,
    message: string,
    options: {
      status?: number
      silent?: boolean
      traceId?: string
      details?: ApiFieldError[]
    } = {}
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = options.status
    this.silent = options.silent ?? false
    this.traceId = options.traceId
    this.details = options.details
  }

  /** 是否为业务错误（来自后端的 code） */
  isBusinessError(): boolean {
    return this.status === undefined
  }

  /** 是否为 HTTP 错误（如 401、500） */
  isHttpError(): boolean {
    return this.status !== undefined
  }

  /** 是否为认证失败（需要跳登录） */
  isAuthError(): boolean {
    return (
      this.status === HTTP_STATUS.UNAUTHORIZED ||
      this.code === ApiErrorCode.UNAUTHORIZED ||
      this.code === ApiErrorCode.TOKEN_EXPIRED ||
      this.code === ApiErrorCode.TOKEN_INVALID
    )
  }
}
