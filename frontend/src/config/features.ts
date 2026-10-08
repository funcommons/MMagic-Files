/**
 * 功能开关配置
 *
 * /dev-only 改造后, 仅保留两个 flag:
 * - `dev`         —— 控制 /dev 路由可见性 (路由 meta.feature)
 * - `imageToolbar`—— AigcImagePreview 工具栏显隐 (被 SDK 邻接组件引用, 不可删)
 *
 * 使用方式:
 *   import { isFeatureEnabled, type FeatureKey } from '@/config/features'
 *   if (isFeatureEnabled('dev')) { ... }
 */

export type FeatureKey = 'dev' | 'imageToolbar'

export const FEATURES: Record<FeatureKey, boolean> = {
  // 开发者页面 (/dev) - 组件演示 + 调试工具, 仅 ops 可见
  dev: true,
  // 作品详情弹窗内的「图片功能工具栏」(SDK 邻接组件引用)
  imageToolbar: true,
}

export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key]
}
