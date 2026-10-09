<script setup lang="ts">
/**
 * SessionBanner — 会话横幅（Wave2-T2）：500ms 轮询 session.warnedOnce / isExpired。
 * warned → T-5min 预警横幅（el-alert）；expired → 整屏终态 + 重新加载引导
 * （刷新=从 fragment 配置重建会话，§4.2 UX 自毁线）。intervalMs 供测试注入（默认 500）。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton, FcSectionCard } from '@/components/sdk'
import type { SessionController } from '@/sdk/session'

const props = withDefaults(
  defineProps<{
    session: SessionController
    /** 轮询间隔毫秒（默认 500；测试可调小） */
    intervalMs?: number
  }>(),
  { intervalMs: 500 },
)

const { t } = useI18n()
const warned = ref(props.session.warnedOnce)
const expired = ref(props.session.isExpired())
let timer: ReturnType<typeof setInterval> | undefined

function tick(): void {
  warned.value = props.session.warnedOnce
  expired.value = props.session.isExpired()
}

function reload(): void {
  window.location.reload()
}

onMounted(() => {
  timer = setInterval(tick, props.intervalMs)
})

onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer)
})
</script>

<template>
  <div v-if="expired" class="sb-mask" data-testid="expired-mask">
    <FcSectionCard class="sb-card" padding="lg">
      <h2 class="sb-title">{{ t('boot.session-expired') }}</h2>
      <p class="sb-hint">{{ t('files.session.expired-hint') }}</p>
      <FcButton variant="primary" @click="reload">{{ t('files.session.reload') }}</FcButton>
    </FcSectionCard>
  </div>
  <el-alert
    v-else-if="warned"
    class="sb-banner"
    type="warning"
    show-icon
    :closable="false"
    :title="t('files.session.warn')"
  />
</template>

<style lang="scss" scoped>
.sb-banner {
  margin-bottom: 8px;
}

.sb-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--app-overlay-strong, rgba(0, 0, 0, 0.6));
}

.sb-card {
  max-width: 420px;
  text-align: center;
}

.sb-title {
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.sb-hint {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--app-text-secondary);
}
</style>
