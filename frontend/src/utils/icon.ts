import * as ElementPlusIconsVue from '@element-plus/icons-vue'

/**
 * resolveIcon — 类型安全地按字符串名取 ElementPlus 图标组件.
 *
 * 用法:
 *   import { resolveIcon } from '@/utils'
 *   const iconComp = computed(() => resolveIcon(props.tool.icon))
 *
 * 替代 `(ElementPlusIconsVue as any)[name]` 的反模式.
 * 找不到时回退 Document (对齐项目内已有行为).
 */
export function resolveIcon(name?: string | null) {
  if (!name) return ElementPlusIconsVue.Document
  const map = ElementPlusIconsVue as unknown as Record<string, unknown>
  return (map[name] as typeof ElementPlusIconsVue.Document) || ElementPlusIconsVue.Document
}

/** 暴露所有合法图标名 (用于 prop 类型约束). */
export type IconName = keyof typeof ElementPlusIconsVue
