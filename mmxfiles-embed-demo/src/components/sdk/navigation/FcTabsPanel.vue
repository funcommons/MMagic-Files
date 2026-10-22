<template>
  <div class="fc-tabs-panel" :class="{ 'fc-tabs-panel--card': card }">
    <!-- Tab 栏 -->
    <div v-if="showTabsBar" class="fc-tabs">
      <button
        v-for="t in tabs"
        :key="t.value"
        class="fc-tab"
        :class="{ active: modelValue === t.value, disabled: t.disabled }"
        :disabled="t.disabled"
        @click="onTabClick(t)"
      >
        <i v-if="t.icon" :class="t.icon" />
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 内容区:每个 tab 一一对应 #tab-{value} slot;未匹配时显示 #default -->
    <div class="fc-tabs-content">
      <template v-for="t in tabs" :key="t.value">
        <div v-if="modelValue === t.value" class="fc-tab-pane">
          <slot :name="`tab-${t.value}`" />
        </div>
      </template>
      <slot v-if="!hasActiveSlot" name="default" />
    </div>

    <!-- 底部 slot -->
    <div v-if="$slots.footer" class="fc-tabs-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'FcTabsPanel' })
import { computed } from 'vue'

export interface TabItem {
  value: string
  label: string
  icon?: string
  disabled?: boolean
}

export interface FcTabsPanelProps {
  /** tab 列表 */
  tabs: TabItem[]
  /** 当前激活的 tab value (v-model) */
  modelValue: string
  /** 是否显示 tab 栏 (单 tab 时可隐藏) */
  showTabsBar?: boolean
  /**
   * 是否启用卡片视觉 (与 FcSection 同等).
   * true 时:
   *   - tab 行与 content 之间多 12px 间距
   *   - .fc-tabs-content 加 bg + border-radius + box-shadow + border (标准卡片)
   *   - .fc-tab-pane padding=0 (内部卡片自己决定)
   * 默认 false (保留原裸样式, 不破坏其它页面).
   */
  card?: boolean
}

const props = withDefaults(defineProps<FcTabsPanelProps>(), {
  showTabsBar: true,
  card: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'tab-click': [value: string]
}>()

const hasActiveSlot = computed(() =>
  props.tabs.some(t => t.value === props.modelValue)
)

function onTabClick(t: TabItem) {
  if (t.disabled || t.value === props.modelValue) return
  emit('update:modelValue', t.value)
  emit('tab-click', t.value)
}
</script>

<style scoped lang="scss">
.fc-tabs-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.fc-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-bottom: 1px solid var(--app-separator, #e5e5e5);
  flex-shrink: 0;
}

.fc-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--app-text-secondary, #666);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--radius-sm, 6px);
  transition: background 0.15s, color 0.15s;

  i {
    font-size: 16px;
  }

  &:hover:not(:disabled) {
    background: var(--app-bg-muted, #f5f5f5);
    color: var(--app-text-primary, #333);
  }

  &.active {
    background: color-mix(in srgb, var(--app-primary, #409eff) 12%, transparent);
    color: var(--app-primary, #409eff);
  }

  &:disabled,
  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.fc-tabs-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.fc-tab-pane {
  padding: var(--space-md, 12px);
}

.fc-tabs-footer {
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  border-top: 1px solid var(--app-separator, #e5e5e5);
  background: var(--app-bg-page, #fafafa);
  flex-shrink: 0;
}

/* ---- opt-in: 卡片视觉 (与 FcSection 同等) ---- */
.fc-tabs-panel--card .fc-tabs {
  margin-bottom: 12px;       // tab 行 ↔ content 间距
}

.fc-tabs-panel--card .fc-tabs-content {
  background: var(--el-bg-color);
  border-radius: var(--app-radius-card, 8px);
  box-shadow: var(--app-shadow-md);
  border: 1px solid var(--el-border-color-extra-light);
  overflow: hidden;
  min-height: 200px;
}

.fc-tabs-panel--card .fc-tab-pane {
  padding: 0;                // 内部卡片自带 padding (FcSection padding="none" 接管), 不叠
}
</style>
