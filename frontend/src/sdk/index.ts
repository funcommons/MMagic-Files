/**
 * JSSDK barrel 入口（消费方/装配层统一 import 面；本文件只做转发导出，不写逻辑）
 *
 * 当前导出：constants / errorCodes / types / session / handlers。
 *
 * 待补导出（Wave1 并行文件落地后由主线在此补，本注释即交接位）：
 * - bus.ts（A1：postMessage 双向通道，origin 校验/ready 队列/超时/reply 匹配）
 * - config.ts、credentials.ts（A2：#config/#file fragment 解析校验 + fetchCredentials() 接缝）
 * - s3/（A3：SigV4 签名 + S3 API 子集客户端）
 */

export * from './constants'
export * from './errorCodes'
export * from './types'
export * from './session'
export * from './handlers'
