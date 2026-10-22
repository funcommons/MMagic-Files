/** 宿主契约的本地结构声明（插件零宿主导入——自包含 bundle，类型按形对齐 sdk/types.ts） */

/** 三形态：源码 / 预览 / 左源码右预览双窗 */
export type MdMode = 'source' | 'preview' | 'split'

/** 插件参数（经 PluginEntry.options / registerApp options 透传，见方案 §二） */
export interface MdEditorOptions {
  /** 打开时形态（宿主硬指定，压过用户上次记忆） */
  initialMode?: MdMode
  /** 默认形态（无 initialMode 且无用户记忆时的兜底） */
  defaultMode?: MdMode
}

export interface HostFile {
  key: string
  name: string
  size: number
}

export interface HostCtx {
  getObject(key: string): Promise<Blob>
  putObject(key: string, blob: Blob, contentType?: string): Promise<void>
  t(key: string, params?: Record<string, unknown>): string
  notify(event: string, payload?: unknown): void
}

export interface HostInstance {
  dispose(): void
  getState?(): unknown
  /** reason（v1.1 宿主显式传入）：expired/destroy=通知式，实现应跳过询问直接放行 */
  beforeDispose?(reason?: 'close' | 'expired' | 'destroy'): boolean | Promise<boolean>
}

export interface RegisterDef {
  id: string
  matcher: { ext?: string[] }
  label?: string
  actions?: string[]
  version?: string
  requiresSdk?: number
  maxBytes?: number
  renderer: (
    el: HTMLElement,
    file: HostFile,
    ctx: HostCtx,
    savedState?: unknown,
  ) => Promise<HostInstance | void> | HostInstance | void
}

export interface HostSdk {
  version: number
  registerApp(def: RegisterDef): { ok: boolean; reason?: string }
}
