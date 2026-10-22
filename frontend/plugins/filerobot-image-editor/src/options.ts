/**
 * 参数归一化（纯逻辑，无 DOM——单测口径）。非法值丢弃走缺省（参数坏不击穿渲染链）。
 * defaultTab 合法值 = 内核 4.9 的 tab 枚举（react-filerobot-image-editor TABS）六值——
 * **没有 'Crop' Tab**（Crop 是 Adjust 内的工具；传非法 tab id 会让内核 tools-bar 查表崩）。
 */
import type { EditorOptions } from './types'

export const TAB_IDS: readonly string[] = [
  'Adjust',
  'Finetune',
  'Filters',
  'Annotate',
  'Resize',
  'Watermark',
]

export const DEFAULT_TAB = 'Annotate'

export function normalizeOptions(raw: unknown): Required<EditorOptions> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { defaultTab: DEFAULT_TAB }
  const o = raw as Record<string, unknown>
  return {
    defaultTab: typeof o.defaultTab === 'string' && (TAB_IDS as readonly string[]).includes(o.defaultTab)
      ? o.defaultTab
      : DEFAULT_TAB,
  }
}

/** 导出扩展名：编辑器默认 png；jpg/jpeg/webp 按原扩展导出（bmp/gif 无对应导出器 → png） */
export function exportExtOf(name: string): string {
  const i = name.lastIndexOf('.')
  const ext = i < 0 ? '' : name.slice(i + 1).toLowerCase()
  return ['jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png'
}
