<script setup lang="ts">
/**
 * Home.vue — 基建占位首页。
 *
 * 仅用于验证脚手架链路 (路由/i18n/主题/SDK 组件) 可用,
 * 业务功能由后续迭代填充。
 */
import { useI18n } from 'vue-i18n'
import { FcSectionCard, FcButton } from '@/components/sdk'
import { usePreferenceStore } from '@/store/preference'

const { t } = useI18n()
const preference = usePreferenceStore()

function toggleLocale() {
  preference.setLocale(preference.locale === 'zh-CN' ? 'en-US' : 'zh-CN')
}
</script>

<template>
  <div class="home-page">
    <FcSectionCard class="home-hero" padding="lg">
      <h1 class="home-hero__title">{{ t('home.title') }}</h1>
      <p class="home-hero__subtitle">{{ t('home.subtitle') }}</p>
      <FcButton variant="secondary" @click="toggleLocale">
        {{ t('home.toggle-locale') }}
      </FcButton>
    </FcSectionCard>
  </div>
</template>

<style lang="scss" scoped>
.home-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.home-hero {
  max-width: 560px;
  text-align: center;
}

.home-hero__title {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 700;
  color: var(--app-text);
}

.home-hero__subtitle {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--app-text-secondary);
}
</style>
