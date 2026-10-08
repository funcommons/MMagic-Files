/**
 * triggerDownload — 浏览器端触发文件下载.
 *
 * 用法:
 *   triggerDownload(url, 'export.png')
 *   triggerDownload(dataUrl, `work-${id}.jpg`)
 *
 * 替代 7 处散落的:
 *   const a = document.createElement('a')
 *   a.href = url; a.download = filename; a.click()
 *
 * 对 data: URL/blob: URL 直接 click; 对 http(s) URL 也兼容 (浏览器会下载而非跳转).
 */
export function triggerDownload(url: string, filename: string): void {
  if (typeof document === 'undefined') return
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
