/**
 * JSSDK 错误码（契约 §七）
 * 本文件由主线持有，子 agent 只读。
 */

export const ERROR_CODES = {
  /** 配置缺失/非法（#config 缺 backend、#file 缺 source、JSON 坏等） */
  BAD_CONFIG: 4001,
  /** 凭证被 S3 拒（scope/policy 错） */
  CREDENTIAL_INVALID: 4002,
  /** 凭证 TTL 到（会话终态前奏） */
  CREDENTIAL_EXPIRED: 4003,
  /** 命令超时（默认 10s） */
  TIMEOUT: 4004,
  /** 参数非法/格式错（含未知命令） */
  BAD_PARAM: 4005,
  /** S3 端点错误（detail 携 status） */
  S3_ERROR: 4101,
  /** 路径/tabId/appId 不存在 */
  NOT_FOUND: 4102,
  /** 插件 import 失败/SRI 不符/版本不匹配 */
  PLUGIN_LOAD_FAILED: 4201,
  /** matcher 不命中且无默认应用 */
  NO_APP: 4202,
  /** 功能开关关闭（features.*=false） */
  FEATURE_DISABLED: 4301,
  /** 超限（uploadMaxBytes 等） */
  LIMIT_EXCEEDED: 4302,
  /** ready 前队列超 50 拒 */
  QUEUE_OVERFLOW: 4303,
  /** 扩展名黑名单拒收 */
  EXT_DENIED: 4304,
  /** 当前模式不支持该命令（单文件模式下调工作台命令） */
  UNSUPPORTED_MODE: 4305,
  /** 会话已终态后的任何 cmd */
  SESSION_EXPIRED: 5000,
  /** origin 不在白名单（静默丢弃，仅日志，不送达调用方） */
  ORIGIN_REJECTED: 5001,
} as const

export type ErrorCodeValue = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** SDK 统一业务错误：code 对齐 ERROR_CODES，reply/事件携带 */
export class SdkError extends Error {
  code: number
  detail?: unknown

  constructor(code: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'SdkError'
    this.code = code
    this.detail = detail
  }
}
