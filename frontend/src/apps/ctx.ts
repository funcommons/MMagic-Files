/**
 * AppCtx 工厂——把数据面实现（工作台=S3Client / 单文件=UrlSourceProvider）装配成插件能力面
 * 契约：《动态插件方案.md》V1.1 §二 ctx 能力面 + notify→fileChanged 映射表
 */
import type { AppCtx, FileChangedPayload } from '../sdk/types'

export interface NotifySink {
  /** 装配层接 bus.emit('fileChanged', payload) */
  (payload: FileChangedPayload): void
}

export interface AppCtxDeps {
  getObject(key: string): Promise<Blob>
  putObject(key: string, data: Blob, contentType?: string): Promise<void>
  t(key: string): string
  theme: Record<string, string>
  /** fileChanged 出口 */
  notifyFileChanged: NotifySink
  /** 可选能力：媒体直链透传（s3=presigned / url source=原始 URL；缺省=ctx 不带该键） */
  getMediaUrl?: (key: string) => string
}

/** notify type → fileChanged action 映射（契约正本：《动态插件方案.md》§二） */
export function mapNotifyAction(type: 'saved' | 'changed' | 'deleted' | 'renamed'): FileChangedPayload['action'] {
  switch (type) {
    case 'saved':
    case 'changed':
      return 'put'
    case 'deleted':
      return 'delete'
    case 'renamed':
      return 'rename'
  }
}

export function createAppCtx(deps: AppCtxDeps): AppCtx {
  return {
    getObject: (key) => deps.getObject(key),
    putObject: (key, data, contentType) => deps.putObject(key, data, contentType),
    t: (key) => deps.t(key),
    theme: deps.theme,
    notify: (type, payload) => {
      deps.notifyFileChanged({ key: payload.key, action: mapNotifyAction(type), from: payload.from })
    },
    // 条件展开：能力缺省时 ctx 上不带该键（渲染器按 getMediaUrl? 探测，回落 Blob 路径）
    ...(deps.getMediaUrl ? { getMediaUrl: (key: string) => deps.getMediaUrl!(key) } : {}),
  }
}
