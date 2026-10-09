<script setup lang="ts">
/**
 * Toolbar — 工作台操作条（Wave2-T2；Lane F5 多选语义改版）。
 * 上传：隐藏 input[type=file][multiple] → ops.ingestFiles（enqueue + 拒收汇总 FcToast）；
 * 新建目录/重命名/删除：操作链在 workspace-ops 收口（与 TreePanel 右键菜单共用，零复制）。
 * F1 门控：features.*=false 的操作入口整链禁用（UI 隐藏层，契约《用户手册》§一）；
 * 未传 features 或缺省键=默认放开（对齐 resolveFeatures 的「default 全开、false 优先」）。
 * Lane F3：下载按钮——features.download 门控。
 * Lane F5 多选：selected 为数组——删除按全集（>1 用多选确认文案）、重命名按首项、
 * 下载单文件直下/多文件（均非目录）批量打包语义（emit download 数组，zip 在 Home 收口）。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton } from '@/components/sdk'
import type { S3ObjectSummary } from '@/sdk/types'
import type { EnqueueResult } from '../upload-queue'
import type { FileTreeController } from '../tree-store'
import { createWorkspaceOps } from './workspace-ops'

const props = defineProps<{
  controller: FileTreeController
  /** 上传入队（UploadQueue 结构子集；Home 传带任务登记的包装） */
  queue: { enqueue: (files: File[], prefix?: string) => EnqueueResult }
  /** 当前选中集（Lane F5 多选数组；空=删除/重命名/下载禁用） */
  selected?: S3ObjectSummary[]
  /** features 门控（resolveFeatures 结果；显式 false 隐藏对应操作入口） */
  features?: Record<string, boolean>
}>()

/** 操作入口可见性：仅显式 false 关闭（缺省=未配置=放开），刷新不受门控 */
const enabled = computed(() => ({
  upload: props.features?.upload !== false,
  mkdir: props.features?.mkdir !== false,
  rename: props.features?.rename !== false,
  delete: props.features?.delete !== false,
  download: props.features?.download !== false, // Lane F3（手册 features 表：download ↔ cmd download）
}))

const selection = computed<S3ObjectSummary[]>(() => props.selected ?? [])
const firstSelected = computed<S3ObjectSummary | null>(() => selection.value[0] ?? null)
/** 下载可用：单文件、或多文件且均非目录（批量打包语义） */
const canDownload = computed(() => {
  const s = selection.value
  if (s.length === 0) return false
  return s.every((e) => !e.isDir)
})

/** 破坏性操作（删除/重命名）成功后发 changed(key)，父层据此维护选中集；Lane F5 增批量下载 */
const emit = defineEmits<{
  changed: [key: string]
  download: [entries: S3ObjectSummary[]]
}>()

const { t } = useI18n()
/** 操作链（mkdir/rename/remove/上传拒收）与右键菜单共用（workspace-ops 收口） */
const ops = createWorkspaceOps({ tree: props.controller, t })

const fileInput = ref<HTMLInputElement | null>(null)

function pickFiles(): void {
  fileInput.value?.click()
}

function onPicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  ops.ingestFiles((fs, prefix) => props.queue.enqueue(fs, prefix), files, props.controller.currentPath)
  input.value = '' // 清空以便同一文件可重复选择
}

function refresh(): void {
  void props.controller.loadDir(props.controller.currentPath, { force: true })
}

async function createDir(): Promise<void> {
  await ops.createDir()
}

async function renameSelected(): Promise<void> {
  const entry = firstSelected.value
  if (!entry) return
  const r = await ops.renameEntry(entry)
  if (r) emit('changed', r.from)
}

async function removeSelected(): Promise<void> {
  const keys = await ops.removeEntries(selection.value)
  if (keys) for (const k of keys) emit('changed', k)
}

/** 下载选中：单文件直下 / 多文件（均非目录）批量打包；执行链在 Home（get→blob/zip→triggerDownload） */
function downloadSelected(): void {
  if (!canDownload.value) return
  emit('download', selection.value.filter((e) => !e.isDir))
}
</script>

<template>
  <div class="ws-toolbar">
    <input
      ref="fileInput"
      class="ws-toolbar__file"
      type="file"
      multiple
      data-testid="upload-input"
      @change="onPicked"
    />
    <FcButton v-if="enabled.upload" variant="primary" size="sm" @click="pickFiles">
      {{ t('files.toolbar.upload') }}
    </FcButton>
    <FcButton v-if="enabled.mkdir" variant="secondary" size="sm" @click="createDir">
      {{ t('files.toolbar.mkdir') }}
    </FcButton>
    <FcButton variant="secondary" size="sm" :loading="controller.loading" @click="refresh">
      {{ t('files.toolbar.refresh') }}
    </FcButton>
    <span class="ws-toolbar__spacer" />
    <FcButton
      v-if="enabled.download"
      variant="secondary"
      size="sm"
      :disabled="!canDownload"
      @click="downloadSelected"
    >
      {{ t('files.toolbar.download') }}
    </FcButton>
    <FcButton
      v-if="enabled.rename"
      variant="secondary"
      size="sm"
      :disabled="!firstSelected"
      @click="renameSelected"
    >
      {{ t('files.toolbar.rename') }}
    </FcButton>
    <FcButton
      v-if="enabled.delete"
      variant="danger"
      size="sm"
      :disabled="selection.length === 0"
      @click="removeSelected"
    >
      {{ t('files.toolbar.delete') }}
    </FcButton>
  </div>
</template>

<style lang="scss" scoped>
.ws-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--app-section-border-color);
}

.ws-toolbar__file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.ws-toolbar__spacer {
  flex: 1;
}
</style>
