/** 宿主契约的本地结构声明（插件零宿主导入——自包含 bundle，类型按形对齐 sdk/types.ts） */

export interface HostFile {
  key: string
  name: string
  size: number
}

export interface HostCtx {
  getObject(key: string): Promise<Blob>
  putObject(key: string, blob: Blob): Promise<void>
  t(key: string, params?: Record<string, unknown>): string
  notify(event: string, payload?: unknown): void
}

export interface HostInstance {
  dispose(): void
  beforeDispose?(): boolean | Promise<boolean>
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
