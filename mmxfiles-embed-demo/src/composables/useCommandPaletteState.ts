import { computed, reactive, ref, watch } from 'vue'
import type { CommandItem } from '@/components/sdk/overlay/FcCommandPalette.vue'
import { useRecentList } from './useRecentList'

/**
 * 命令面板全局单例状态 (#8 命令面板 / P1 Lane H5 升级).
 *
 * 任何模块都可以:
 *   - registerCommands(...)          注册一批静态命令 (同 id 覆盖)
 *   - registerCommandsProvider(fn)   注册动态命令提供者 (每次打开面板重新拉取;
 *                                    App.vue 接缝, 供 Home 后续注册上传/新建目录/
 *                                    搜索/切换语言等真实动作)
 *   - registerFileSearchProvider(fn) 注册文件搜索提供者 (默认「文件模式」的结果来源;
 *                                    契约: query → CommandItem[], 行=文件名 label
 *                                    + 路径 description + group:'file';
 *                                    主线待接 src/files/search-index.ts)
 *   - openCommandPalette() / closeCommandPalette()
 *   - recordRecent(id)               命令执行即记最近使用 (localStorage, 容量 10)
 *
 * 双模式 (VS Code 惯例): 默认 = 文件模式, 输入 '>' 前缀 = 仅命令模式.
 * 解析与结果获取: parsePaletteQuery / resolveFileResults.
 *
 * App.vue 挂一个 <FcCommandPalette v-model:open="state.open" :commands="orderedCommands" />,
 * 全项目共享一个面板实例; orderedCommands = 最近使用置顶 + 其余注册序.
 */

interface PaletteState {
  open: boolean
  commands: CommandItem[]
}

const state = reactive<PaletteState>({
  open: false,
  commands: [],
})

// ───────────────────────── 查询解析 (命令/文件双模式) ─────────────────────────

export type PaletteMode = 'command' | 'file'

export interface ParsedPaletteQuery {
  mode: PaletteMode
  /** 去掉模式前缀并 trim 后的搜索词 */
  text: string
}

/** '>' 前缀 = 仅命令模式 (VS Code 惯例); 其余 = 文件模式 (默认). */
export function parsePaletteQuery(query: string): ParsedPaletteQuery {
  const trimmed = query.trim()
  if (trimmed.startsWith('>')) {
    return { mode: 'command', text: trimmed.slice(1).trim() }
  }
  return { mode: 'file', text: trimmed }
}

// ───────────────────────── 最近使用 (置顶排序) ─────────────────────────

const RECENT_MAX = 10

// 模块级单例: 与 state 同生命周期, 持久化 localStorage ('ux:recent:command-palette')
const recent = useRecentList<{ id: string }>({ key: 'command-palette', max: RECENT_MAX })

/** 最近执行过的命令 id (最新在前; localStorage 持久化, 容量 10) */
export const recentIds = computed<string[]>(() => recent.list.value.map((x) => x.id))

export function recordRecent(id: string): void {
  recent.pick({ id })
}

export function clearRecent(): void {
  recent.clear()
}

/** 稳定排序: 命中最近使用的排最前 (最新在前), 未命中的保持原顺序 */
export function sortByRecent<T extends { id: string }>(
  items: readonly T[],
  recentList: readonly string[],
): T[] {
  const order = new Map<string, number>()
  recentList.forEach((id, i) => {
    if (!order.has(id)) order.set(id, i)
  })
  const weight = (item: T): number => order.get(item.id) ?? Number.MAX_SAFE_INTEGER
  return [...items].sort((a, b) => weight(a) - weight(b))
}

// ───────────────────────── 统一执行入口 (联动最近使用) ─────────────────────────

/**
 * 统一执行入口: 命令执行即记入最近使用 (group:'file' 的文件结果除外).
 * 面板的 pick 走这里; 业务侧直接调 item.handler() 不会被记录.
 */
export async function executeCommand(item: CommandItem): Promise<unknown> {
  if ((item.group ?? 'command') !== 'file') recordRecent(item.id)
  return item.handler()
}

// ───────────────────────── provider (动态命令 + 文件搜索接缝) ─────────────────────────

export type CommandsProvider = () => Promise<CommandItem[]> | CommandItem[]
export type FileSearchProvider = (query: string) => Promise<CommandItem[]> | CommandItem[]

let commandsProvider: CommandsProvider | null = null
let fileSearchProvider: FileSearchProvider | null = null

/**
 * 注册动态命令提供者 (后注册覆盖先注册; 传 null 注销).
 * App.vue 层接缝: 打开面板时自动拉取, 供业务域动态提供命令清单.
 */
export function registerCommandsProvider(fn: CommandsProvider | null): void {
  commandsProvider = fn
  void refreshCommandsProvider()
}

/**
 * 注册文件搜索提供者 (后注册覆盖先注册; 传 null 注销).
 * 结果行契约: label=文件名, description=路径, group:'file', id 唯一 (建议用对象 key).
 * 主线待办: 基于 src/files/search-index.ts (SearchIndex.search, 只读依赖) 实现 —
 * 需 S3Client 会话与 MetaStore 生命周期, 归 Home/文件域接线.
 */
export function registerFileSearchProvider(fn: FileSearchProvider | null): void {
  fileSearchProvider = fn
}

function asItems(value: CommandItem[] | null | undefined): CommandItem[] {
  return Array.isArray(value) ? value : []
}

/** 文件模式结果: 未注册 provider / 空 query / provider 抛错 → 空结果 (不炸面板) */
export async function resolveFileResults(query: string): Promise<CommandItem[]> {
  const q = query.trim()
  if (!fileSearchProvider || !q) return []
  try {
    return asItems(await fileSearchProvider(q))
  } catch {
    return []
  }
}

const providerCommands = ref<CommandItem[]>([])

/** 拉取动态命令 (打开面板时自动触发; 业务可手动调用) */
export async function refreshCommandsProvider(): Promise<void> {
  if (!commandsProvider) {
    providerCommands.value = []
    return
  }
  try {
    providerCommands.value = asItems(await commandsProvider())
  } catch {
    providerCommands.value = []
  }
}

watch(() => state.open, (open) => {
  if (open) void refreshCommandsProvider()
})

// ───────────────────────── 静态命令注册表 (原有 API) ─────────────────────────

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

// ───────────────────────── 汇总 (去重 + 最近置顶) ─────────────────────────

/** 静态命令 + 动态命令合并 (同 id 时动态 provider 覆盖静态注册) */
export const allCommands = computed<CommandItem[]>(() => {
  const byId = new Map<string, CommandItem>()
  for (const c of state.commands) byId.set(c.id, c)
  for (const c of providerCommands.value) byId.set(c.id, c)
  return [...byId.values()]
})

/** 面板展示序: 最近使用优先, 其余保持注册序 */
export const orderedCommands = computed<CommandItem[]>(() =>
  sortByRecent(allCommands.value, recentIds.value),
)

export function useCommandPaletteState() {
  return {
    state,
    openCommandPalette,
    closeCommandPalette,
    registerCommands,
    unregisterCommands,
    clearCommands,
    recordRecent,
    clearRecent,
    recentIds,
    allCommands,
    orderedCommands,
    executeCommand,
    parsePaletteQuery,
    sortByRecent,
    registerCommandsProvider,
    registerFileSearchProvider,
    resolveFileResults,
    refreshCommandsProvider,
  }
}
