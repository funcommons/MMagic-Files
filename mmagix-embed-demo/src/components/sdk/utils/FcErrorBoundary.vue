<script setup lang="ts">
defineOptions({ name: 'FcErrorBoundary' })
/**
 * FcErrorBoundary — 错误边界 (#7 错误边界 + 一键重试).
 *
 * 用法:
 *   <FcErrorBoundary @retry="reload">
 *     <HeavyComponent />
 *   </FcErrorBoundary>
 *
 *   <FcErrorBoundary>
 *     <template #error="{ error, retry }">
 *       <MyCustomFallback :error="error" @retry="retry" />
 *     </template>
 *     <HeavyComponent />
 *   </FcErrorBoundary>
 */

import { computed, onErrorCaptured, ref } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  /** 自定义 fallback 文案 (i18n key), 默认 'ux.error-boundary.fallback' */
  fallbackMessage?: string
}
const props = withDefaults(defineProps<Props>(), {
  fallbackMessage: '',
})

const emit = defineEmits<{
  retry: []
  reset: []
}>()

const { t } = useI18n()
const error = ref<unknown>(null)
const renderKey = ref(0)

const message = computed(() =>
  props.fallbackMessage || t('ux.error-boundary.fallback'),
)

onErrorCaptured((err) => {
  error.value = err
  // eslint-disable-next-line no-console
  console.error('[FcErrorBoundary]', err)
  return false
})

function retry() {
  error.value = null
  renderKey.value++
  emit('retry')
}

function reset() {
  error.value = null
  renderKey.value++
  emit('reset')
}
</script>

<template>
  <div v-if="error" class="fc-error-boundary">
    <slot name="error" :error="error" :retry="retry" :reset="reset">
      <div class="fc-error-boundary__default">
        <div class="fc-error-boundary__icon">
          <i class="ri-error-warning-line" />
        </div>
        <h3 class="fc-error-boundary__title">{{ t('ux.error-boundary.title') }}</h3>
        <p class="fc-error-boundary__message">{{ message }}</p>
        <div class="fc-error-boundary__actions">
          <button type="button" class="fc-error-boundary__btn fc-error-boundary__btn--primary" @click="retry">
            <i class="ri-refresh-line" />
            {{ t('ux.error-boundary.retry') }}
          </button>
        </div>
      </div>
    </slot>
  </div>
  <div v-else :key="renderKey">
    <slot :retry="retry" />
  </div>
</template>

<style scoped>
.fc-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  padding: 32px;
}
.fc-error-boundary__default {
  text-align: center;
  max-width: 360px;
}
.fc-error-boundary__icon {
  font-size: 48px;
  color: var(--el-color-warning, #e6a23c);
  margin-bottom: 12px;
}
.fc-error-boundary__title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text);
}
.fc-error-boundary__message {
  margin: 0 0 20px;
  color: var(--app-text-secondary);
  font-size: 14px;
  line-height: 1.5;
}
.fc-error-boundary__actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.fc-error-boundary__btn {
  appearance: none;
  border: none;
  padding: 8px 20px;
  border-radius: var(--app-radius-sm, 8px);
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.fc-error-boundary__btn--primary {
  background: var(--el-color-primary);
  color: #fff;
}
.fc-error-boundary__btn--primary:hover {
  opacity: 0.9;
}
</style>