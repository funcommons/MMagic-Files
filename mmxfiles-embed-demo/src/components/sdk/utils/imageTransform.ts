/**
 * imageTransform — 图片转换 + 缩放 + 自定义上传 (SDK 内部工具, 纯函数).
 *
 * 从 composables/sdk/useImageTransform.ts 搬入 (FcImagePicker 唯一调用方).
 * 无 Vue / 业务依赖, 仅用浏览器 Image + canvas + URL.createObjectURL, 跨项目可移植.
 */

export interface UploadApiConfig {
  url: string
  method?: 'POST' | 'PUT'
  fieldName?: string
  headers?: Record<string, string>
  responseUrlField?: string
}

/** 把 blob 转成目标 mime 格式.
 * 质量规则: png/bmp → webp/jpg 时 95% (有损, 体积小); 其它组合 100% (png/webp 无损优先).
 * png/bmp → jpeg 时自动填白底防止透明区变黑. */
export function convertImage(blob: Blob, targetMime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objUrl = URL.createObjectURL(blob)
    const cleanup = () => URL.revokeObjectURL(objUrl)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) { cleanup(); reject(new Error('Canvas 2D context unavailable')); return }
      const srcLossy = blob.type === 'image/png' || blob.type === 'image/bmp'
      const tgtLossy = targetMime === 'image/jpeg' || targetMime === 'image/webp'
      if (srcLossy && tgtLossy && targetMime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.drawImage(img, 0, 0)
      const q = srcLossy && tgtLossy ? 0.95 : 1.0
      canvas.toBlob(
        (out) => { cleanup(); out ? resolve(out) : reject(new Error('toBlob returned null')) },
        targetMime, q,
      )
    }
    img.onerror = () => { cleanup(); reject(new Error('Failed to load image')) }
    img.src = objUrl
  })
}

/** 长边超 maxEdge 时等比缩放, 短边图原样返回. */
export function downscaleToMaxEdge(blob: Blob, maxEdge: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objUrl = URL.createObjectURL(blob)
    const cleanup = () => URL.revokeObjectURL(objUrl)
    img.onload = () => {
      const longEdge = Math.max(img.width, img.height)
      if (longEdge <= maxEdge) { cleanup(); resolve(blob); return }
      const scale = maxEdge / longEdge
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { cleanup(); reject(new Error('Canvas 2D context unavailable')); return }
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, w, h)
      const srcMime = blob.type || 'image/png'
      const q = srcMime === 'image/jpeg' || srcMime === 'image/webp' ? 0.95 : 1.0
      canvas.toBlob(
        (out) => { cleanup(); out ? resolve(out) : reject(new Error('toBlob returned null')) },
        srcMime, q,
      )
    }
    img.onerror = () => { cleanup(); reject(new Error('Failed to load image')) }
    img.src = objUrl
  })
}

/** 用自定义接口上传, FormData + POST/PUT, dot path 取响应 URL. */
export async function uploadViaApi(blob: Blob, api: UploadApiConfig, fileName: string): Promise<string> {
  const fd = new FormData()
  fd.append(api.fieldName || 'file', blob, fileName)
  const res = await fetch(api.url, {
    method: api.method || 'POST',
    headers: api.headers,
    body: fd,
  })
  if (!res.ok) throw new Error(`uploadApi ${api.method || 'POST'} ${api.url} → ${res.status}`)
  const json = await res.json().catch(() => null)
  if (!json) throw new Error('uploadApi 响应不是 JSON')
  const path = api.responseUrlField || 'url'
  const url = path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, json)
  if (typeof url !== 'string' || !url) throw new Error(`uploadApi 响应里取不到 ${path} 字段`)
  return url
}