<script setup lang="ts">
defineOptions({ name: 'FcCommandPalette' })
/**
 * FcCommandPalette — 命令面板 (#8 命令面板 + #9 快捷键 + #15 撤销 / P1 Lane H5 升级).
 *
 * 用法 (在 App.vue 全局挂一次):
 *   <FcCommandPalette v-model:open="paletteOpen" :commands="orderedCommands" />
 *
 * - 自动 Cmd/Ctrl+K 唤起 (R2-01: useKeyboardShortcut('mod+k') 与面板同处挂载, 见 App.vue)
 * - 命令/文件双模式 (VS Code 惯例): 默认 = 文件模式 (结果来自
 *   registerFileSearchProvider 注入的 provider); 输入 '>' 前缀 = 仅命令模式
 * - 模糊搜索 (label / keywords / group); 最近使用置顶由调用方 orderedCommands 保证
 * - 分组渲染: 保留字 group 'command'/'file' 不渲染标题; 其它字符串照旧渲染
 * - 选中回车 / 点击 → executeCommand (联动最近使用), 默认关闭 (.keepOpen 阻止)
 * - Esc 关闭
 * - 焦点陷阱 + 滚轮滚动
 *
 * 命令注册: 业务侧通过 useCommandPalette() / registerCommandsProvider().
 */

import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocusTrap, executeCommand, parsePaletteQuery, resolveFileResults } from '@/composables'

export interface CommandItem {
  id: string
  /** 主标题 (labelKey 存在时可省略, 由 i18n 渲染) */
  label?: string
  /** 副标题 / 说明 (文件模式 = 路径) */
  description?: string
  /** i18n key (覆盖 label) */
  labelKey?: string
  /** 搜索时多匹配的关键词 (如 'undo 撤销 回退') */
  keywords?: string[]
  /**
   * 分组. 保留字: 'command' (命令, 缺省) / 'file' (文件搜索结果) — 不渲染分组标题;
   * 其它字符串照旧渲染为分组标题 (向后兼容).
   */
  group?: string
  /** icon class (ri-xxx) */
  icon?: string
  /** 快捷键提示列, 右对齐灰字 (如 '⌘K' / 'Ctrl+K'); keys 优先于 shortcut */
  keys?: string
  /** 快捷键提示 (旧字段, 与 keys 等价; 保留向后兼容) */
  shortcut?: string
  /** 执行 */
  handler: () => unknown | Promise<unknown>
  /** handler 后是否保持面板打开 (默认 false = 关闭) */
  keepOpen?: boolean
}

interface Props {
  open: boolean
  commands: CommandItem[]
  placeholder?: string
  width?: number
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
  placeholder: '',
  width: 560,
})

const emit = defineEmits<{
  'update:open': [boolean]
}>()

const { t } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const query = ref('')
const activeIndex = ref(0)

const openRef = computed(() => props.open)

useFocusTrap(rootRef, openRef, {
  onEscape: () => emit('update:open', false),
})

watch(() => props.open, (v) => {
  if (v) {
    query.value = ''
    activeIndex.value = 0
    nextTick(() => {
      const input = rootRef.value?.querySelector<HTMLInputElement>('input.fc-cp__input')
      input?.focus()
    })
  }
})

// ───────────────────────── 命令/文件双模式 ─────────────────────────

const parsed = computed(() => parsePaletteQuery(query.value))

const fileResults = ref<CommandItem[]>([])
let fileQuerySeq = 0

// 文件模式 (有词) → provider 异步取结果; 竞态用序号兜底, 只采纳最后一次
watch(
  () => ({ open: props.open, mode: parsed.value.mode, text: parsed.value.text }),
  async (s) => {
    if (!s.open || s.mode !== 'file' || !s.text) {
      fileResults.value = []
      return
    }
    const seq = ++fileQuerySeq
    const items = await resolveFileResults(s.text)
    if (seq === fileQuerySeq) fileResults.value = items
  },
  { immediate: true },
)

function matchCommands(text: string): CommandItem[] {
  const q = text.trim().toLowerCase()
  if (!q) return props.commands
  return props.commands.filter(c => {
    const haystack = [
      c.label ?? '',
      c.labelKey ? t(c.labelKey) : '',
      c.description ?? '',
      c.group ?? '',
      ...(c.keywords ?? []),
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

/** 展示结果: 命令模式=仅命令; 文件模式=provider 命中→文件, 未命中→回退命令匹配 */
const results = computed<CommandItem[]>(() => {
  if (parsed.value.mode === 'command') return matchCommands(parsed.value.text)
  if (!parsed.value.text) return props.commands
  const files = fileResults.value
  return files.length > 0 ? files : matchCommands(parsed.value.text)
})

watch(results, () => {
  activeIndex.value = 0
})

interface PaletteSection { key: string; title: string; items: CommandItem[] }

/** 保留字 group ('command'/'file') 不渲染标题; 传统字符串 group 照旧 (向后兼容) */
const sections = computed<PaletteSection[]>(() => {
  const out: PaletteSection[] = []
  const byKey = new Map<string, PaletteSection>()
  for (const c of results.value) {
    const g = c.group ?? 'command'
    const reserved = g === 'command' || g === 'file'
    const key = reserved ? `mode:${g}` : `group:${g}`
    let section = byKey.get(key)
    if (!section) {
      section = { key, title: reserved ? '' : g, items: [] }
      byKey.set(key, section)
      out.push(section)
    }
    section.items.push(c)
  }
  return out
})

/** placeholder 按模式区分 (复用既有 i18n 键; 显式 placeholder prop 优先) */
const placeholderText = computed(() => {
  if (props.placeholder) return props.placeholder
  return parsed.value.mode === 'command'
    ? `${t('ux.shortcut.palette')}  ⌘`
    : `${t('ux.shortcut.search')}…  ( > ${t('ux.shortcut.palette')} )`
})

function labelOf(c: CommandItem): string {
  return c.labelKey ? t(c.labelKey) : c.label ?? ''
}

async function pick(c: CommandItem) {
  await executeCommand(c)
  if (!c.keepOpen) emit('update:open', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(results.value.length - 1, activeIndex.value + 1)
    scrollIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(0, activeIndex.value - 1)
    scrollIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const c = results.value[activeIndex.value]
    if (c) pick(c)
  }
}

function scrollIntoView() {
  nextTick(() => {
    const items = rootRef.value?.querySelectorAll<HTMLElement>('.fc-cp__item')
    // 可选调用: jsdom 等环境无 scrollIntoView, 不能因滚动失败炸掉键盘导航
    items?.[activeIndex.value]?.scrollIntoView?.({ block: 'nearest' })
  })
}

function setOpen(v: boolean) {
  emit('update:open', v)
}
</script>

<template>
  <transition name="fc-cp">
    <div v-if="open" class="fc-cp-overlay" @click.self="setOpen(false)">
      <div
        ref="rootRef"
        class="fc-cp"
        role="dialog"
        aria-label="Command palette"
        :style="{ width: width + 'px' }"
      >
        <div class="fc-cp__search">
          <i class="ri-search-line fc-cp__search-icon" />
          <input
            v-model="query"
            type="text"
            class="fc-cp__input"
            :placeholder="placeholderText"
            @keydown="onKeydown"
          />
          <span v-if="parsed.mode === 'command'" class="fc-cp__hint">⌘</span>
          <span class="fc-cp__hint">esc</span>
        </div>

        <div class="fc-cp__results">
          <div v-if="results.length === 0" class="fc-cp__empty">
            {{ t('ux.command-palette.empty') }}
          </div>
          <div v-for="section in sections" :key="section.key" class="fc-cp__group">
            <div v-if="section.title" class="fc-cp__group-title">{{ section.title }}</div>
            <div
              v-for="c in section.items"
              :key="c.id"
              class="fc-cp__item"
              :class="{ active: results.indexOf(c) === activeIndex }"
              role="button"
              tabindex="0"
              @click="pick(c)"
              @mouseenter="activeIndex = results.indexOf(c)"
              @keydown.enter="pick(c)"
            >
              <i v-if="c.icon" :class="c.icon" class="fc-cp__item-icon" />
              <div class="fc-cp__item-body">
                <div class="fc-cp__item-label">{{ labelOf(c) }}</div>
                <div v-if="c.description" class="fc-cp__item-desc">{{ c.description }}</div>
              </div>
              <span v-if="c.keys || c.shortcut" class="fc-cp__shortcut">{{ c.keys || c.shortcut }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fc-cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
}
.fc-cp {
  background: var(--el-bg-color, #fff);
  border-radius: var(--app-radius-lg, 12px);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  max-width: calc(100vw - 32px);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.fc-cp__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--app-separator, #e5e5e5);
}
.fc-cp__search-icon {
  font-size: 16px;
  color: var(--app-text-secondary);
}
.fc-cp__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: var(--app-text);
}
.fc-cp__input::placeholder {
  color: var(--app-text-tertiary);
}
.fc-cp__hint {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--app-bg-muted, #f5f5f7);
  border-radius: 4px;
  color: var(--app-text-tertiary);
}
.fc-cp__results {
  overflow-y: auto;
  padding: 8px 0;
  max-height: 50vh;
}
.fc-cp__empty {
  padding: 24px;
  text-align: center;
  color: var(--app-text-secondary);
  font-size: 13px;
}
.fc-cp__group-title {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--app-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.fc-cp__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.1s;
}
.fc-cp__item.active,
.fc-cp__item:hover {
  background: var(--app-sidebar-item-hover-bg, rgba(0, 0, 0, 0.04));
}
.fc-cp__item-icon {
  font-size: 18px;
  color: var(--app-text-secondary);
  flex-shrink: 0;
}
.fc-cp__item-body {
  flex: 1;
  min-width: 0;
}
.fc-cp__item-label {
  font-size: 14px;
  color: var(--app-text);
}
.fc-cp__item-desc {
  font-size: 12px;
  color: var(--app-text-tertiary);
  margin-top: 2px;
}
.fc-cp__shortcut {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--app-bg-muted, #f5f5f7);
  border-radius: 4px;
  color: var(--app-text-tertiary);
  font-family: monospace;
  flex-shrink: 0;
}
.fc-cp-enter-active,
.fc-cp-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.fc-cp-enter-from,
.fc-cp-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
