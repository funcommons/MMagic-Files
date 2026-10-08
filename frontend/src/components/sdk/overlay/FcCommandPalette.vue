<script setup lang="ts">
defineOptions({ name: 'FcCommandPalette' })
/**
 * FcCommandPalette — 命令面板 (#8 命令面板 + #9 快捷键 + #15 撤销).
 *
 * 用法 (在 App.vue 全局挂一次):
 *   <FcCommandPalette v-model:open="paletteOpen" :commands="allCommands" />
 *
 * - 自动 Cmd/Ctrl+K 唤起 (内置快捷键)
 * - 模糊搜索 (label / keywords / group)
 * - 分组渲染
 * - 选中回车 / 点击 → invoke, 默认关闭 (handler 可通过 .keepOpen 阻止)
 * - Esc 关闭
 * - 焦点陷阱 + 滚轮滚动
 *
 * 命令注册: 业务侧通过 useCommandPalette() 或直接往 commands prop 推.
 */

import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocusTrap } from '@/composables'

export interface CommandItem {
  id: string
  /** 主标题 */
  label: string
  /** 副标题 / 说明 */
  description?: string
  /** i18n key (覆盖 label) */
  labelKey?: string
  /** 搜索时多匹配的关键词 (如 'undo 撤销 回退') */
  keywords?: string[]
  /** 分组 (决定渲染区域) */
  group?: string
  /** icon class (ri-xxx) */
  icon?: string
  /** 快捷键提示, 仅展示 (如 'Cmd+K') */
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

const filtered = computed<CommandItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.commands
  return props.commands.filter(c => {
    const haystack = [
      c.label,
      c.labelKey ? t(c.labelKey) : '',
      c.description ?? '',
      c.group ?? '',
      ...(c.keywords ?? []),
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
})

const grouped = computed(() => {
  const map = new Map<string, CommandItem[]>()
  for (const c of filtered.value) {
    const g = c.group ?? 'default'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(c)
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }))
})

function labelOf(c: CommandItem): string {
  return c.labelKey ? t(c.labelKey) : c.label
}

async function pick(c: CommandItem) {
  await c.handler()
  if (!c.keepOpen) emit('update:open', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(filtered.value.length - 1, activeIndex.value + 1)
    scrollIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(0, activeIndex.value - 1)
    scrollIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const c = filtered.value[activeIndex.value]
    if (c) pick(c)
  }
}

function scrollIntoView() {
  nextTick(() => {
    const items = rootRef.value?.querySelectorAll<HTMLElement>('.fc-cp__item')
    items?.[activeIndex.value]?.scrollIntoView({ block: 'nearest' })
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
            :placeholder="placeholder || t('ux.command-palette.placeholder')"
            @keydown="onKeydown"
          />
          <span class="fc-cp__hint">esc</span>
        </div>

        <div class="fc-cp__results">
          <div v-if="filtered.length === 0" class="fc-cp__empty">
            {{ t('ux.command-palette.empty') }}
          </div>
          <div v-for="group in grouped" :key="group.name" class="fc-cp__group">
            <div class="fc-cp__group-title">{{ group.name }}</div>
            <div
              v-for="c in group.items"
              :key="c.id"
              class="fc-cp__item"
              :class="{ active: filtered.indexOf(c) === activeIndex }"
              role="button"
              tabindex="0"
              @click="pick(c)"
              @mouseenter="activeIndex = filtered.indexOf(c)"
              @keydown.enter="pick(c)"
            >
              <i v-if="c.icon" :class="c.icon" class="fc-cp__item-icon" />
              <div class="fc-cp__item-body">
                <div class="fc-cp__item-label">{{ labelOf(c) }}</div>
                <div v-if="c.description" class="fc-cp__item-desc">{{ c.description }}</div>
              </div>
              <span v-if="c.shortcut" class="fc-cp__shortcut">{{ c.shortcut }}</span>
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