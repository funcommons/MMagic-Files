/**
 * JSSDK 共享类型与领域契约
 * 契约正本：《documents/JSSDK 接口文档.md》V1.0 /《方案设计.md》V1.2 §4.1b/§4.4
 * 本文件由主线持有，子 agent 只读。
 */
import type { NS } from './constants'

// ───────────────────────── 信封 ─────────────────────────

export interface Envelope<P = unknown> {
  ns: typeof NS
  v: number
  kind: 'cmd' | 'evt' | 'reply'
  /** cmd 唯一 id；reply 携带对应 cmd 的 id */
  id: string
  name: string
  payload: P
  /** 仅 reply 携带 */
  ok?: boolean
  /** 仅 reply 失败时携带（§七错误码） */
  code?: number
}

export type CommandName =
  | 'navigate' | 'openFile' | 'closeTab' | 'getTabs' | 'select'
  | 'createFolder' | 'uploadFiles' | 'download' | 'rename' | 'remove'
  | 'registerApp' | 'setTheme' | 'setLocale' | 'getInfo' | 'destroy'

export type EventName =
  | 'ready' | 'pathChanged' | 'fileOpened' | 'tabClosed'
  | 'selectionChanged' | 'selectionConfirmed'
  | 'uploadProgress' | 'uploadDone' | 'uploadFailed'
  | 'downloadDone' | 'downloadFailed'
  | 'fileChanged' | 'expired' | 'error'

// ───────────────────────── 配置（§4.1 / §4.1b）─────────────────────────

export interface S3Credentials {
  accessKeyId: string
  accessKeySecret: string
  sessionToken: string
}

export interface BackendConfig {
  endpoint: string
  region: string
  bucket: string
  /** 会话目录域（文件树从此起；凭证 scope 钉在此 prefix） */
  prefix: string
  credentials: S3Credentials
  /** 前端自毁定时器时长（秒）；必须 ≤ STS 真实 TTL */
  ttlSeconds?: number
  /** 可选：对齐 STS 真实到期时刻（epoch ms） */
  expiresAt?: number
}

export interface BrandConfig {
  name?: string
  logoUrl?: string
  primaryColor?: string
}

export interface AppearanceConfig {
  theme?: 'light' | 'dark' | 'auto'
  brand?: BrandConfig
  locale?: 'zh-CN' | 'en-US'
}

export interface PluginEntry {
  url: string
  /** sha384-<hex>（SRI 标签注入校验） */
  sri?: string
  lazy?: boolean
}

export interface WorkspaceConfig {
  mode: 'workspace'
  v: number
  backend: BackendConfig
  security: { allowedOrigins: string[] }
  params?: { uploadMaxBytes?: number; uploadConcurrency?: number }
  appearance?: AppearanceConfig
  features?: Record<string, boolean>
  permissions?: { denyExts?: string[] }
  plugins?: PluginEntry[]
  ui?: { initialPath?: string; defaultOpen?: string }
}

export interface FileSource {
  url: string
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
}

export interface FileSave {
  method: 'PUT' | 'POST'
  url: string
  headers?: Record<string, string>
}

export interface SingleFileConfig {
  mode: 'file'
  v: number
  source: FileSource
  /** 只读=无 save 段；可写=有 save 段 */
  save?: FileSave
  name?: string
  appearance?: AppearanceConfig
  features?: Record<string, boolean>
  /** 可选：宿主 origin 白名单；缺省时装配层从 document.referrer 推导（§4.1b origin 校验同工作台） */
  security?: { allowedOrigins: string[] }
}

export type AppConfig = WorkspaceConfig | SingleFileConfig
export type SessionMode = 'workspace' | 'file'

// ───────────────────────── S3 域（§4.4 API 子集）─────────────────────────

export interface S3ObjectSummary {
  key: string
  name: string
  size: number
  lastModified?: number
  isDir: boolean
  mime?: string
}

export interface S3ListResult {
  prefix: string
  dirs: S3ObjectSummary[]
  files: S3ObjectSummary[]
  continuationToken?: string
}

/**
 * S3 客户端接口（A3 实现 SigV4Client、A5/files 层消费；单文件模式另有 URL provider）
 * 错误映射：非 2xx → SdkError(S3_ERROR, detail=status)；403/凭证类 → CREDENTIAL_INVALID/CREDENTIAL_EXPIRED
 */
export interface S3Client {
  list(prefix: string, opts?: { continuationToken?: string; delimiter?: string }): Promise<S3ListResult>
  get(key: string, opts?: { rangeHeader?: string }): Promise<Response>
  put(key: string, body: Blob | ArrayBuffer, contentType?: string): Promise<{ etag: string }>
  head(key: string): Promise<{ exists: boolean; size?: number; contentType?: string; etag?: string }>
  copy(from: string, to: string): Promise<void>
  remove(keys: string[]): Promise<void>
  createMultipart(key: string, contentType?: string): Promise<{ uploadId: string }>
  uploadPart(key: string, uploadId: string, partNumber: number, body: Blob): Promise<{ etag: string }>
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>
  abortMultipart(key: string, uploadId: string): Promise<void>
  /** 预签名 GET URL（查询串 SigV4；媒体渲染器用 <video src> 拿浏览器原生 Range/渐进加载）。可选能力 */
  getPresignedUrl?(key: string, expiresSec?: number): string
  /** 预签名 PUT URL（查询串 SigV4；分享对话框「上传链接」用——对方无需凭证即可向该 key 直传）。可选能力 */
  presignPutUrl?(key: string, expiresSec?: number): string
}

// ───────────────────────── 命令/事件 payload ─────────────────────────

export interface NavigatePayload { path: string }
export interface OpenFilePayload { path: string; appId?: string }
export interface TabInfo { tabId: string; path: string; appId: string }
export interface OpenFileReply { tabId: string }
export interface CloseTabPayload { tabId: string }
export interface GetTabsReply { tabs: TabInfo[] }
export interface SelectPayload { mode: 'file' | 'multi' | 'off'; filter?: { exts: string[] } }
export interface CreateFolderPayload { path: string }
export interface CreateFolderReply { key: string }
export interface UploadAccepted { id: string }
export interface UploadRejected {
  name: string
  reason: 'ext' | 'size'
  /** 拒收错误码（契约《JSSDK 接口文档.md》§五：ext=4304 EXT_DENIED、size=4302 PAYLOAD_TOO_LARGE）；additive */
  code?: number
}
export interface UploadFilesReply { accepted: UploadAccepted[]; rejected: UploadRejected[] }
export interface DownloadPayload { paths: string[] }
export interface RenamePayload { from: string; to: string }
export interface RemovePayload { paths: string[] }
/** 宿主运行时注册=动态追加配置注入插件（传 {url,sri}，函数不可克隆） */
export interface RegisterAppPayload { url: string; sri?: string; lazy?: boolean }
export interface RegisterAppReply { appId: string }
export interface SetThemePayload { theme: 'light' | 'dark' | 'auto' }
export interface SetLocalePayload { locale: 'zh-CN' | 'en-US' }
export interface GetInfoReply {
  sdkVersion: string
  session: { expiresInSec: number }
  features: Record<string, boolean>
}

export interface ReadyPayload {
  sdkVersion: string
  protocolVersion: number
  configSummary: Record<string, unknown>
}
export interface PathChangedPayload { path: string }
export interface FileOpenedPayload { tabId: string; path: string; appId: string }
export interface TabClosedPayload { tabId: string }
export interface SelectionChangedPayload { paths: string[] }
export interface SelectionConfirmedPayload { paths: string[] }
export interface UploadProgressPayload { id: string; loaded: number; total: number }
export interface UploadDonePayload { id: string; key?: string }
export interface UploadFailedPayload { id: string; error?: { code: number; message: string } }
export interface DownloadDonePayload { id: string }
export interface DownloadFailedPayload { id: string; error?: { code: number; message: string } }
export interface FileChangedPayload { key: string; action: 'put' | 'delete' | 'rename'; from?: string }
export interface ExpiredPayload { reason: 'ttl' | 'destroyed' }
export interface ErrorPayload { code: number; message: string; detail?: unknown }

// ───────────────────────── 应用模型（§4.6 AppRegistry / 动态插件方案 V1.1 §二）─────────────────────────

export interface AppMatcher {
  /** 不带点扩展名（归一化：忽略大小写与前导点）；同字段内 OR */
  ext?: string[]
  /** string 或 string[]；忽略大小写与 '; parameters' 后缀；同字段内 OR */
  mime?: string | string[]
  /** 内容嗅探（magic bytes 等）；与 ext/mime 之间 AND */
  probe?: (file: { name: string; mime?: string; size?: number }) => boolean
}

/** 渲染实例：dispose 三路必调；getState 供切回 tab 重跑时注入 savedState */
export interface AppInstance {
  dispose(): void
  getState?(): unknown
  /** Promise<boolean>：false=暂缓关闭；3s 超时强制放行；expired/destroy 只通知不询问 */
  beforeDispose?(): boolean | Promise<boolean>
}

/** 插件能力面（白名单）：凭证不出，字节流进出 */
export interface AppCtx {
  /** 工作台=内层 SigV4；单文件=URL provider——装配层注入统一实现 */
  getObject(key: string): Promise<Blob>
  putObject(key: string, data: Blob, contentType?: string): Promise<void>
  /** i18n（强制走宿主词典；params=具名插值占位实参，如 {limit}——渲染器超限文案 R2-03/R2-05） */
  t(key: string, params?: Record<string, unknown>): string
  /** 事件上报 → 宿主 fileChanged（'saved'|'changed'→put；'deleted'→delete；'renamed'→rename） */
  notify(type: 'saved' | 'changed' | 'deleted' | 'renamed', payload: { key: string; from?: string }): void
  /** 主题 token（CSS 变量名集） */
  theme: Record<string, string>
  /** 可选能力：媒体直链（S3=预签名 URL / url source=原始 GET URL）——渲染器用 <video src> 拿浏览器原生 Range */
  getMediaUrl?(key: string): string
}

export type AppAction = 'preview' | 'edit' | 'open-with'

export interface AppDefinition {
  /** 全局唯一（registry 键；openFile {appId} 引用） */
  id: string
  matcher: AppMatcher
  renderer: (el: HTMLElement, file: { key: string; name: string; size: number }, ctx: AppCtx, savedState?: unknown) => void | AppInstance | Promise<void | AppInstance>
  actions?: AppAction[]
  /** i18n key 或字面量 */
  label?: string
  version?: string
  /** 要求的协议主版本（=信封 v；缺省不校验；不匹配拒载） */
  requiresSdk?: number
  /** 渲染器字节限额（R2-03：预览闸据此取该类型实际拒绝线，避免「确认后仍拒」的双闸叠加；缺省=无渲染器级限额） */
  maxBytes?: number
}
