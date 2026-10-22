/** 宿主契约的本地结构声明（插件零宿主导入——自包含 bundle，类型按形对齐 sdk/types.ts；html-editor 同口径） */

export interface HostFile {
  key: string
  name: string
  size: number
}

export interface HostCtx {
  getObject(key: string): Promise<Blob>
  t(key: string, params?: Record<string, unknown>): string
  notify(event: string, payload?: unknown): void
}

export interface HostInstance {
  dispose(): void
  getState?(): unknown
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
    appOptions?: unknown,
  ) => Promise<HostInstance | void> | HostInstance | void
}

export interface HostSdk {
  version: number
  registerApp(def: RegisterDef): { ok: boolean; reason?: string }
}

/**
 * pptx-preview 最小类型面（npm 包无 .d.ts——闭源 dist，按官方 README API 对形声明）：
 * init(container, {width,height}) → previewer；previewer.preview(arrayBuffer)。
 */
export interface PptxPreviewer {
  preview(data: ArrayBuffer): unknown
}

export interface PptxPreviewInit {
  (container: HTMLElement, opts: { width: number; height: number }): PptxPreviewer
}
