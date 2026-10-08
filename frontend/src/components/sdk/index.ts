// SDK 组件库统一入口 (聚合各子目录 barrel).
//
// 两种引入方式:
//   全量:     import { FcButton } from '@/components/sdk'
//   按目录:   import { FcButton } from '@/components/sdk/form'  (树摇更友好, copy 单目录自解释)
//
// 各子目录 index.ts 是自治 barrel, copy 该目录即带自己的导出清单.

export * from './data'
export * from './display'
export * from './feedback'
export * from './form'
export * from './layout'
export * from './navigation'
export * from './overlay'
export * from './section'
export * from './theme'
export * from './utils'
