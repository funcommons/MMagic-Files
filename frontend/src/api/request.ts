import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { ApiError, HTTP_STATUS, ApiErrorCode } from '@/api/errorCodes'
import type { ApiFieldError } from '@/api/errorCodes'
import { getOrCreateTraceId, TRACE_ID_STORAGE_KEY } from '@/utils/trace'
import router from '@/router'
import i18n from '@/locales'
import { logger } from '@/utils'

const t = i18n.global.t

// API 基础配置
// 开发环境使用代理，生产环境使用实际地址
const BASE_URL = ''
const TIMEOUT = 30000

const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete'])

// 鉴权相关白名单 (不注入 Bearer Token, 不触发 401 刷新)
const AUTH_PUBLIC_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/auth/captcha',
  '/api/v1/auth/captcha/verify',
  '/api/v1/auth/capabilities',
  // DEMO 宿主后端免登录端点(公开配置/演示登录)
  '/api/demo/login',
  '/api/demo/config',
])

/** 懒加载 userStore (避免循环依赖: store 引用 api, api 引用 store) */
let userStoreGetter: (() => { accessToken: string; refreshToken: string; refreshAccessToken: () => Promise<string>; clearAuth: () => void; hasToken: boolean }) | null = null
export function setUserStoreGetter(getter: typeof userStoreGetter) {
  userStoreGetter = getter
}

// 401 刷新单飞锁
let refreshPromise: Promise<string> | null = null

function refreshSingleFlight(): Promise<string> {
  if (!userStoreGetter) return Promise.reject(new Error('userStoreGetter not set'))
  const store = userStoreGetter()
  if (!store.refreshToken) return Promise.reject(new Error('no refresh token'))
  if (refreshPromise) return refreshPromise
  refreshPromise = store.refreshAccessToken().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

// 创建 Axios 实例
const request: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // P0 修复: FormData 上传时必须让 axios 自动加 multipart/form-data + boundary
    // 全局默认 Content-Type: application/json 会让 axios 把 FormData 序列化成 JSON 字符串
    // (axios 不会覆盖 explicit headers, 即使 data 是 FormData)
    // 这里按 data 类型动态调整: FormData → 删 Content-Type, 其他 → 强制 application/json
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete('Content-Type')
    } else if (!config.headers.has('Content-Type') && !(config.data instanceof URLSearchParams)) {
      config.headers.set('Content-Type', 'application/json')
    }

    // 注入 Bearer Token (除鉴权公开接口外)
    const url = config.url || ''
    const isAuthPublic = AUTH_PUBLIC_PATHS.has(url) || url.includes('/api/v1/auth/')
    if (userStoreGetter) {
      const store = userStoreGetter()
      if (store.accessToken && !isAuthPublic) {
        config.headers.set('Authorization', `Bearer ${store.accessToken}`)
      }
    }

    // 链路追踪: 同一会话保持 trace_id, 方便前后端日志串联
    config.headers.set('X-Trace-Id', getOrCreateTraceId())

    // 写操作幂等性: 同一 key 重试时, 后端可识别并返回首次结果 (防止重复提交)
    if (config.method && WRITE_METHODS.has(config.method.toLowerCase())) {
      config.headers.set('Idempotency-Key', uuidv4())
    }

    return config
  },
  (error) => {
    logger.error('Request error:', error)
    return Promise.reject(error)
  }
)

/**
 * 从 config 中读取 silent 标记
 */
function isSilent(config?: AxiosRequestConfig): boolean {
  return (config as RequestConfig | undefined)?.silent === true
}

/**
 * 从响应 (header + body) 提取 trace_id, 并写回 sessionStorage
 * 保证后续请求继续携带同一个 trace, 整条链路日志可串联
 */
function captureTraceId(headers: AxiosResponse['headers'], body: { trace_id?: string } | null | undefined): string {
  const headerVal = headers['x-trace-id'] || headers['X-Trace-Id']
  const traceId = (typeof headerVal === 'string' ? headerVal : '') || body?.trace_id || ''
  if (traceId) {
    try { sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId) } catch { /* noop */ }
  }
  return traceId
}

/**
 * 响应拦截器
 * <p>
 * 业务错误 → throw ApiError（不弹窗，由 handleError 统一处理）
 * HTTP 错误 → throw ApiError（带 status）
 * 401 特殊处理：清登录态 + 跳登录页
 */
request.interceptors.response.use(
  (response: AxiosResponse) => {
    const { data, headers } = response

    // 如果响应直接是数据（无 code 字段），返回它
    if (data === null || data === undefined || data.code === undefined) {
      captureTraceId(headers, null)
      return data
    }

    // 业务成功
    if (data.code === 200 || data.code === 0) {
      captureTraceId(headers, data)
      return data.data
    }

    // 业务错误：转换为 ApiError
    const errorMsg = data.message || data.msg || t('api.request-failed')
    const traceId = captureTraceId(headers, data)
    // framework4j 字段级错误 (param validate 失败 / 部分业务校验) -> ApiError.details
    const details: ApiFieldError[] = Array.isArray(data.error)
      ? data.error
          .filter((e: any) => e != null && typeof e.message === 'string')
          .map((e: any) => ({
            field: typeof e.field === 'string' ? e.field : '',
            code: typeof e.code === 'string' ? e.code : undefined,
            message: e.message,
            rejectedValue: e.rejectedValue,
          }))
      : []
    const apiError = new ApiError(data.code, errorMsg, {
      traceId,
      details: details.length > 0 ? details : undefined,
    })
    if (isSilent(response.config)) {
      apiError.silent = true
    }

    // 后端 BizException(UNAUTHORIZED) 走 HTTP 200 + code=10200 (见 BizExceptionHandler).
    // 业务码 10200 视同 401: 清登录态 + 跳 /login (避免未登录用户停在首页空白态).
    if (data.code === ApiErrorCode.UNAUTHORIZED && userStoreGetter) {
      const store = userStoreGetter()
      if (store.hasToken) store.clearAuth()
      redirectToLogin()
      apiError.silent = true
    }
    return Promise.reject(apiError)
  },
  (error) => {
    // HTTP 错误处理
    const silent = isSilent(error.config)

    // 401 自动刷新 (策略 B 专属): 单飞 + 重放原请求
    if (error.response?.status === HTTP_STATUS.UNAUTHORIZED && userStoreGetter) {
      const store = userStoreGetter()
      const originalConfig = error.config
      const originalUrl = originalConfig?.url || ''
      const isAuthEndpoint = originalUrl.includes('/api/v1/auth/')
      if (store.refreshToken && !isAuthEndpoint && !originalConfig.__retried) {
        originalConfig.__retried = true
        return refreshSingleFlight().then((newToken) => {
          originalConfig.headers.set('Authorization', `Bearer ${newToken}`)
          return request(originalConfig)
        }).catch(() => {
          store.clearAuth()
          redirectToLogin()
          const apiError = new ApiError(HTTP_STATUS.UNAUTHORIZED, t('api.unauthorized'), { silent })
          return Promise.reject(apiError)
        })
      }
      if (store.hasToken) store.clearAuth()
    }

    if (error.response) {
      const { status, data, headers } = error.response
      const traceId = captureTraceId(headers, data)
      let message = t('api.network-error')

      switch (status) {
        case HTTP_STATUS.BAD_REQUEST:
          message = data?.message || t('api.bad-request')
          break
        case HTTP_STATUS.UNAUTHORIZED:
          message = t('api.unauthorized')
          redirectToLogin()
          break
        case HTTP_STATUS.FORBIDDEN:
          message = t('api.forbidden')
          break
        case HTTP_STATUS.NOT_FOUND:
          message = t('api.not-found')
          break
        case HTTP_STATUS.INTERNAL_SERVER_ERROR:
          message = data?.message || t('api.server-error')
          break
        default:
          message = data?.message || `${t('api.request-failed')} (${status})`
      }

      const apiError = new ApiError(status, message, { status, silent, traceId })
      return Promise.reject(apiError)
    }

    if (error.code === 'ECONNABORTED') {
      const apiError = new ApiError(0, t('api.timeout'), { silent })
      return Promise.reject(apiError)
    }

    // 其他网络错误
    const apiError = new ApiError(0, t('api.network-error'), { silent })
    return Promise.reject(apiError)
  }
)

/** 跳登录页 (若路由存在) */
function redirectToLogin() {
  if (router.hasRoute('Login') || router.getRoutes().some(r => r.path === '/login')) {
    const current = router.currentRoute.value
    if (current.path !== '/login') {
      router.push({ path: '/login', query: current.fullPath !== '/' ? { redirect: current.fullPath } : undefined })
    }
  }
}

/**
 * 封装的请求方法
 * <p>
 * 支持 `silent: true` 选项：开启后响应拦截器不会自动弹窗，
 * 由调用方决定如何处理错误。
 */
export interface RequestConfig extends AxiosRequestConfig {
  /** 静默请求：拦截器不弹窗，由调用方 handleError 处理 */
  silent?: boolean
}

export const http = {
  get<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return request.get(url, config)
  },

  post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return request.post(url, data, config)
  },

  put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return request.put(url, data, config)
  },

  delete<T = unknown>(url: string, config?: RequestConfig): Promise<T> {
    return request.delete(url, config)
  },

  patch<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return request.patch(url, data, config)
  }
}

export default request
