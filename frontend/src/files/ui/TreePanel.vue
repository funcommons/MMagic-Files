<script lang="ts">
/**
 * Lane H3 分页口径（决策注释）：客户端切片分页——tree-store 的 loadDir 已按
 * continuationToken 全量聚合写入缓存（与 e2e ws-03 聚合口径兼容），分页只是对缓存
 * entries（dirs 前 files 后、保持既有顺序）的切片展示，翻页不重复发 S3 请求。
 */
/** 每页条数（导出可测）：entries 超过该值时列表底部出分页条 */
export const TREE_PAGE_SIZE = 100

/** Lane H-2 type-ahead 同键接续窗口（ms）：窗口内重复同键=跳到下一个匹配（Quantum 循环口径） */
export const TYPE_AHEAD_WINDOW_MS = 500
</script>

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
 *  - 面包屑点击回跳；未加载/加载中 FcSkeleton、空态 FcEmpty、失败态 FcEmpty(error)+重试；
 *  - Lane H3：entries>TREE_PAGE_SIZE 时底部出分页条（« ‹ n / total › » + 跳页输入）；
 *  - Lane H-2 键盘流（全部收口本组件，判定纯工具在 shortcuts.ts）：Alt+↑=父目录、
 *    Alt+↓=进首个选中目录、Esc=清空选中、字母/数字 type-ahead 循环跳转（500ms 同键接续）、
 *    双击列表空白区=全选当前页。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton, FcContextMenu, FcEmpty, FcSkeleton } from '@/components/sdk'
import type { MenuItem } from '@/components/sdk/overlay/FcContextMenu.vue'
import type { AppRegistry } from '@/apps/registry'
import { normalizePrefix } from '../tree-store'
import type { FileTreeController } from '../tree-store'
import { formatBytes } from '../format'
import type { S3ObjectSummary } from '@/sdk/types'
import { isTypingTarget, matchesHotkey } from './shortcuts'

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
  /** 菜单动作（重命名/删除/下载/分享/新建目录）；操作链在 Home 层收口 */
  'menu-action': [payload: { action: 'rename' | 'delete' | 'download' | 'share' | 'mkdir'; entry: S3ObjectSummary }]
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

// ── 客户端切片分页（Lane H3，口径见文件头 script 注释）──

const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(entries.value.length / TREE_PAGE_SIZE)))
/** 当前页可见序列：dirs+files 拼接序列的切片（与既有列表视觉顺序一致，目录与文件可同页共存） */
const pagedEntries = computed(() =>
  entries.value.slice((page.value - 1) * TREE_PAGE_SIZE, page.value * TREE_PAGE_SIZE),
)

/**
 * 页码复位：目录深入/面包屑回跳/刷新（loadDir 重写 bucket）、文件变更（applyChange
 * 原地增删条目）、props(controller) 更新——都会重建 entries 序列，统一复位到第 1 页
 * （防越界页）；entries 变短时复位结果恒为合法页。
 */
watch(entries, () => {
  page.value = 1
})
/** 防御：entries 变短致 totalPages 收缩时钳回合法页，绝不渲染空页 */
watch(totalPages, (n) => {
  if (page.value > n) page.value = n
})

/** 跳页：越界值钳到 [1, totalPages] */
function goTo(n: number): void {
  page.value = Math.min(Math.max(n, 1), totalPages.value)
}

/** 跳页输入草稿（type=number 时 vue v-model 可能给 number，故 string|number 双收） */
const jumpDraft = ref<string | number>('')

/** 回车确认跳页；非法值（空/非整数/<1）静默复位草稿、留在当前页 */
function onJumpConfirm(): void {
  const raw = String(jumpDraft.value).trim()
  jumpDraft.value = ''
  const n = Number(raw)
  if (raw === '' || !Number.isInteger(n) || n < 1) return
  goTo(n)
}

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

/** 文件大小展示统一走 formatBytes（R2-05：与预览闸/渲染器提示同源口径，删本地重复实现） */
const formatSize = formatBytes

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
  const list = pagedEntries.value // 锚点/范围选择按当前页可见序列（v-for 下标口径一致）
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
function openFirstSelected(e: KeyboardEvent): void {
  const first = (props.selected ?? [])[0]
  if (!first) return
  e.preventDefault()
  if (first.isDir) enter(first.key)
  else emit('open', first)
}

// ── 键盘流（Lane H-2：全部收口在本组件；组合键/焦点判定纯工具在 shortcuts.ts） ──

const listEl = ref<HTMLUListElement | null>(null)

/** Alt+↑：回父目录（到根即止——currentPath 已是根域则无效） */
function goParentDir(): void {
  const root = normalizePrefix(props.rootPrefix ?? '')
  const cur = normalizePrefix(props.controller.currentPath)
  if (cur === root || cur === '') return
  const trimmed = cur.slice(0, -1) // 去尾 '/'（normalizePrefix 保证带尾 '/'；根域已被上守卫拦住）
  enter(trimmed.slice(0, trimmed.lastIndexOf('/') + 1))
}

/** Alt+↓：进入首个选中的目录（无目录选中=无效） */
function enterFirstSelectedDir(): void {
  const firstDir = (props.selected ?? []).find((s) => s.isDir)
  if (!firstDir) return
  enter(firstDir.key)
}

/** type-ahead 状态：上次命中字符/时刻/下标（500ms 同键接续窗口，见 TYPE_AHEAD_WINDOW_MS） */
let typeAheadChar = ''
let typeAheadAt = 0
let typeAheadIdx = -1

/** 从 start（含）循环向后找首个 name 以 ch 开头（大小写不敏感）的条目下标；无命中=-1 */
function findTypeAhead(start: number, ch: string): number {
  const list = pagedEntries.value
  for (let i = 0; i < list.length; i++) {
    const idx = (((start + i) % list.length) + list.length) % list.length
    if (list[idx]!.name.toLowerCase().startsWith(ch)) return idx
  }
  return -1
}

/** 字母/数字 type-ahead：锚点起循环跳转并选中 + 滚动到可见（jsdom 缺 scrollIntoView 走可选调用） */
function handleTypeAhead(e: KeyboardEvent): void {
  const list = pagedEntries.value
  if (list.length === 0) return
  const ch = e.key.toLowerCase()
  const now = Date.now()
  const chained = ch === typeAheadChar && now - typeAheadAt <= TYPE_AHEAD_WINDOW_MS && typeAheadIdx >= 0
  const start = chained ? typeAheadIdx + 1 : Math.max(anchorIndex, 0)
  const hit = findTypeAhead(start, ch)
  if (hit < 0) {
    typeAheadChar = '' // 无匹配：断链（下次重按从锚点起算），不 emit
    return
  }
  typeAheadChar = ch
  typeAheadAt = now
  typeAheadIdx = hit
  anchorIndex = hit // 命中行成为新锚点（shift 范围选择与下一次 type-ahead 同源）
  emit('select', [list[hit]!])
  const rowEl = listEl.value?.children[hit] as HTMLElement | undefined
  rowEl?.scrollIntoView?.({ block: 'nearest' })
}

/** Esc：清空选中 + 关右键菜单（窗口级 Esc 关菜单另有既有监听，此处补列表焦点语义） */
function clearSelection(): void {
  menu.value = null
  emit('select', [])
}

/** 双击列表空白区（非行，.self 口径）：全选当前页条目 */
function onListDblClickSelf(): void {
  if (pagedEntries.value.length === 0) return
  emit('select', [...pagedEntries.value])
}

/**
 * 列表键盘（Lane H-2 扩展；isTypingTarget 守卫=输入焦点一律让路；已处理键均 preventDefault）：
 *  - Enter=打开首个选中（既有口径）；
 *  - Alt+↑=父目录、Alt+↓=进首个选中目录；
 *  - Esc=清空选中+关菜单；
 *  - 字母/数字（无 ctrl/meta/alt 修饰，shift 允许）=type-ahead 循环跳转。
 */
function onListKeydown(e: KeyboardEvent): void {
  if (isTypingTarget(e)) return
  if (e.key === 'Enter') {
    openFirstSelected(e)
    return
  }
  if (matchesHotkey(e, { key: 'ArrowUp', alt: true })) {
    e.preventDefault()
    goParentDir()
    return
  }
  if (matchesHotkey(e, { key: 'ArrowDown', alt: true })) {
    e.preventDefault()
    enterFirstSelectedDir()
    return
  }
  if (matchesHotkey(e, { key: 'Escape' })) {
    e.preventDefault()
    clearSelection()
    return
  }
  if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    handleTypeAhead(e)
  }
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
  // Lane H-2：分享（仅文件；目录→前缀分享列 P2，简化口径不出口）
  if (!m.entry.isDir) items.push({ value: 'share', label: t('files.menu.share'), icon: 'ri-share-line' })
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
  if (value === 'rename' || value === 'delete' || value === 'download' || value === 'share' || value === 'mkdir') {
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
      ref="listEl"
      class="tree-panel__list"
      tabindex="0"
      data-testid="tree-list"
      @keydown="onListKeydown"
      @dblclick.self="onListDblClickSelf"
    >
      <li
        v-for="(e, i) in pagedEntries"
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

    <!-- 分页条（Lane H3）：单页不渲染；页码纯数字+斜杠（不依赖词典）；aria-label 用纯符号；
         按钮复用 SDK 原生 button 外观类（fc-button-icon/xs=24px 方形图标钮） -->
    <nav v-if="totalPages > 1" class="tree-panel__pager" data-testid="tree-pager">
      <button
        type="button"
        class="fc-button fc-button-icon fc-button-xs tree-panel__pager-btn"
        data-testid="tree-pager-first"
        :disabled="page <= 1"
        aria-label="«"
        @click="goTo(1)"
      >
        <i class="ri-arrow-left-double-line" />
      </button>
      <button
        type="button"
        class="fc-button fc-button-icon fc-button-xs tree-panel__pager-btn"
        data-testid="tree-pager-prev"
        :disabled="page <= 1"
        aria-label="‹"
        @click="goTo(page - 1)"
      >
        <i class="ri-arrow-left-line" />
      </button>
      <span class="tree-panel__pager-page" data-testid="tree-pager-page">{{ page }} / {{ totalPages }}</span>
      <button
        type="button"
        class="fc-button fc-button-icon fc-button-xs tree-panel__pager-btn"
        data-testid="tree-pager-next"
        :disabled="page >= totalPages"
        aria-label="›"
        @click="goTo(page + 1)"
      >
        <i class="ri-arrow-right-line" />
      </button>
      <button
        type="button"
        class="fc-button fc-button-icon fc-button-xs tree-panel__pager-btn"
        data-testid="tree-pager-last"
        :disabled="page >= totalPages"
        aria-label="»"
        @click="goTo(totalPages)"
      >
        <i class="ri-arrow-right-double-line" />
      </button>
      <input
        v-model="jumpDraft"
        type="number"
        class="tree-panel__pager-jump"
        data-testid="tree-pager-jump"
        :min="1"
        :max="totalPages"
        @keydown.enter.prevent="onJumpConfirm"
      >
    </nav>

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

.tree-panel__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 8px;
  border-top: 1px solid var(--app-section-border-color);
}

/* 尺寸/禁用态由全局 fc-button fc-button-icon fc-button-xs 承接（24px 方形图标钮），此处只补 hover 色 */
.tree-panel__pager-btn {
  &:hover:not(:disabled) {
    color: var(--el-color-primary);
  }
}

.tree-panel__pager-page {
  min-width: 48px;
  font-size: 12px;
  color: var(--app-text-tertiary);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.tree-panel__pager-jump {
  width: 56px;
  height: 24px;
  padding: 0 4px;
  margin-left: 4px;
  border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-radius-sm, 6px);
  background: none;
  color: inherit;
  font-size: 12px;
  text-align: center;

  &:focus {
    outline: none;
    border-color: var(--el-color-primary);
  }

  /* 隐藏 number input 的浏览器步进钮（口径：跳页输入框无多余控件） */
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }

  appearance: textfield;
  -moz-appearance: textfield;
}
</style>
