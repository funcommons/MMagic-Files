/**
 * 图片尺寸类型
 */
export type ImageSize = 'tiny' | 'small' | 'medium' | 'large' | 'xlarge'

/**
 * 图片尺寸宽度映射
 */
const IMAGE_SIZE_WIDTH: Record<ImageSize, number> = {
  tiny: 160,    // 极小
  small: 320,   // 小
  medium: 640,  // 中
  large: 800,   // 大
  xlarge: 1920  // 极大
}

/**
 * 默认占位图 (300x300 灰色背景 + 图片图标)
 * 使用 data URI 格式
 */
export const PLACEHOLDER_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(`
<svg width="300" height="300" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
  <rect width="300" height="300" fill="#f5f5f7"/>
  <g fill="#c7c7cc">
    <rect x="100" y="90" width="100" height="70" rx="8"/>
    <circle cx="125" cy="115" r="12"/>
    <polygon points="115,145 140,120 175,145 155,155 115,155"/>
    <rect x="110" y="170" width="80" height="8" rx="4"/>
    <rect x="125" y="185" width="50" height="6" rx="3"/>
  </g>
</svg>
`)

/**
 * 图片URL转换函数
 * 用于处理OSS图片地址，添加尺寸参数以优化加载
 *
 * @param url - 图片地址
 * @param size - 可选尺寸，默认为 'medium'
 *   - tiny: 极小 (160px)
 *   - small: 小 (320px)
 *   - medium: 中 (640px)
 *   - large: 大 (800px)
 *   - xlarge: 极大 (1920px)
 * @returns 转换后的图片URL，空值返回占位图
 *
 * @example
 * // 基本使用
 * transformImageUrl('https://example.oss.com/image.jpg') // 默认 medium
 * transformImageUrl('https://example.oss.com/image.jpg', 'small')
 *
 * // 空值返回占位图
 * transformImageUrl(null) // 返回占位图
 * transformImageUrl('') // 返回占位图
 *
 * // 非OSS地址原样返回
 * transformImageUrl('https://example.com/image.jpg') // 返回原URL
 */
export function transformImageUrl(url: string | null | undefined, size: ImageSize = 'medium'): string {
  // 空值处理，返回占位图
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return PLACEHOLDER_IMAGE
  }

  // 检查是否为OSS地址
  if (!isOssUrl(url)) {
    return url
  }

  const width = IMAGE_SIZE_WIDTH[size]

  // 检查URL是否已有查询参数
  const separator = url.includes('?') ? '&' : '?'

  return `${url}${separator}x-oss-process=image/resize,w_${width}`
}

/**
 * 判断是否为OSS URL
 * @param url - 图片地址
 * @returns 是否包含oss域名
 */
export function isOssUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.toLowerCase().includes('oss')
  } catch {
    // URL解析失败，尝试简单字符串匹配
    return url.toLowerCase().includes('oss')
  }
}

/**
 * 基于名称生成 HASH 颜色
 * 渐变角度按名称最后一个字符的哈希值决定
 *
 * @param name - 名称
 * @returns 渐变色 CSS 字符串 (linear-gradient)
 */
export function getAvatarColor(name: string | undefined | null): string {
  if (!name || name.trim() === '') {
    return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  }

  const lastChar = name.slice(-1)
  const code = lastChar.charCodeAt(0)
  const angle = (code * 7) % 360
  const hue1 = angle
  const hue2 = (angle + 45) % 360

  return `linear-gradient(${angle}deg, hsl(${hue1}, 65%, 55%) 0%, hsl(${hue2}, 55%, 45%) 100%)`
}

/**
 * 获取名称的首字符
 *
 * @param name - 名称
 * @returns 首字符，大写字母
 */
export function getFirstChar(name: string | undefined | null): string {
  if (!name || name.trim() === '') {
    return '?'
  }
  return name.trim().charAt(0).toUpperCase()
}
// Barrel re-exports — 子模块可通过 @/utils 统一导入
export * from './date'
export * from './download'
export * from './errorHandler'
export * from './colorHash'
export * from './icon'
export * from './imageConvert'
export * from './logger'
export * from './notify'
export * from './storage'
