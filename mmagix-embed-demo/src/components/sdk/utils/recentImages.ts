/**
 * useRecentImages — useRecentList 的图片 URL 语义包装 (SDK 内部 / 老 API 兼容).
 *
 * 新代码建议直接用 useRecentProvider + createLocalStorageRecentProvider, 更灵活.
 * 本文件保留以兼容已有调用方 (ColorPickerPopover 等).
 */
import { useRecentList } from './recentList'

const DEFAULT_LIMIT = 12

export function useRecentImages(key: string = 'smart-image-picker:recent') {
  const { items, add, remove, clear, getAll, limit } = useRecentList<string>({ key, limit: DEFAULT_LIMIT })
  return { images: items, add, remove, clear, getAll, RECENT_LIMIT: limit }
}