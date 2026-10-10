<script setup lang="ts">
/**
 * StatusBar — 工作台底部一行常驻状态条（Lane G3：状态栏 + 只读降级双轨）。
 *
 * 分段：
 * - 位置段：bucket[/prefix]（prefix 变化由父层响应式传入，去尾斜杠后拼接）
 * - 传输段：transfers>0 才显示；点击 emit('transfers-click')，动作（如打开传输面板）归父层
 * - 只读徽章：readonly=true 显示——警示色 + statusbar.readonly-hint tooltip。
 *   语义对齐 OpenVSCode 降级哲学：权限不足 = 可见的降级状态，不是报错形态
 * - 会话段：session.remainingMs 有限时显示 formatRemaining 倒计时；Infinity/null 隐藏。
 *   组件内部 1s 心跳重算自身显示（口径对齐 Home.vue sessionInfo：静态 prop 快照 + 本地时钟推进）；
 *   父层推新 remainingMs 即重置心跳锚点；点击 emit('session-click')
 *
 * Home/布局集成由主线收口，本组件为组件级交付（不依赖 session 单例，props 面向接口）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcTooltip } from '@/components/sdk'
import { formatRemaining } from '@/files/session-format'

const props = withDefaults(
  defineProps<{
    bucket: string
    prefix: string
    /** 传输中任务数；0 隐藏该段 */
    transfers: number
    /** true 显示只读徽章（警示色 + tooltip=statusbar.readonly-hint） */
    readonly: boolean
    /** 会话剩余毫秒快照；Infinity（无 TTL）/null 隐藏 */
    session?: { remainingMs: number } | null
  }>(),
  { session: null },
)

const emit = defineEmits<{
  'transfers-click': []
  'session-click': []
}>()

const { t } = useI18n()

/** 位置段文案：bucket[/prefix]（prefix 去尾斜杠；空则仅 bucket） */
const locationText = computed(() => {
  const p = props.prefix.replace(/\/+$/, '')
  return p ? `${props.bucket}/${p}` : props.bucket
})

/** 心跳时钟（1s）+ 倒计时锚点（父层推新 remainingMs 时归零） */
const nowTick = ref(Date.now())
const anchorAt = ref(Date.now())
watch(
  () => props.session?.remainingMs,
  () => {
    anchorAt.value = Date.now()
    nowTick.value = anchorAt.value
  },
)

/** 会话段文案；null = 隐藏（无 session / 非 /Infinity）。过期迟到推送钳 0（对齐 Home.vue 口径） */
const sessionText = computed<string | null>(() => {
  const ms = props.session?.remainingMs
  if (ms === undefined || !Number.isFinite(ms)) return null
  void nowTick.value // 建立心跳依赖：每秒重算
  return formatRemaining(Math.max(0, ms - (nowTick.value - anchorAt.value)))
})

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer)
})
</script>

<template>
  <div class="stbar" data-testid="statusbar">
    <!-- 位置段：bucket[/prefix] -->
    <span class="stbar__seg stbar__loc">
      <span class="stbar__label">{{ t('statusbar.bucket') }}</span>
      <span class="stbar__value">{{ locationText }}</span>
    </span>

    <span class="stbar__spacer" />

    <!-- 传输段：>0 才显示；点击动作归父层 -->
    <button
      v-if="transfers > 0"
      type="button"
      class="stbar__seg stbar__btn fc-button fc-button-xs"
      data-testid="statusbar-transfers"
      @click="emit('transfers-click')"
    >
      <span class="stbar__label">{{ t('statusbar.transfers') }}</span>
      <span class="stbar__value">{{ transfers }}</span>
    </button>

    <!-- 只读徽章：可见的降级状态（警示色，非报错形态）；tooltip 说明影响面 -->
    <FcTooltip v-if="readonly" :content="t('statusbar.readonly-hint')" placement="top">
      <span class="stbar__seg stbar__readonly" data-testid="statusbar-readonly">
        {{ t('statusbar.readonly') }}
      </span>
    </FcTooltip>

    <!-- 会话段：有限 TTL 才显示；点击动作归父层 -->
    <button
      v-if="sessionText !== null"
      type="button"
      class="stbar__seg stbar__btn fc-button fc-button-xs"
      data-testid="statusbar-session"
      @click="emit('session-click')"
    >
      <span class="stbar__label">{{ t('statusbar.session') }}</span>
      <span class="stbar__value">{{ sessionText }}</span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.stbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  line-height: 1;
  color: var(--app-text-secondary, #6e6e73);
  background: var(--app-bg-card, #fff);
  border-top: 1px solid var(--app-separator, #e5e5e5);
  user-select: none;
}

.stbar__seg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.stbar__label {
  color: var(--app-text-tertiary, #999);
}

.stbar__value {
  color: var(--app-text-primary, #1d1d1f);
  font-variant-numeric: tabular-nums; // 倒计时数字不跳动
}

.stbar__spacer {
  flex: 1;
}

/* 段钮（R2-09）：挂 SDK fc-button fc-button-xs 类。SDK 规格 xs=24px，状态条 28px 高、
   行内按钮 22px——全局 button.fc-button-xs 特异性 (0,2,1)，这里嵌套 .stbar 到 (0,3,0)
   钉死紧凑条内规格（R2-09 口径：28px 紧凑条用类方案，与 TreePanel 一致）。 */
.stbar .stbar__btn {
  height: 22px;
  margin: 0;
  padding: 0 6px;
  border: none;
  border-radius: var(--app-radius-sm, 4px);
  background: transparent;
  font: inherit;
  cursor: pointer;

  &:hover {
    background: var(--app-bg-muted, rgba(0, 0, 0, 0.04));
  }

  &:focus-visible {
    outline: 1px solid var(--app-primary, #409eff);
  }
}

// 只读徽章：警示色底 + 警示色字（降级状态可见，但不是 danger 报错形态）
.stbar__readonly {
  padding: 3px 8px;
  border-radius: var(--app-radius-sm, 4px);
  font-weight: 600;
  color: var(--app-color-warning, #e6a23c);
  background: color-mix(in srgb, var(--app-color-warning, #e6a23c) 14%, transparent);
  cursor: default;
}
</style>
