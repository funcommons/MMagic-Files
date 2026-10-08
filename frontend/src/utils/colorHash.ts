/**
 * Category 哈希取色 (灵感广场 TagCloud 等用)
 *
 * 同一 category 在所有 chip 选中/未选中色一致, 不依赖后端 color 字段,
 * 也不在前端硬编码, 后端运维增删 category 自动有唯一色.
 *
 * 算法: 字符串 → djb2 hash → HSL 色相 (0-359), 饱和度 65% / 明度 50%.
 * 优点: 跨刷新一致 / 60 个 tag 在 360 hue 上够分散 / 视觉鲜明.
 */

const hashString = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (s.charCodeAt(i) * 31 + h) | 0
  }
  return Math.abs(h)
}

/** 选中态: hsl(h, 70%, 38%) 深色高饱和背景 + 白字 */
export const colorActive = (category: string): string => {
  const hue = hashString(category) % 360
  return `hsl(${hue}, 70%, 38%)`
}

/** 未选中态: hsl(h, 30%, 98%) 极浅色背景 (低饱和高明度, 几乎不抢眼) + 同色系深色文字 */
export const colorIdle = (category: string): { bg: string; text: string } => {
  const hue = hashString(category) % 360
  return {
    bg: `hsl(${hue}, 30%, 98%)`,
    text: `hsl(${hue}, 55%, 30%)`,
  }
}
