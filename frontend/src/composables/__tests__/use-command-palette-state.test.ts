import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  allCommands,
  clearCommands,
  clearRecent,
  closeCommandPalette,
  executeCommand,
  openCommandPalette,
  orderedCommands,
  parsePaletteQuery,
  recentIds,
  recordRecent,
  refreshCommandsProvider,
  registerCommands,
  registerCommandsProvider,
  registerFileSearchProvider,
  resolveFileResults,
  sortByRecent,
  useCommandPaletteState,
} from '../useCommandPaletteState'
import type { CommandItem } from '@/components/sdk/overlay/FcCommandPalette.vue'

const RECENT_STORAGE_KEY = 'ux:recent:command-palette'
// state 是模块内单例 (不直接导出), 经 bundle 访问
const { state } = useCommandPaletteState()

function cmd(id: string, extra: Partial<CommandItem> = {}): CommandItem {
  return { id, label: id, handler: vi.fn(), ...extra }
}

async function flushPersistence() {
  // useRecentList 的持久化走 watch (pre flush) → 需要 nextTick 落盘
  await nextTick()
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  clearCommands()
  clearRecent()
  registerFileSearchProvider(null)
  registerCommandsProvider(null)
  closeCommandPalette()
  await flushPersistence()
})

describe('parsePaletteQuery (命令/文件双模式解析)', () => {
  it('空输入 = 文件模式 + 空词', () => {
    expect(parsePaletteQuery('')).toEqual({ mode: 'file', text: '' })
  })

  it('普通词 = 文件模式, 原文 trim', () => {
    expect(parsePaletteQuery('  report pdf  ')).toEqual({ mode: 'file', text: 'report pdf' })
  })

  it('> 前缀 = 仅命令模式, 去掉前缀', () => {
    expect(parsePaletteQuery('>undo')).toEqual({ mode: 'command', text: 'undo' })
  })

  it('仅 > = 命令模式 + 空词', () => {
    expect(parsePaletteQuery('>')).toEqual({ mode: 'command', text: '' })
    expect(parsePaletteQuery('>   ')).toEqual({ mode: 'command', text: '' })
  })

  it('前导空白 + > 也算命令模式 (宽松解析)', () => {
    expect(parsePaletteQuery('  > undo all ')).toEqual({ mode: 'command', text: 'undo all' })
  })
})

describe('sortByRecent (最近使用置顶的稳定排序)', () => {
  const items = [cmd('a'), cmd('b'), cmd('c'), cmd('d')]

  it('无最近使用 → 保持注册序', () => {
    expect(sortByRecent(items, []).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('命中最近使用的置顶, 其余保持注册序', () => {
    expect(sortByRecent(items, ['c']).map((c) => c.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('多个最近使用按最新在前排序', () => {
    // 记录顺序: a → c → b (b 最新) → recentIds = [b, c, a]
    expect(sortByRecent(items, ['b', 'c', 'a']).map((c) => c.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('最近使用里不存在的 id 不影响排序', () => {
    expect(sortByRecent(items, ['zzz', 'b']).map((c) => c.id)).toEqual(['b', 'a', 'c', 'd'])
  })
})

describe('recordRecent / recentIds (最近使用记录)', () => {
  it('最新在前 + 去重', () => {
    recordRecent('a')
    recordRecent('b')
    recordRecent('a')
    expect(recentIds.value).toEqual(['a', 'b'])
  })

  it('容量 10: 超出丢最旧', () => {
    for (let i = 1; i <= 11; i++) recordRecent(`cmd-${i}`)
    expect(recentIds.value).toHaveLength(10)
    expect(recentIds.value).not.toContain('cmd-1')
    expect(recentIds.value[0]).toBe('cmd-11')
  })

  it('localStorage 持久化 (ux:recent:command-palette)', async () => {
    recordRecent('cmd-x')
    await flushPersistence()
    const raw = localStorage.getItem(RECENT_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual([{ id: 'cmd-x' }])
  })

  it('clearRecent 清空并落盘', async () => {
    recordRecent('cmd-x')
    await flushPersistence()
    clearRecent()
    await flushPersistence()
    expect(recentIds.value).toEqual([])
    expect(JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) as string)).toEqual([])
  })
})

describe('executeCommand (执行 + 联动最近使用)', () => {
  it('调用 handler 并透传返回值', async () => {
    const handler = vi.fn(() => 'ok')
    await expect(executeCommand(cmd('a', { handler }))).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('命令 (含缺省 group) 执行后记入最近使用', async () => {
    await executeCommand(cmd('cmd-a'))
    await executeCommand(cmd('cmd-b', { group: 'command' }))
    expect(recentIds.value).toEqual(['cmd-b', 'cmd-a'])
  })

  it('文件结果 (group=file) 执行不污染命令最近使用', async () => {
    await executeCommand(cmd('f.pdf', { group: 'file' }))
    await executeCommand(cmd('cmd-a'))
    expect(recentIds.value).toEqual(['cmd-a'])
  })
})

describe('registerFileSearchProvider / resolveFileResults (文件模式结果)', () => {
  it('未注册 provider → 空结果', async () => {
    await expect(resolveFileResults('report')).resolves.toEqual([])
  })

  it('注册后透传 query 并返回结果', async () => {
    const provider = vi.fn(async () => [cmd('f.pdf', { group: 'file' })])
    registerFileSearchProvider(provider)
    const items = await resolveFileResults('report')
    expect(provider).toHaveBeenCalledWith('report')
    expect(items.map((c) => c.id)).toEqual(['f.pdf'])
  })

  it('空 query 不调 provider', async () => {
    const provider = vi.fn(async () => [] as CommandItem[])
    registerFileSearchProvider(provider)
    await resolveFileResults('   ')
    expect(provider).not.toHaveBeenCalled()
  })

  it('provider 抛错 / 返回非数组 → 空结果 (不炸面板)', async () => {
    registerFileSearchProvider(async () => {
      throw new Error('search failed')
    })
    await expect(resolveFileResults('x')).resolves.toEqual([])

    registerFileSearchProvider(() => undefined as unknown as CommandItem[])
    await expect(resolveFileResults('x')).resolves.toEqual([])
  })
})

describe('registerCommandsProvider (动态命令接缝)', () => {
  it('refresh 后合并进 allCommands', async () => {
    registerCommands([cmd('static-a')])
    registerCommandsProvider(() => [cmd('dynamic-b'), cmd('static-a')])
    await refreshCommandsProvider()

    expect(allCommands.value.map((c) => c.id)).toEqual(['static-a', 'dynamic-b'])
    // 同 id 时动态 provider 覆盖静态注册
    registerCommandsProvider(() => [cmd('static-a', { label: 'fresh-label' })])
    await refreshCommandsProvider()
    expect(allCommands.value.find((c) => c.id === 'static-a')?.label).toBe('fresh-label')
  })

  it('打开面板时自动刷新 provider', async () => {
    const provider = vi.fn(() => [cmd('dynamic-b')] as CommandItem[])
    registerCommandsProvider(provider)
    await flushPersistence()
    expect(provider).toHaveBeenCalledTimes(1) // 注册即预取一次

    openCommandPalette()
    await flushPersistence()
    expect(provider).toHaveBeenCalledTimes(2)
    expect(state.open).toBe(true)
  })

  it('provider 抛错 → 动态命令置空, 不炸面板', async () => {
    registerCommandsProvider(() => {
      throw new Error('boom')
    })
    await refreshCommandsProvider()
    expect(allCommands.value).toEqual([])
  })

  it('orderedCommands: 最近使用置顶 + 其余注册序', async () => {
    registerCommands([cmd('a'), cmd('b'), cmd('c')])
    registerCommandsProvider(() => [cmd('d')])
    await refreshCommandsProvider()
    recordRecent('b')
    expect(orderedCommands.value.map((c) => c.id)).toEqual(['b', 'a', 'c', 'd'])
  })
})

// 放最后: vi.resetModules() 会使本文件上方对原模块的导入绑定失效, 不能污染其它用例
describe('最近使用 — 页面刷新后恢复 (新模块实例)', () => {
  it('新模块实例从 localStorage 重建最近使用', async () => {
    recordRecent('cmd-persist')
    recordRecent('cmd-persist-2')
    await flushPersistence()

    vi.resetModules()
    const fresh = await import('../useCommandPaletteState')
    expect(fresh.recentIds.value).toEqual(['cmd-persist-2', 'cmd-persist'])
  })
})
