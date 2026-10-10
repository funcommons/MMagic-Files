/**
 * 文件大小格式化（R2-05：全仓统一口径）
 * 背景：回归 R2-05 实测同一屏三种口径并存——树列表「6.3 MB」（有空格）、大文件确认框「25.1MB」（无空格）、
 * 拒绝文案「>5MB/>20MB/>50MB」（硬编码词典）。本模块是唯一正本：
 *   - 预览闸（files/preview.ts largefile.rejected {limit}）
 *   - 树列表 size 列（files/ui/TreePanel.vue，原本地实现与本算法一致，收敛到此）
 *   - 渲染器超限提示（csv/markdown/code 的 too-large {limit}，R2-03 配套）
 * 口径契约：1024 基；「数值+空格+单位」（'174 B' / '1.5 KB' / '6.3 MB' / '1.2 GB'）；
 *          <100 一位小数、≥100 整数；负数（上游脏数据）钳 0；单位表 KB→MB→GB→TB，超出 TB 不再升单位。
 */

const UNITS = ['KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  const n = bytes > 0 ? bytes : 0 // 负数钳 0（NaN 落 0 分支同口径）
  if (n < 1024) return `${n} B`
  let v = n
  let i = -1
  do {
    v /= 1024
    i += 1
  } while (v >= 1024 && i < UNITS.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${UNITS[i]}`
}
