import { reactive } from 'vue'
import type { CommandItem } from '@/components/sdk/overlay/FcCommandPalette.vue'

/**
 * 命令面板全局单例状态 (#8 命令面板).
 *
 * 任何模块都可以:
 *   - registerCommands(...)   注册一批命令
 *   - openCommandPalette()    打开面板
 *   - closeCommandPalette()   关闭
 *
 * App.vue 挂一个 <FcCommandPalette v-model:open="state.open" :commands="state.commands" />,
 * 这样全项目共享一个面板实例.
 */

interface PaletteState {
  open: boolean
  commands: CommandItem[]
}

const state = reactive<PaletteState>({
  open: false,
  commands: [],
})

export function registerCommands(items: CommandItem[]) {
  // 替换同名命令, 保留其它
  const ids = new Set(items.map(i => i.id))
  const merged = state.commands.filter(c => !ids.has(c.id))
  state.commands = [...merged, ...items]
}

export function unregisterCommands(ids: string[]) {
  const idSet = new Set(ids)
  state.commands = state.commands.filter(c => !idSet.has(c.id))
}

export function clearCommands() {
  state.commands = []
}

export function openCommandPalette(): void {
  state.open = true
}

export function closeCommandPalette(): void {
  state.open = false
}

export function useCommandPaletteState() {
  return {
    state,
    openCommandPalette,
    closeCommandPalette,
    registerCommands,
    unregisterCommands,
    clearCommands,
  }
}