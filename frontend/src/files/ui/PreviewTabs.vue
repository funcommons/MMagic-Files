<script lang="ts">
/**
 * PreviewTabs — 预览 Tab 条（Lane H1：预览态/钉住/LRU，OpenVSCode 预览态模型的纯 UI 层）。
 * 单内容区 + tab 历史：内容区仍是 preview 单实例（不搞多渲染器并存——渲染器重，且 savedState
 * 已按 key 记忆，切回=preview.open 重跑+savedState 回注）。tab 仅是打开历史条目
 * { entry, pinned, appId }。状态（tabs 数组 + activeKey）由 Home 持有（ref），本组件纯受控：
 * props 进 / emits 出，纯状态函数导出供 Home 与单测共用（同一份语义正本）。
 * 语义口径：
 *  - 单击 tab=激活（Home → preview.open(entry, {appId?})，savedState 回注）
 *  - 双击 tab=钉住/取消钉（VS Code 预览态斜体 tab：钉住转正体+图钉）
 *  - 关闭钮=关该 tab（激活中的被关 → Home 清预览并激活相邻 tab，右邻优先）
 *  - 打开新文件：激活 tab 未钉住 → 原位替换（预览态）；已钉住 → 追加；LRU 上限 8
 */
import type { S3ObjectSummary } from '@/sdk/types'

/** LRU 上限（Lane H1 口径）：超限淘汰最旧未钉住；全钉住则淘汰最旧未激活者（容量守恒优先于钉住保护） */
export const PREVIEW_TAB_LIMIT = 8

export interface PreviewTab {
  entry: S3ObjectSummary
  pinned: boolean
  /** 最近一次打开该 tab 的应用（「打开方式」透传记忆；激活切回时复用） */
  appId?: string
}

export function findTab(tabs: PreviewTab[], key: string): PreviewTab | undefined {
  return tabs.find((t) => t.entry.key === key)
}

/**
 * LRU 超限淘汰（> LIMIT 时逐个移除直至归位）：
 *  - 优先最旧的未钉住 tab（排除当前激活与本次新开者——「最旧」语义上不含刚打开的 tab）；
 *  - 全钉住（或未钉住者均已排除）→ 淘汰最旧的未激活者（钉住保护内容，容量仍须守）；
 *  - 候选为空（理论不可达：仅剩激活/新开各一不会超限）→ 放弃，宁超不误删。
 */
export function evictOverflow(tabs: PreviewTab[], activeKey: string | null, protectKey: string): void {
  while (tabs.length > PREVIEW_TAB_LIMIT) {
    const act = activeKey === null ? -1 : tabs.findIndex((t) => t.entry.key === activeKey)
    const notCandidate = (t: PreviewTab, i: number): boolean => i !== act && t.entry.key !== protectKey
    let evictIdx = tabs.findIndex((t, i) => !t.pinned && notCandidate(t, i))
    if (evictIdx < 0) evictIdx = tabs.findIndex(notCandidate)
    if (evictIdx < 0) return
    tabs.splice(evictIdx, 1)
  }
}

/**
 * 打开链的 tab 归位（原位变更，配合 Home 的 reactive ref）：
 *  - 已存在同 key tab：保持位置与钉住状态（entry/appId 刷新），不触 LRU；
 *  - 新 key：激活 tab 未钉住 → 原位替换（VS Code 预览态行为，替换者恒未钉住）；
 *    已钉住/无激活 → 追加；随后按 LRU 超限淘汰。
 * activeKey 取「本次打开前」的激活 tab（Home 在 onOpened 回调中先归位 tab、后改 activeKey）。
 */
export function upsertTab(
  tabs: PreviewTab[],
  entry: S3ObjectSummary,
  activeKey: string | null,
  appId?: string,
): void {
  const existing = findTab(tabs, entry.key)
  if (existing) {
    existing.entry = entry
    if (appId !== undefined) existing.appId = appId
    return
  }
  const tab: PreviewTab = { entry, pinned: false, appId }
  const activeIdx = activeKey === null ? -1 : tabs.findIndex((t) => t.entry.key === activeKey)
  if (activeIdx >= 0 && !tabs[activeIdx]!.pinned) {
    tabs.splice(activeIdx, 1, tab) // 预览态：原位替换
  } else {
    tabs.push(tab)
  }
  evictOverflow(tabs, activeKey, entry.key)
}

/** 钉住/取消钉（双击；key 不存在=无操作） */
export function pinToggle(tabs: PreviewTab[], key: string): void {
  const tab = findTab(tabs, key)
  if (tab) tab.pinned = !tab.pinned
}

/** 关 tab 后的相邻激活选择：右邻优先，无右邻取左邻（VS Code 关闭后激活方向），唯一/缺 key=null */
export function pickNeighbor(tabs: PreviewTab[], key: string): PreviewTab | null {
  const idx = tabs.findIndex((t) => t.entry.key === key)
  if (idx < 0) return null
  return tabs[idx + 1] ?? (idx > 0 ? tabs[idx - 1]! : null)
}
</script>

<script setup lang="ts">
defineProps<{
  tabs: PreviewTab[]
  activeKey: string | null
}>()
const emit = defineEmits<{
  activate: [entry: S3ObjectSummary]
  close: [entry: S3ObjectSummary]
  'pin-toggle': [key: string]
}>()
</script>

<template>
  <div v-if="tabs.length > 0" class="ptabs" data-testid="preview-tabs" role="tablist">
    <div
      v-for="tab in tabs"
      :key="tab.entry.key"
      class="ptabs__tab"
      :class="{ 'is-active': tab.entry.key === activeKey, 'is-pinned': tab.pinned }"
      data-testid="preview-tab"
      :data-key="tab.entry.key"
      role="tab"
      :aria-selected="tab.entry.key === activeKey"
      :title="tab.entry.name"
      @click="emit('activate', tab.entry)"
      @dblclick="emit('pin-toggle', tab.entry.key)"
    >
      <i v-if="tab.pinned" class="ri-pushpin-fill ptabs__pin" data-testid="preview-tab-pin" />
      <span class="ptabs__name">{{ tab.entry.name }}</span>
      <button
        type="button"
        class="ptabs__close fc-button fc-button-icon fc-button-xs"
        data-testid="preview-tab-close"
        :aria-label="tab.entry.name"
        @click.stop="emit('close', tab.entry)"
      >
        <i class="ri-close-line" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* VS Code 式细 tab 条：激活态高亮、未钉住斜体、钉住图钉、hover 出关闭钮 */
.ptabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  margin: 0 0 8px;
  overflow-x: auto;
}

.ptabs__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 4px 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--app-text-secondary);
  cursor: pointer;
  user-select: none;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--app-radius-sm, 6px);

  &.is-active {
    color: var(--app-text-primary);
    background: var(--app-section-bg);
    border-color: var(--app-section-border-color);
  }

  &:hover:not(.is-active) {
    color: var(--app-text-primary);
    background: var(--app-section-bg);
  }

  /* 预览态（未钉住）斜体，钉住转正体 */
  &:not(.is-pinned) .ptabs__name {
    font-style: italic;
  }
}

.ptabs__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ptabs__pin {
  flex: none;
  font-size: 12px;
  line-height: 1;
  color: var(--el-color-primary, var(--app-text-primary));
}

/* 关闭钮（R2-09）：挂 SDK fc-button fc-button-icon fc-button-xs 类（与 TreePanel 同口径）。
   SDK 尺寸体系最小 24px，tab 内规格是 16px——全局 button.fc-button-icon.fc-button-xs
   特异性 (0,3,1)，这里用 .ptabs__tab 前缀 + 双类压到 (0,4,0) 钉死紧凑规格。 */
.ptabs__tab .ptabs__close.ptabs__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  font-size: 14px;
  font-weight: normal;
  line-height: 1;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  opacity: 0;

  &:hover {
    background: var(--el-fill-color, rgba(0, 0, 0, 0.08));
  }
}

/* 关闭钮：hover / 激活 tab 出现（VS Code 口径）；特异性须压过上块 opacity:0 (0,4,0) */
.ptabs__tab:hover .ptabs__close.ptabs__close,
.ptabs__tab.is-active .ptabs__close.ptabs__close {
  opacity: 1;
}
</style>
