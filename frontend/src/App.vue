<template>
  <FcThemeProvider
    :initial-brand="oem.config.brand || 'ldx2'"
    :initial-theme="(oem.config.theme as 'light' | 'dark') || 'light'"
    v-model:brand="brand"
    v-model:theme="theme"
  >
    <FcErrorBoundary>
      <router-view />
    </FcErrorBoundary>

    <!-- 全局命令面板 (#8) -->
    <FcCommandPalette v-model:open="paletteState.open" :commands="paletteState.commands" />
  </FcThemeProvider>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { FcThemeProvider, FcCommandPalette, FcErrorBoundary } from '@/components/sdk'
import { usePreferenceStore } from '@/store/preference'
import { useOemStore } from '@/store/oem'
import { useCommandPaletteState } from '@/composables'
import i18n from '@/locales'
import type { ThemeMode } from '@/components/sdk/theme/brands'

const preference = usePreferenceStore()
const oem = useOemStore()

// 主题/品牌状态由 FcThemeProvider 管理 (内部持久化到 localStorage)
const brand = ref<string>(oem.config.brand || 'ldx2')
const theme = ref<ThemeMode>((oem.config.theme as ThemeMode) || 'light')

// OEM 配置变化时同步默认值 (首次拉取后)
watch(() => oem.config, (cfg) => {
  if (cfg.brand && !brand.value) brand.value = cfg.brand
  if (cfg.theme && !theme.value) theme.value = cfg.theme as ThemeMode
}, { deep: true })

// 嵌入模式同步: setFromEmbed() 修改 preference store → 同步到 FcThemeProvider 的 v-model
// (FcThemeProvider 是 brand/theme 的真实 DOM 写入端, preference.applyToRoot 会被 Provider 覆盖)
// immediate: 路由守卫在 app.mount 前已跑完 setFromEmbed, 此处需立即同步当前值
watch(() => preference.brand, (v) => { if (v !== brand.value) brand.value = v }, { immediate: true })
watch(() => preference.theme, (v) => { if (v !== theme.value) theme.value = v as ThemeMode }, { immediate: true })

// locale 仍由 preference store 管 (Provider 只管 brand/theme)
const locale = computed(() => preference.locale)
watch(locale, (v) => {
  i18n.global.locale.value = v
}, { immediate: true })

onMounted(() => {
  i18n.global.locale.value = preference.locale
})

// 全局命令面板 (#8)
const { state: paletteState } = useCommandPaletteState()
</script>

<style>
/* 全局样式已在 styles/index.scss 中定义 */
</style>
