<script setup lang="ts">
/**
 * TreePanel — 当前目录列表 + 面包屑（Wave2-T2；Lane F5 交互面改版）。
 * UI 直连 store：props.controller 为 FileTreeController（不依赖 setup 单例，便于测试）。
 * 交互模型（对齐手册「双击/回车打开」）：
 *  - 单击=仅选中（ctrl/cmd=切换、shift=自锚点范围）→ emit('select', entries[])（多选语义，父层持有）；
 *  - 双击文件/回车=emit('open', entry)（Home 接预览）；目录双击=进入（loadDir）；
 *  - 行右键=上下文菜单（features.openWithMenu!==false 门控；Esc/外点关闭）：
 *    打开 / 打开方式（listMatches>1 时列应用名）→ emit('open-with') / 重命名/删除/下载/新建目录
 *    → emit('menu-action')（操作链在 Home 层经 workspace-ops 收口）；
 *  - 容器拖拽文件=上传 → emit('drop-files', {files, path})（enqueue+拒收 toast 在 Home 收口）；
 *  - 面包屑点击回跳；未加载/加载中 FcSkeleton、空态 FcEmpty、失败态 FcEmpty(error)+重试。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton, FcContextMenu, FcEmpty, FcSkeleton } from '@/components/sdk'
import type { MenuItem } from '@/components/sdk/overlay/FcContextMenu.vue'
import type { AppRegistry } from '@/apps/registry'
import { normalizePrefix } from '../tree-store'
import type { FileTreeController } from '../tree-store'
import type { S3ObjectSummary } from '@/sdk/types'

const props = defineProps<{
  controller: FileTreeController
  /** 树根域（面包屑从此截断显示；默认 bucket 根） */
  rootPrefix?: string
  /** 当前选中集（多选数组；父层持有并回传高亮） */
  selected?: S3ObjectSummary[]
  /** features 门控（openWithMenu/rename/delete/download/mkdir；仅显式 false 关） */
  features?: Record<string, boolean>
  /** 应用注册表（「打开方式」列全部命中应用；缺省=不出应用子列） */
  registry?: AppRegistry | null
}>()

const emit = defineEmits<{
  /** 选中集变化（单击/ctrl/shift 多选） */
  select: [entries: S3ObjectSummary[]]
  /** 打开（双击文件/回车/菜单「打开」）；Home 接 preview.open */
  open: [entry: S3ObjectSummary]
  /** 「打开方式」指定应用；Home 接 preview.open(entry, { appId }) */
  'open-with': [payload: { entry: S3ObjectSummary; appId: string }]
  /** 菜单动作（重命名/删除/下载/新建目录）；操作链在 Home 层收口 */
  'menu-action': [payload: { action: 'rename' | 'delete' | 'download' | 'mkdir'; entry: S3ObjectSummary }]
  /** 拖拽落文件（Home 接 queue.enqueue + 拒收 toast） */
  'drop-files': [payload: { files: File[]; path: string }]
}>()

const { t, te } = useI18n()

const bucket = computed(() => props.controller.nodes.get(normalizePrefix(props.controller.currentPath)))
const entries = computed<S3ObjectSummary[]>(() => {
  const b = bucket.value
  return b ? [...b.dirs, ...b.files] : []
})
const notLoaded = computed(() => !bucket.value?.loaded)

/** 选中键集（高亮判定） */
const selectedKeys = computed(() => new Set((props.selected ?? []).map((s) => s.key)))

interface Crumb {
  prefix: string
  name: string
}

const crumbs = computed<Crumb[]>(() => {
  const root = normalizePrefix(props.rootPrefix ?? '')
  const cur = props.controller.currentPath
  const rel = cur.startsWith(root) ? cur.slice(root.length) : cur
  const list: Crumb[] = [{ prefix: root, name: root === '' ? t('files.tree.root') : lastSeg(root) }]
  let acc = root
  for (const seg of rel.split('/')) {
    if (seg === '') continue
    acc += `${seg}/`
    list.push({ prefix: acc, name: seg })
  }
  return list
})

function lastSeg(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB']
function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  let v = size
  let i = -1
  do {
    v /= 1024
    i += 1
  } while (v >= 1024 && i < SIZE_UNITS.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${SIZE_UNITS[i] ?? 'KB'}`
}

function typeOf(e: S3ObjectSummary): string {
  if (e.isDir) return t('files.tree.type-dir')
  const dot = e.name.lastIndexOf('.')
  return dot > 0 ? e.name.slice(dot + 1).toUpperCase() : t('files.tree.type-file')
}

function enter(prefix: string): void {
  void props.controller.loadDir(prefix)
}

function retry(): void {
  void props.controller.loadDir(props.controller.currentPath, { force: true })
}

// ── 多选与打开（Lane F5 交互模型） ──

/** 范围选择锚点（最近一次非 shift 点击的行下标） */
let anchorIndex = -1

function onRowClick(e: MouseEvent, entry: S3ObjectSummary, index: number): void {
  const list = entries.value
  if (e.shiftKey && anchorIndex >= 0) {
    const [a, b] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex]
    emit('select', list.slice(a, b + 1))
    return
  }
  if (e.ctrlKey || e.metaKey) {
    const current = props.selected ?? []
    const next = current.some((s) => s.key === entry.key)
      ? current.filter((s) => s.key !== entry.key)
      : [...current, entry]
    anchorIndex = index
    emit('select', next)
    return
  }
  anchorIndex = index
  emit('select', [entry])
}

/** 双击：文件=打开预览；目录=进入 */
function onRowDblClick(entry: S3ObjectSummary): void {
  if (entry.isDir) enter(entry.key)
  else emit('open', entry)
}

/** 回车：打开首个选中文件；目录=进入 */
function onListKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter') return
  const first = (props.selected ?? [])[0]
  if (!first) return
  e.preventDefault()
  if (first.isDir) enter(first.key)
  else emit('open', first)
}

// ── 右键菜单 ──

const menu = ref<{ entry: S3ObjectSummary; x: number; y: number } | null>(null)

function onRowContextMenu(e: MouseEvent, entry: S3ObjectSummary): void {
  if (props.features?.openWithMenu === false) return // 门控关闭：不拦截，交还浏览器默认菜单
  // macOS Chromium 把 ctrl+click 合成为 contextmenu——该组合属多选切换语义（见 onRowClick），不开菜单
  if (e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  menu.value = { entry, x: e.clientX, y: e.clientY }
}

const menuItems = computed<MenuItem[]>(() => {
  const m = menu.value
  if (!m) return []
  const f = props.features ?? {}
  const items: MenuItem[] = [
    { value: 'open', label: t('files.menu.open'), icon: m.entry.isDir ? 'ri-folder-open-line' : 'ri-eye-line' },
  ]
  if (!m.entry.isDir) {
    const matches = props.registry?.listMatches({ name: m.entry.name, mime: m.entry.mime, size: m.entry.size }) ?? []
    if (matches.length > 1) {
      items.push({ value: '__open-with__', label: t('files.menu.open-with'), disabled: true })
      for (const def of matches) {
        // 显示名优先级（复审②修正版）：label 若是宿主词典键（内置应用 label=词典 key 约定）→ 翻译；
        // 否则视为插件自带显示名原样用（无宿主词典键时不再回显 key 原文）；无 label 回退 t('app.<id>')
        const shown = def.label ? (te(def.label) ? t(def.label) : def.label) : t(`app.${def.id}`)
        items.push({ value: `open-with:${def.id}`, label: shown, icon: 'ri-apps-2-line' })
      }
    }
  }
  if (f.rename !== false) items.push({ value: 'rename', label: t('files.menu.rename'), icon: 'ri-edit-line' })
  if (f.delete !== false) {
    items.push({ value: 'delete', label: t('files.menu.delete'), icon: 'ri-delete-bin-line', danger: true })
  }
  if (!m.entry.isDir && f.download !== false) {
    items.push({ value: 'download', label: t('files.menu.download'), icon: 'ri-download-2-line' })
  }
  if (f.mkdir !== false) items.push({ value: 'mkdir', label: t('files.menu.mkdir'), icon: 'ri-folder-add-line' })
  return items
})

function onMenuSelect(value: string): void {
  const m = menu.value
  menu.value = null
  if (!m) return
  if (value === 'open') {
    if (m.entry.isDir) enter(m.entry.key)
    else emit('open', m.entry)
    return
  }
  if (value.startsWith('open-with:')) {
    emit('open-with', { entry: m.entry, appId: value.slice('open-with:'.length) })
    return
  }
  if (value === 'rename' || value === 'delete' || value === 'download' || value === 'mkdir') {
    emit('menu-action', { action: value, entry: m.entry })
  }
}

function onWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') menu.value = null
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

// ── 拖拽上传 ──

const dragDepth = ref(0)
const dragOver = computed(() => dragDepth.value > 0)

function onDrop(e: DragEvent): void {
  dragDepth.value = 0
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0) return
  emit('drop-files', { files, path: props.controller.currentPath })
}

onMounted(() => {
  void props.controller.loadDir(props.controller.currentPath)
})
</script>

<template>
  <div
    class="tree-panel"
    :class="{ 'is-dragover': dragOver }"
    @dragenter.prevent="dragDepth++"
    @dragover.prevent
    @dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)"
    @drop.prevent="onDrop"
  >
    <nav class="tree-panel__crumbs">
      <template v-for="(c, i) in crumbs" :key="c.prefix">
        <span v-if="i > 0" class="tree-panel__crumb-sep">/</span>
        <FcButton
          v-if="i < crumbs.length - 1"
          variant="text"
          size="sm"
          class="tree-panel__crumb"
          data-testid="crumb"
          @click="enter(c.prefix)"
        >
          {{ c.name }}
        </FcButton>
        <span v-else class="tree-panel__crumb is-current">{{ c.name }}</span>
      </template>
    </nav>

    <FcSkeleton
      v-if="entries.length === 0 && notLoaded && !controller.error"
      class="tree-panel__state"
      variant="text"
      :rows="6"
    />
    <FcEmpty
      v-else-if="entries.length === 0 && notLoaded && controller.error"
      class="tree-panel__state"
      type="error"
      :title="t('files.tree.load-failed')"
      :description="controller.error.message"
    >
      <template #action>
        <FcButton variant="secondary" size="sm" @click="retry">{{ t('files.tree.retry') }}</FcButton>
      </template>
    </FcEmpty>
    <FcEmpty
      v-else-if="entries.length === 0"
      class="tree-panel__state"
      type="empty"
      :title="t('files.tree.empty')"
    />
    <ul
      v-else
      class="tree-panel__list"
      tabindex="0"
      data-testid="tree-list"
      @keydown="onListKeydown"
    >
      <li
        v-for="(e, i) in entries"
        :key="e.key"
        class="tree-panel__row"
        :class="{ 'is-dir': e.isDir, 'is-selected': selectedKeys.has(e.key) }"
        data-testid="row"
        @click="onRowClick($event, e, i)"
        @dblclick="onRowDblClick(e)"
        @contextmenu="onRowContextMenu($event, e)"
      >
        <i class="tree-panel__icon" :class="e.isDir ? 'ri-folder-line' : 'ri-file-line'" />
        <button
          v-if="e.isDir"
          type="button"
          class="fc-button tree-panel__name"
          data-testid="dir-name"
          @click.stop="enter(e.key)"
        >
          {{ e.name }}
        </button>
        <span v-else class="tree-panel__name">{{ e.name }}</span>
        <span class="tree-panel__size">{{ formatSize(e.size) }}</span>
        <span class="tree-panel__type">{{ typeOf(e) }}</span>
      </li>
    </ul>

    <FcContextMenu
      :visible="menu !== null"
      :pos="menu ? { x: menu.x, y: menu.y } : { x: 0, y: 0 }"
      :items="menuItems"
      @select="onMenuSelect"
      @close="menu = null"
    />
  </div>
</template>

<style lang="scss" scoped>
.tree-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  color: var(--app-text-primary);

  &.is-dragover {
    outline: 2px dashed var(--el-color-primary, var(--brand-primary, #409eff));
    outline-offset: -4px;
    background: var(--brand-primary-soft, var(--el-color-primary-light-9));
  }
}

.tree-panel__crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--app-section-border-color);
  font-size: 13px;
}

.tree-panel__crumb.is-current {
  font-weight: 600;
  color: var(--app-text-primary);
}

.tree-panel__crumb-sep {
  color: var(--app-text-tertiary);
}

.tree-panel__state {
  padding: 24px 0;
}

.tree-panel__list {
  flex: 1;
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow: auto;

  &:focus {
    outline: none;
  }
}

.tree-panel__row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 72px 64px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--app-radius-md, 8px);
  font-size: 13px;
  cursor: pointer;

  &:hover {
    background: var(--brand-bg-hover, var(--app-bg-muted, rgba(0, 0, 0, 0.04)));
  }

  &.is-selected {
    background: var(--brand-primary-soft, var(--el-color-primary-light-9));
  }
}

.tree-panel__icon {
  font-size: 16px;
  color: var(--app-text-tertiary);

  .is-dir & {
    color: var(--el-color-warning);
  }
}

.tree-panel__name {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
    color: var(--el-color-primary);
  }
}

.tree-panel__size,
.tree-panel__type {
  font-size: 12px;
  color: var(--app-text-tertiary);
  text-align: right;
}
</style>
