export { default as FcHeader } from './FcHeader.vue'
export { default as FcMain } from './FcMain.vue'
export { default as FcSidebar } from './FcSidebar.vue'
export { default as FcSidebarNav } from './FcSidebarNav.vue'
export { default as FcNavGroup } from './FcNavGroup.vue'
export { default as FcSidePanel } from './FcSidePanel.vue'
export { default as FcSidebarToggle } from './FcSidebarToggle.vue'

export type { FcMainProps } from './FcMain.vue'
export type { FcSidebarProps } from './FcSidebar.vue'
export type { FcSidebarNavProps } from './FcSidebarNav.vue'
export type { FcNavGroupProps } from './FcNavGroup.vue'
export type { FcSidePanelProps } from './FcSidePanel.vue'
export type { FcSidebarToggleProps } from './FcSidebarToggle.vue'

// nav 类型
export type { NavLeaf, NavGroup, NavItem } from './FcSidebarNav.vue'

// layout composables
export { useRouteAccess, filterRoutes } from './useRouteAccess'
export type { RouteAccessOptions } from './useRouteAccess'
export { buildNavItems } from './buildNavItems'
export type { BuildNavOptions, NavGroupRule, NavTopLevelRule } from './buildNavItems'
export { useSidebarNavItems } from './useSidebarNavItems'
export type { UseSidebarNavOptions } from './useSidebarNavItems'
