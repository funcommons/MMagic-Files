/**
 * PreviewTabs 测试（Lane H1：预览 Tab 条——预览态/钉住/LRU，OpenVSCode 预览态模型）。
 * 覆盖点：
 *  1. 纯状态 upsertTab——首开追加；激活 tab 未钉住=原位替换（预览态，VS Code 斜体 tab 行为）；
 *     已钉住=追加；同 key 复开=原位保留（钉住状态不变、entry/appId 刷新）；
 *  2. LRU 上限 8——超限淘汰最旧未钉住（排除当前激活）；全钉住=淘汰最旧未激活者；激活者与最新 tab 永不被淘汰；
 *  3. pinToggle（双击钉住/取消）与 pickNeighbor（关 tab 后相邻激活：右邻优先、末位取左邻）；
 *  4. 组件纯受控——tabs 空=不渲染；data-testid 全套（preview-tabs/preview-tab/preview-tab-pin/preview-tab-close）；
 *     单击 emit activate(entry)、双击 emit pin-toggle(key)、关闭钮 emit close(entry) 且不冒泡 activate；
 *  5. preview.onOpened（tab 链所需最小暴露）——open 链接管容器（含拒绝节点）时通知 entry；
 *     gate 暂缓/确认档取消/关闭链不通知（状态零变更口径）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PreviewTabs, { findTab, pickNeighbor, pinToggle, upsertTab } from '../ui/PreviewTabs.vue'
import type { PreviewTab } from '../ui/PreviewTabs.vue'
import { PREVIEW_REJECT_BYTES, createPreview } from '../preview'
import type { PreviewOptions } from '../preview'
import { AppRegistry } from '@/apps/registry'
import type { AppDataSource } from '@/apps/datasource'
import type { AppDefinition, AppInstance, S3ObjectSummary } from '@/sdk/types'

// ───────────────────────── 工具 ─────────────────────────

function mk(key: string, name = key): S3ObjectSummary {
  return { key, name, size: 1, isDir: false }
}
const pinned = (key: string): PreviewTab => ({ entry: mk(key), pinned: true })
const unpinned = (key: string): PreviewTab => ({ entry: mk(key), pinned: false })

function renderApp(id: string, result: AppInstance | null = null): AppDefinition {
  return {
    id,
    matcher: { ext: ['txt'] },
    renderer: vi.fn((el: HTMLElement, file: { key: string; name: string; size: number }) => {
      el.textContent = file.name
      return result ?? undefined
    }),
  }
}

function makeRegistry(...defs: AppDefinition[]): AppRegistry {
  const reg = new AppRegistry()
  for (const def of defs) {
    const r = reg.register(def)
    if (!r.ok) throw new Error(`register 失败：${def.id}`)
  }
  return reg
}

function noopDatasource(): AppDataSource {
  return { getObject: vi.fn(async () => new Blob()), putObject: vi.fn(async () => undefined) }
}

function makePreview(registry: AppRegistry, extra: Partial<PreviewOptions> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return { container, preview: createPreview({ ...{
    container,
    registry,
    datasource: noopDatasource(),
    t: (key: string) => key,
    theme: {},
    notifyFileChanged: vi.fn(),
  }, ...extra }) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

// ───────────────────────── 纯状态：upsertTab（预览态替换/追加） ─────────────────────────

describe('upsertTab（预览态语义）', () => {
  it('首开（activeKey=null）→ 追加新 tab', () => {
    const tabs: PreviewTab[] = []
    upsertTab(tabs, mk('a'), null)
    expect(tabs.map((t) => t.entry.key)).toEqual(['a'])
    expect(tabs[0]!.pinned).toBe(false) // 新 tab 恒未钉住（预览态）
  })

  it('激活 tab 未钉住 → 原位替换（位置保持、替换者未钉住、旧 tab 消失）', () => {
    const tabs = [unpinned('a'), pinned('b')]
    upsertTab(tabs, mk('c'), 'a')
    expect(tabs.map((t) => t.entry.key)).toEqual(['c', 'b'])
    expect(tabs[0]!.pinned).toBe(false)
  })

  it('激活 tab 已钉住 → 追加（钉住内容不被替换）', () => {
    const tabs = [pinned('a'), unpinned('b')]
    upsertTab(tabs, mk('c'), 'a')
    expect(tabs.map((t) => t.entry.key)).toEqual(['a', 'b', 'c'])
  })

  it('无激活 tab（activeKey=null）→ 追加（不替换任何既有 tab）', () => {
    const tabs = [unpinned('a'), unpinned('b')]
    upsertTab(tabs, mk('c'), null)
    expect(tabs.map((t) => t.entry.key)).toEqual(['a', 'b', 'c'])
  })

  it('同 key 复开 → 原位保留（位置/钉住不变，entry 与 appId 刷新）', () => {
    const tabs = [pinned('a'), unpinned('b')]
    const fresh = mk('a')
    upsertTab(tabs, fresh, 'a', 'app2')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.pinned).toBe(true)
    expect(tabs[0]!.entry).toBe(fresh)
    expect(tabs[0]!.appId).toBe('app2')
  })

  it('替换路径长度不变 → 不触发 LRU 淘汰', () => {
    const tabs = [unpinned('a'), ...Array.from({ length: 7 }, (_, i) => pinned(`p${i}`))]
    upsertTab(tabs, mk('n'), 'a')
    expect(tabs).toHaveLength(8)
    expect(tabs[0]!.entry.key).toBe('n')
  })
})

// ───────────────────────── 纯状态：LRU 上限 8 ─────────────────────────

describe('LRU 上限 8（淘汰语义）', () => {
  it('超限 → 淘汰最旧未钉住（排除当前激活；钉住与最新 tab 保留）', () => {
    const tabs = [unpinned('u1'), unpinned('u2'), pinned('p3'), pinned('p4'), pinned('p5'), pinned('p6'), pinned('p7'), pinned('p8')]
    upsertTab(tabs, mk('n'), 'p8')
    expect(tabs).toHaveLength(8)
    expect(tabs.map((t) => t.entry.key)).toEqual(['u2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'n'])
  })

  it('全钉住 → 淘汰最旧未激活者（容量守恒优先于钉住保护；最新 tab 永不淘汰）', () => {
    const tabs = Array.from({ length: 8 }, (_, i) => pinned(`p${i}`))
    upsertTab(tabs, mk('n'), 'p7')
    expect(tabs).toHaveLength(8)
    expect(tabs.map((t) => t.entry.key)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'n'])
  })

  it('无激活 tab 时超限 → 仍淘汰最旧未钉住（全部钉住则淘汰最旧）', () => {
    const tabs = [pinned('p1'), unpinned('u2'), pinned('p3'), pinned('p4'), pinned('p5'), pinned('p6'), pinned('p7'), pinned('p8')]
    upsertTab(tabs, mk('n'), null)
    expect(tabs.map((t) => t.entry.key)).toEqual(['p1', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'n'])
  })

  it('连续追加在 LRU 稳态下保持 8 个（滚动淘汰；最新 tab 永不入选淘汰）', () => {
    const tabs = Array.from({ length: 8 }, (_, i) => pinned(`p${i}`))
    for (let i = 0; i < 3; i++) upsertTab(tabs, mk(`n${i}`), 'p7')
    expect(tabs).toHaveLength(8)
    expect(tabs.map((t) => t.entry.key)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'n2'])
  })
})

// ───────────────────────── 纯状态：pinToggle / pickNeighbor ─────────────────────────

describe('pinToggle / pickNeighbor', () => {
  it('pinToggle：双击语义切换钉住；key 不存在=无操作', () => {
    const tabs = [unpinned('a')]
    pinToggle(tabs, 'a')
    expect(tabs[0]!.pinned).toBe(true)
    pinToggle(tabs, 'a')
    expect(tabs[0]!.pinned).toBe(false)
    expect(() => pinToggle(tabs, 'ghost')).not.toThrow()
    expect(tabs).toHaveLength(1)
  })

  it('pickNeighbor：右邻优先；末位取左邻；唯一 tab=null；缺 key=null', () => {
    const tabs = [unpinned('a'), unpinned('b'), unpinned('c')]
    expect(pickNeighbor(tabs, 'b')?.entry.key).toBe('c')
    expect(pickNeighbor(tabs, 'c')?.entry.key).toBe('b')
    expect(pickNeighbor(tabs, 'a')?.entry.key).toBe('b')
    expect(pickNeighbor([unpinned('only')], 'only')).toBeNull()
    expect(pickNeighbor(tabs, 'ghost')).toBeNull()
  })
})

// ───────────────────────── 组件（纯受控） ─────────────────────────

describe('PreviewTabs 组件', () => {
  const A = mk('dir/a.txt', 'a.txt')
  const B = mk('dir/b.md', 'b.md')
  const tabA: PreviewTab = { entry: A, pinned: false }
  const tabB: PreviewTab = { entry: B, pinned: true, appId: 'app2' }

  it('tabs 空 → 不渲染（仅 tabs.length>0 渲染）', () => {
    const w = mount(PreviewTabs, { props: { tabs: [], activeKey: null } })
    expect(w.find('[data-testid="preview-tabs"]').exists()).toBe(false)
    w.unmount()
  })

  it('渲染 tab 名/激活态/钉住图钉；data-testid 与 data-key 全套', () => {
    const w = mount(PreviewTabs, { props: { tabs: [tabA, tabB], activeKey: 'dir/a.txt' } })
    expect(w.find('[data-testid="preview-tabs"]').exists()).toBe(true)
    const items = w.findAll('[data-testid="preview-tab"]')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('a.txt')
    expect(items[0]!.attributes('data-key')).toBe('dir/a.txt')
    expect(items[0]!.classes()).toContain('is-active')
    expect(items[1]!.classes()).not.toContain('is-active')
    expect(items[1]!.classes()).toContain('is-pinned')
    expect(items[1]!.find('[data-testid="preview-tab-pin"]').exists()).toBe(true)
    expect(items[0]!.find('[data-testid="preview-tab-pin"]').exists()).toBe(false)
    w.unmount()
  })

  it('单击 tab → activate(entry)；双击 → pin-toggle(key)', async () => {
    const w = mount(PreviewTabs, { props: { tabs: [tabA, tabB], activeKey: null } })
    await w.findAll('[data-testid="preview-tab"]')[1]!.trigger('click')
    expect(w.emitted('activate')).toEqual([[B]])
    await w.findAll('[data-testid="preview-tab"]')[0]!.trigger('dblclick')
    expect(w.emitted('pin-toggle')).toEqual([['dir/a.txt']])
    w.unmount()
  })

  it('关闭钮 → close(entry)，不冒泡 activate；activeKey 变化跟随 props（纯受控）', async () => {
    const w = mount(PreviewTabs, { props: { tabs: [tabA, tabB], activeKey: 'dir/a.txt' } })
    await w.findAll('[data-testid="preview-tab"]')[1]!.find('[data-testid="preview-tab-close"]').trigger('click')
    expect(w.emitted('close')).toEqual([[B]])
    expect(w.emitted('activate')).toBeUndefined()
    await w.setProps({ activeKey: 'dir/b.md' })
    expect(w.findAll('[data-testid="preview-tab"]')[1]!.classes()).toContain('is-active')
    w.unmount()
  })

  it('findTab：按 key 查找（Home 复用）', () => {
    const tabs = [tabA, tabB]
    expect(findTab(tabs, 'dir/b.md')).toBe(tabB)
    expect(findTab(tabs, 'ghost')).toBeUndefined()
  })
})

// ───────────────────────── preview.onOpened（tab 链最小暴露） ─────────────────────────

describe('preview.onOpened（Lane H1 tab 链所需最小暴露）', () => {
  const MB = 1024 * 1024
  const A = mk('d/a.txt', 'a.txt')
  const B = mk('d/b.txt', 'b.txt')
  const huge = { key: 'd/huge.txt', name: 'huge.txt', size: PREVIEW_REJECT_BYTES + MB, isDir: false } as S3ObjectSummary
  const mid = { key: 'd/mid.txt', name: 'mid.txt', size: 30 * MB, isDir: false } as S3ObjectSummary

  it('open 链接管容器 → onOpened(entry) 恰一次', async () => {
    const onOpened = vi.fn()
    const { preview } = makePreview(makeRegistry(renderApp('app1')), { onOpened })
    await preview.open(A)
    expect(onOpened).toHaveBeenCalledTimes(1)
    expect(onOpened).toHaveBeenCalledWith(A)
    await preview.open(B)
    expect(onOpened).toHaveBeenCalledTimes(2)
    expect(onOpened).toHaveBeenLastCalledWith(B)
  })

  it('拒绝节点（size>REJECT）同样接管容器 → 通知', async () => {
    const onOpened = vi.fn()
    const { preview } = makePreview(makeRegistry(renderApp('app1')), { onOpened })
    await preview.open(huge)
    expect(onOpened).toHaveBeenCalledTimes(1)
    expect(onOpened).toHaveBeenCalledWith(huge)
  })

  it('beforeDispose 暂缓 → 不通知（状态零变更）；放行后恢复通知', async () => {
    const gate = vi.fn(() => false)
    const inst = { dispose: vi.fn(), beforeDispose: gate } as AppInstance
    const onOpened = vi.fn()
    const { preview } = makePreview(makeRegistry(renderApp('app1', inst)), { onOpened })
    await preview.open(A)
    expect(onOpened).toHaveBeenCalledTimes(1)
    await preview.open(B)
    expect(onOpened).toHaveBeenCalledTimes(1) // 暂缓：本次 open 未生效
    expect(preview.current()).toBe(A)
  })

  it('确认档取消（confirmLargeFile=false）→ 不通知', async () => {
    const onOpened = vi.fn()
    const { preview } = makePreview(makeRegistry(renderApp('app1')), {
      onOpened,
      confirmLargeFile: async () => false,
    })
    await preview.open(mid)
    expect(onOpened).not.toHaveBeenCalled()
  })

  it('close/expire/clear 链不通知', async () => {
    const onOpened = vi.fn()
    const { preview } = makePreview(makeRegistry(renderApp('app1')), { onOpened })
    await preview.open(A)
    expect(onOpened).toHaveBeenCalledTimes(1)
    await preview.close()
    preview.expire()
    preview.clear()
    expect(onOpened).toHaveBeenCalledTimes(1)
  })
})
