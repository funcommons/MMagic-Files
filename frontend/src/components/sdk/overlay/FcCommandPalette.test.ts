import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountFc } from '../__tests__/helpers/mount'
import FcCommandPalette from './FcCommandPalette.vue'
import { clearCommands, clearRecent, registerFileSearchProvider } from '@/composables/useCommandPaletteState'
import type { CommandItem } from './FcCommandPalette.vue'

const RECENT_STORAGE_KEY = 'ux:recent:command-palette'

function cmd(id: string, extra: Partial<CommandItem> = {}): CommandItem {
  return { id, label: id, handler: vi.fn(), ...extra }
}

async function flushAsync() {
  // 输入 → watcher (pre) → async provider → 回填结果 → 重渲染
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function mountPalette(commands: CommandItem[], props: Record<string, unknown> = {}) {
  return mountFc(FcCommandPalette, {
    props: { open: true, commands, ...props },
  })
}

function typeQuery(wrapper: ReturnType<typeof mountPalette>, value: string) {
  return wrapper.find('input.fc-cp__input').setValue(value)
}

beforeEach(async () => {
  localStorage.clear()
  clearRecent()
  clearCommands()
  registerFileSearchProvider(null)
})

describe('FcCommandPalette — keys 快捷键提示列', () => {
  it('keys 渲染为右对齐提示 (fc-cp__shortcut), keys 优先于 shortcut', () => {
    const w = mountPalette([
      cmd('a', { label: 'Open Palette', keys: '⌘K' }),
      cmd('b', { label: 'Save', shortcut: 'F2' }),
      cmd('c', { label: 'Both', keys: '⌘⇧P', shortcut: 'F1' }),
    ])
    const texts = w.findAll('.fc-cp__shortcut').map((n) => n.text())
    expect(texts).toEqual(['⌘K', 'F2', '⌘⇧P'])
  })

  it('无 keys/shortcut → 不渲染提示位', () => {
    const w = mountPalette([cmd('a', { label: 'Plain' })])
    expect(w.find('.fc-cp__shortcut').exists()).toBe(false)
  })
})

describe('FcCommandPalette — group 分组渲染', () => {
  it('保留字 group (command/file) 不渲染分组标题; 传统字符串 group 照旧渲染', () => {
    const w = mountPalette([
      cmd('a', { label: 'Legacy Action', group: '媒体操作' }),
      cmd('b', { label: 'Open Palette', group: 'command' }),
      cmd('c', { label: 'a.pdf', description: 'docs/a.pdf', group: 'file', handler: vi.fn() }),
    ])
    const titles = w.findAll('.fc-cp__group-title').map((n) => n.text())
    expect(titles).toEqual(['媒体操作'])
    // 三行都在
    expect(w.findAll('.fc-cp__item')).toHaveLength(3)
  })
})

describe('FcCommandPalette — 双模式', () => {
  const mixed = (): CommandItem[] => [
    cmd('upload', { label: 'Upload Files', group: 'command' }),
    cmd('f1', { label: 'report.pdf', description: 'docs/report.pdf', group: 'file', handler: vi.fn() }),
  ]

  it("'>' 前缀 = 仅命令模式: 文件结果被过滤掉", async () => {
    const w = mountPalette(mixed())
    await typeQuery(w, '>uplo')
    await flushAsync()
    const labels = w.findAll('.fc-cp__item-label').map((n) => n.text())
    expect(labels).toContain('Upload Files')
    expect(labels).not.toContain('report.pdf')
  })

  it('默认 = 文件模式: provider 命中时只显示文件结果 (文件名+路径)', async () => {
    registerFileSearchProvider(async (q) =>
      q === 'report'
        ? [cmd('f1', { label: 'report.pdf', description: 'docs/report.pdf', group: 'file' })]
        : [],
    )
    const w = mountPalette(mixed())
    await typeQuery(w, 'report')
    await flushAsync()
    const labels = w.findAll('.fc-cp__item-label').map((n) => n.text())
    expect(labels).toEqual(['report.pdf'])
    expect(w.find('.fc-cp__item-desc').text()).toBe('docs/report.pdf')
  })

  it('文件模式: provider 未命中 → 回退到命令匹配 (面板不空转)', async () => {
    registerFileSearchProvider(async () => [])
    const w = mountPalette(mixed())
    await typeQuery(w, 'uplo')
    await flushAsync()
    const labels = w.findAll('.fc-cp__item-label').map((n) => n.text())
    expect(labels).toContain('Upload Files')
  })

  it('文件模式: 全部未命中 → 空态', async () => {
    registerFileSearchProvider(async () => [])
    const w = mountPalette([cmd('upload', { label: 'Upload Files', group: 'command' })])
    await typeQuery(w, 'zzz-no-hit')
    await flushAsync()
    expect(w.find('.fc-cp__empty').exists()).toBe(true)
  })

  it('placeholder 按模式区分 (缺省 placeholder prop 时)', async () => {
    const w = mountPalette(mixed())
    const input = w.find('input.fc-cp__input')
    // 测试 i18n 为空表 → t() 回退 key 本身, 断言引用了哪个键
    expect(input.attributes('placeholder')).toContain('ux.shortcut.search')

    await typeQuery(w, '> undo')
    expect(w.find('input.fc-cp__input').attributes('placeholder')).toContain('ux.shortcut.palette')
  })
})

describe('FcCommandPalette — 执行联动最近使用', () => {
  it('点击执行 → handler 调用 + recordRecent 落 localStorage + 关闭面板', async () => {
    const handler = vi.fn()
    const w = mountPalette([cmd('cmd-rec', { label: 'Record Me', handler })])
    await w.findAll('.fc-cp__item')[0]!.trigger('click')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(w.emitted('update:open')).toEqual([[false]])

    await flushAsync()
    const raw = localStorage.getItem(RECENT_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual([{ id: 'cmd-rec' }])
  })

  it('keepOpen 命令执行后面板不关', async () => {
    const w = mountPalette([cmd('cmd-keep', { label: 'Stay', keepOpen: true })])
    await w.findAll('.fc-cp__item')[0]!.trigger('click')
    expect(w.emitted('update:open')).toBeUndefined()
  })

  it('键盘 Enter 执行当前高亮项', async () => {
    const handler = vi.fn()
    const w = mountPalette([cmd('a', { label: 'First' }), cmd('b', { label: 'Second', handler })])
    await w.find('input.fc-cp__input').trigger('keydown', { key: 'ArrowDown' })
    await w.find('input.fc-cp__input').trigger('keydown', { key: 'Enter' })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
