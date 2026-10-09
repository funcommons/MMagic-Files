<script setup lang="ts">
/**
 * UploadPanel — 传输任务中心（Lane G1：上传 + 下载统一视图；原 Lane F5 上传面板扩展）。
 * 上传行：名称/进度%/状态（上传中|已暂停|完成|失败|已取消）/操作（暂停|继续|重试|取消）；
 * 下载行：名称/进度%（已完成文件数/总数）/状态（下载中|完成|失败|已取消）/操作（重试|取消）。
 * 任务登记与队列交互在 Home 层收口（UploadQueue 本体不枚举任务、hooks 为构造期只读），
 * 本组件纯展示：props 进、事件出（便于 jsdom mount 直测）。
 * data-testid 契约保持：upload-panel / upload-item / upload-percent / upload-cancel /
 * upload-clear（wb-04 e2e 依赖）；下载侧行新增 download-* 前缀。
 * 无任务不渲染；i18n 用 transfer.*（预置词典）+ 既有 files.upload.*；风格对齐 Fc*。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton } from '@/components/sdk'

export interface UploadTaskView {
  id: string
  name: string
  loaded: number
  total: number
  status: 'uploading' | 'paused' | 'done' | 'failed' | 'cancelled'
}

export interface DownloadTaskView {
  id: string
  name: string
  /** 已触发浏览器保存的文件数（进度=done/total；字节级进度浏览器下载链路拿不到） */
  done: number
  total: number
  status: 'active' | 'done' | 'failed' | 'cancelled'
  error?: string
}

const props = defineProps<{ tasks: UploadTaskView[]; downloads?: DownloadTaskView[] }>()

const emit = defineEmits<{
  /** 上传：暂停/继续/重试/取消单条（Home 接 queue.pause/resume/retry/abort） */
  pause: [id: string]
  resume: [id: string]
  retry: [id: string]
  cancel: [id: string]
  /** 上传：清除已终态记录（上传中/已暂停保留） */
  clear: []
  /** 下载：取消/重试/清除终态（Home 接 DownloadQueue.cancel/retry/clearTerminal） */
  'download-cancel': [id: string]
  'download-retry': [id: string]
  'download-clear': []
}>()

const { t } = useI18n()

const UPLOAD_STATUS_KEY: Record<UploadTaskView['status'], string> = {
  uploading: 'files.upload.uploading',
  paused: 'transfer.paused',
  done: 'files.upload.done',
  failed: 'files.upload.failed',
  cancelled: 'files.upload.cancelled',
}

// 下载进行态无预置「下载中」词典键（禁止改 locales）：用 files.toolbar.download（'下载'）承载
const DOWNLOAD_STATUS_KEY: Record<DownloadTaskView['status'], string> = {
  active: 'files.toolbar.download',
  done: 'files.upload.done',
  failed: 'files.upload.failed',
  cancelled: 'files.upload.cancelled',
}

const isEmpty = computed(() => props.tasks.length === 0 && (props.downloads ?? []).length === 0)

function uploadPercentOf(task: UploadTaskView): number {
  if (task.total <= 0) return task.status === 'done' ? 100 : 0
  return Math.min(100, Math.round((task.loaded / task.total) * 100))
}

function downloadPercentOf(task: DownloadTaskView): number {
  if (task.total <= 0) return task.status === 'done' ? 100 : 0
  return Math.min(100, Math.round((task.done / task.total) * 100))
}
</script>

<template>
  <section v-if="!isEmpty" class="upload-panel" data-testid="upload-panel">
    <header class="upload-panel__head">
      <i class="ri-arrow-left-right-line upload-panel__title-icon" />
      <span class="upload-panel__title">{{ t('transfer.title') }}</span>
      <span class="upload-panel__hint">{{ t('transfer.paste-hint') }}</span>
      <span class="upload-panel__spacer" />
      <FcButton
        v-if="tasks.some((x) => x.status !== 'uploading' && x.status !== 'paused')"
        variant="text"
        size="sm"
        data-testid="upload-clear"
        @click="emit('clear')"
      >
        {{ t('files.upload.clear') }}
      </FcButton>
      <FcButton
        v-if="(downloads ?? []).some((x) => x.status !== 'active')"
        variant="text"
        size="sm"
        data-testid="download-clear"
        @click="emit('download-clear')"
      >
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
        <i class="ri-upload-2-line upload-panel__icon" />
        <span class="upload-panel__name" :title="task.name">{{ task.name }}</span>
        <span class="upload-panel__bar" aria-hidden="true">
          <span class="upload-panel__bar-fill" :style="{ width: uploadPercentOf(task) + '%' }" />
        </span>
        <span class="upload-panel__percent" data-testid="upload-percent">{{ uploadPercentOf(task) }}%</span>
        <span class="upload-panel__status" :data-status="task.status">{{ t(UPLOAD_STATUS_KEY[task.status]) }}</span>
        <span class="upload-panel__actions">
          <FcButton
            v-if="task.status === 'uploading' || task.status === 'paused'"
            variant="text"
            size="sm"
            data-testid="upload-pause"
            @click="emit('pause', task.id)"
          >
            {{ t('transfer.pause') }}
          </FcButton>
          <FcButton
            v-if="task.status === 'paused'"
            variant="text"
            size="sm"
            data-testid="upload-resume"
            @click="emit('resume', task.id)"
          >
            {{ t('transfer.resume') }}
          </FcButton>
          <FcButton
            v-if="task.status === 'failed'"
            variant="text"
            size="sm"
            data-testid="upload-retry"
            @click="emit('retry', task.id)"
          >
            {{ t('transfer.retry') }}
          </FcButton>
          <FcButton
            v-if="task.status === 'uploading' || task.status === 'paused'"
            variant="text"
            size="sm"
            data-testid="upload-cancel"
            @click="emit('cancel', task.id)"
          >
            {{ t('files.upload.cancel') }}
          </FcButton>
        </span>
      </li>
      <li
        v-for="dl in downloads ?? []"
        :key="dl.id"
        class="upload-panel__item"
        :class="`is-${dl.status}`"
        data-testid="download-item"
      >
        <i class="ri-download-2-line upload-panel__icon" />
        <span class="upload-panel__name" :title="dl.name">{{ dl.name }}</span>
        <span class="upload-panel__bar" aria-hidden="true">
          <span class="upload-panel__bar-fill" :style="{ width: downloadPercentOf(dl) + '%' }" />
        </span>
        <span class="upload-panel__percent" data-testid="download-percent">{{ downloadPercentOf(dl) }}%</span>
        <span class="upload-panel__status" :data-status="dl.status">{{ t(DOWNLOAD_STATUS_KEY[dl.status]) }}</span>
        <span class="upload-panel__actions">
          <FcButton
            v-if="dl.status === 'active'"
            variant="text"
            size="sm"
            data-testid="download-cancel"
            @click="emit('download-cancel', dl.id)"
          >
            {{ t('files.upload.cancel') }}
          </FcButton>
          <FcButton
            v-if="dl.status === 'failed' || dl.status === 'cancelled'"
            variant="text"
            size="sm"
            data-testid="download-retry"
            @click="emit('download-retry', dl.id)"
          >
            {{ t('transfer.retry') }}
          </FcButton>
        </span>
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

.upload-panel__hint {
  overflow: hidden;
  font-size: 11px;
  color: var(--app-text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
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
  grid-template-columns: 18px minmax(0, 1fr) 96px 48px 72px minmax(56px, max-content);
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

.upload-panel__actions {
  display: flex;
  gap: 2px;
  justify-content: flex-end;
}
</style>
