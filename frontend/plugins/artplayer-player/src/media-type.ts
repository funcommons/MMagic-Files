/**
 * 媒体类型映射（纯逻辑）：扩展名 → 'video' | 'audio' | null。
 * 白名单对齐内置 video-player/audio-player 两张 matcher 表（builtins.ts），不扩口。
 */
export const VIDEO_EXTS: readonly string[] = ['mp4', 'webm', 'mov']
export const AUDIO_EXTS: readonly string[] = ['mp3', 'wav', 'ogg', 'flac', 'm4a']

export type MediaKind = 'video' | 'audio'

/** 取扩展名（小写、无点）；无扩展名 → '' */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 扩展名 → 媒体形态；白名单外 → null（matcher 已挡，此处防御纵深） */
export function mediaKindOf(name: string): MediaKind | null {
  const ext = extOf(name)
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) return 'video'
  if ((AUDIO_EXTS as readonly string[]).includes(ext)) return 'audio'
  return null
}
