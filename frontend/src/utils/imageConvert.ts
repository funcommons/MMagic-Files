/**
 * 图片格式转换 + 下载工具
 *
 * 通过 fetch + createImageBitmap + canvas.toBlob 在前端做格式转换,
 * 不依赖后端。跨域图片走 image_proxy 代理避免 canvas 被污染。
 */

export type ImageFormat = 'png' | 'jpg' | 'webp' | 'avif' | 'gif'

export interface ImageFormatConfig {
  value: ImageFormat
  mime: string
  quality?: number
  ext: string
}

export const IMAGE_FORMATS: ImageFormatConfig[] = [
  { value: 'png',  mime: 'image/png',  ext: 'png' },
  { value: 'jpg',  mime: 'image/jpeg', quality: 1.0, ext: 'jpg' },
  { value: 'webp', mime: 'image/webp', quality: 1.0, ext: 'webp' },
  { value: 'avif', mime: 'image/avif', quality: 1.0, ext: 'avif' },
  { value: 'gif',  mime: 'image/gif',  ext: 'gif' },
]

export function getFormatConfig(format: ImageFormat): ImageFormatConfig {
  const cfg = IMAGE_FORMATS.find(f => f.value === format)
  if (!cfg) throw new Error(`Unknown image format: ${format}`)
  return cfg
}

function toProxyUrl(url: string): string {
  if (!url) return url
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/image_proxy/')) return url
  try {
    const u = new URL(url, window.location.origin)
    if (u.origin === window.location.origin) return url
  } catch { return url }
  return '/image_proxy/' + url.replace('://', '/')
}

/**
 * 把图片 URL 转换为目标格式的 Blob
 *
 * 若源 blob 的 MIME 与目标 MIME 相同, 直接返回原 blob (避免再编码导致画质损失)。
 */
export async function convertImage(url: string, format: ImageFormat): Promise<{ blob: Blob, ext: string }> {
  const cfg = getFormatConfig(format)
  const proxyUrl = toProxyUrl(url)

  const res = await fetch(proxyUrl)
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`)
  const blob = await res.blob()

  if (blob.type === cfg.mime) {
    return { blob, ext: cfg.ext }
  }

  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  const outBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('toBlob returned null')),
      cfg.mime,
      cfg.quality
    )
  })
  return { blob: outBlob, ext: cfg.ext }
}

/**
 * 转换并触发浏览器下载
 */
export async function downloadConvertedImage(
  url: string,
  format: ImageFormat,
  filename: string,
): Promise<void> {
  const { blob, ext } = await convertImage(url, format)
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = `${filename}.${ext}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000)
}
