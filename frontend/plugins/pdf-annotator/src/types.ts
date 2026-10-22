/** 宿主契约本地结构（零宿主导入，形对齐 sdk/types.ts） */
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
  getState?(): unknown
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

/** 标注模型（方案 §4.3；坐标=PDF 用户空间 pt，y=左下） */
export interface Annotation {
  id: string
  page: number // 1-based
  type: 'rect' | 'text' | 'ink' | 'stamp'
  rect?: { x: number; y: number; w: number; h: number } // x,y=左下角
  points?: Array<{ x: number; y: number }>
  text?: string
  dataUrl?: string // stamp PNG
  style: { color: string; strokeWidth?: number; fontSize?: number }
  author: string
  createdAt: string
}
