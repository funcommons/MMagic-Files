/**
 * useSidebarNavItems — 项目侧 nav 工厂 (基于 SDK 底座).
 *
 * 基建阶段仅一个占位首页入口; 业务路由落地后在此追加.
 */
import { computed, type ComputedRef } from 'vue'
import type { Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { HomeFilled } from '@element-plus/icons-vue'
import type { NavItem } from '@/components/sdk'

/** 默认展开的 sub-menu id 列表 (无 sub-menu 时为空数组) */
export const NAV_DEFAULT_OPENEDS: string[] = []

export function useSidebarNavItems(): ComputedRef<NavItem[]> {
  const { t } = useI18n()
  return computed<NavItem[]>(() => [
    {
      index: '/',
      label: t('router.home'),
      icon: HomeFilled as unknown as Component,
    },
  ])
}
