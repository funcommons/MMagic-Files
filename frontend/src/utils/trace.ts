import { v4 as uuidv4 } from 'uuid'

/**
 * 链路追踪 trace-id 工具。
 * <p>
 * 从 request.ts 抽离的独立模块 —— 历史:源自主站壳的 trace 模块,DEMO 沿用
 * 共用同一 session trace-id, 保证一次会话内所有请求 trace-id 一致。
 */
export const TRACE_ID_STORAGE_KEY = 'aigc:trace-id'

/**
 * 获取或创建当前会话的 trace-id（sessionStorage 持久, 跨请求复用）。
 * sessionStorage 不可用 (SSR / 隐私模式) 时退化为每次新生成。
 */
export function getOrCreateTraceId(): string {
  let traceId = ''
  try {
    traceId = sessionStorage.getItem(TRACE_ID_STORAGE_KEY) || ''
  } catch {
    // sessionStorage 不可用, 退化为每次新生成
  }
  if (!traceId) {
    traceId = uuidv4()
    try { sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId) } catch { /* noop */ }
  }
  return traceId
}
