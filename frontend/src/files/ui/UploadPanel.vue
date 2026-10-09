<script setup lang="ts">
/**
 * UploadPanel — 上传任务面板（Lane F5）。
 * 展示 queue 任务（名称/进度%/状态：上传中|完成|失败|已取消），每项取消、终态清除。
 * 任务登记与事件订阅在 Home 层收口（UploadQueue 本体不枚举任务、hooks 为构造期只读），
 * 本组件纯展示：props.tasks 进、cancel/clear 事件出（便于 jsdom mount 直测）。
 * 无任务不渲染；风格对齐 Fc*（t() 文案 + CSS 变量 + FcButton）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton } from '@/components/sdk'

export interface UploadTaskView {
  id: string
  name: string
  loaded: number
  total: number
  status: 'uploading' | 'done' | 'failed' | 'cancelled'
}

const props = defineProps<{ tasks: UploadTaskView[] }>()

const emit = defineEmits<{
  /** 取消单条任务（Home 接 queue.abort） */
  cancel: [id: string]
  /** 清除已完成/失败/已取消记录（上传中保留） */
  clear: []
}>()

const { t } = useI18n()

const STATUS_KEY: Record<UploadTaskView['status'], string> = {
  uploading: 'files.upload.uploading',
  done: 'files.upload.done',
  failed: 'files.upload.failed',
  cancelled: 'files.upload.cancelled',
}

const hasTerminal = computed(() => props.tasks.some((x) => x.status !== 'uploading'))

function percentOf(task: UploadTaskView): number {
  if (task.total <= 0) return task.status === 'done' ? 100 : 0
  return Math.min(100, Math.round((task.loaded / task.total) * 100))
}
</script>

<template>
  <section v-if="tasks.length > 0" class="upload-panel" data-testid="upload-panel">
    <header class="upload-panel__head">
      <i class="ri-upload-2-line upload-panel__title-icon" />
      <span class="upload-panel__title">{{ t('files.upload.title') }}</span>
      <span class="upload-panel__spacer" />
      <FcButton v-if="hasTerminal" variant="text" size="sm" data-testid="upload-clear" @click="emit('clear')">
        {{ t('files.upload.clear') }}
      </FcButton>
    </header>
    <ul class="upload-panel__list">
      <li
        v-for="task in tasks"
        :key="task.id"
        class="upload-panel__item"
        :class="`is-${task.status}`"
        data-testid="upload-item"
      >
        <i class="ri-file-line upload-panel__icon" />
        <span class="upload-panel__name" :title="task.name">{{ task.name }}</span>
        <span class="upload-panel__bar" aria-hidden="true">
          <span class="upload-panel__bar-fill" :style="{ width: percentOf(task) + '%' }" />
        </span>
        <span class="upload-panel__percent" data-testid="upload-percent">{{ percentOf(task) }}%</span>
        <span class="upload-panel__status" :data-status="task.status">{{ t(STATUS_KEY[task.status]) }}</span>
        <FcButton
          v-if="task.status === 'uploading'"
          variant="text"
          size="sm"
          data-testid="upload-cancel"
          @click="emit('cancel', task.id)"
        >
          {{ t('files.upload.cancel') }}
        </FcButton>
        <span v-else class="upload-panel__placeholder" />
      </li>
    </ul>
  </section>
</template>

<style lang="scss" scoped>
.upload-panel {
  padding: 4px 8px 8px;
  background: var(--app-section-bg);
  border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-section-radius);
  color: var(--app-text-primary);
}

.upload-panel__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid var(--app-section-border-color);
}

.upload-panel__title {
  font-size: 13px;
  font-weight: 600;
}

.upload-panel__title-icon {
  color: var(--app-text-tertiary);
}

.upload-panel__spacer {
  flex: 1;
}

.upload-panel__list {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.upload-panel__item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 96px 48px 64px 56px;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;

  &.is-failed .upload-panel__status,
  &.is-failed .upload-panel__icon {
    color: var(--app-color-danger, var(--el-color-danger, #f56c6c));
  }

  &.is-cancelled .upload-panel__status,
  &.is-cancelled .upload-panel__icon {
    color: var(--app-text-tertiary);
  }

  &.is-done .upload-panel__status {
    color: var(--app-color-success, var(--el-color-success, #67c23a));
  }
}

.upload-panel__icon {
  font-size: 15px;
  color: var(--app-text-tertiary);
}

.upload-panel__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.upload-panel__bar {
  height: 4px;
  background: var(--app-bg-muted, rgba(0, 0, 0, 0.06));
  border-radius: 999px;
  overflow: hidden;
}

.upload-panel__bar-fill {
  display: block;
  height: 100%;
  background: var(--el-color-primary, var(--brand-primary, #409eff));
  border-radius: 999px;
  transition: width 0.2s ease;
}

.upload-panel__percent {
  font-size: 12px;
  color: var(--app-text-secondary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.upload-panel__status {
  font-size: 12px;
  color: var(--app-text-secondary);
  text-align: center;
}

.upload-panel__placeholder {
  display: block;
}
</style>
