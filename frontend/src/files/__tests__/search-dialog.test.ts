/**
 * SearchDialog 组件测试（P0 Lane G2）：fake client + memory store 经 storeFactory 注入。
 * 覆盖：挂载渲染（搜索框/扫描钮/索引提示/空索引不出结果与空态）、预置索引出结果行
 * （排序/大小/路径）与行操作 emit（open/locate）、实时过滤（包含匹配/大小区间/类型下拉）、
 * 扫描（gate 挂起期间禁用重复触发+进度、翻页入库、scan-done toast、结果刷新）、
 * 扫描失败（toast.error+状态复位）、open=false 不渲染、关闭透传 update:open。
 * toast 以模块 mock 收口（词典无失败键，错误走消息原文，不在此断言文案）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import type { S3Client, S3ListResult } from '@/sdk/types'
import { createMemoryMetaStore } from '../search-index'
import type { MetaRow, MetaStore } from '../search-index'
import SearchDialog from '../ui/SearchDialog.vue'

const { toastSpies } = vi.hoisted(() => ({
  toastSpies: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

// 只换 toast（scan-done 成功提示/失败提示断言口），组件库其余导出保持原实现
vi.mock('@/components/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/sdk')>()
  return { ...actual, toast: toastSpies as unknown as typeof actual.toast }
})

/** 平铺 S3 Fake：可翻页、可注入失败、可用 gate 挂起在途（测扫描中禁用/进度） */
class FakeListClient implements S3Client {
  objects = new Map<string, { size: number; lastModified?: number }>()
  pageSize = 0
  calls = 0
  fail = false
  gate: Promise<void> | null = null

  async list(prefix: string, opts?: { continuationToken?: string }): Promise<S3ListResult> {
    this.calls++
    if (this.fail) throw new SdkError(ERROR_CODES.S3_ERROR, 'list boom', 500)
    if (this.gate) await this.gate
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort()
    const size = this.pageSize > 0 ? this.pageSize : Math.max(keys.length, 1)
    const start = opts?.continuationToken ? Number(opts.continuationToken) : 0
    const page = keys.slice(start, start + size)
    return {
      prefix,
      dirs: [],
      files: page.map((k) => {
        const meta = this.objects.get(k)
        return {
          key: k,
          name: k.slice(prefix.length),
          size: meta?.size ?? 0,
          lastModified: meta?.lastModified,
          isDir: false,
        }
      }),
      continuationToken: start + size < keys.length ? String(start + size) : undefined,
    }
  }

  async get(): Promise<Response> { throw new Error('未实现') }
  async put(): Promise<{ etag: string }> { throw new Error('未实现') }
  async head(): Promise<{ exists: boolean }> { throw new Error('未实现') }
  async copy(): Promise<void> { throw new Error('未实现') }
  async remove(): Promise<void> { throw new Error('未实现') }
  async createMultipart(): Promise<{ uploadId: string }> { throw new Error('未实现') }
  async uploadPart(): Promise<{ etag: string }> { throw new Error('未实现') }
  async completeMultipart(): Promise<void> { throw new Error('未实现') }
  async abortMultipart(): Promise<void> { throw new Error('未实现') }
}

const row = (key: string, size = 10, lastModified?: number): MetaRow => ({
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  size,
  lastModified,
  rootPrefix: 'root/',
})

async function seededStore(rows: MetaRow[]): Promise<MetaStore> {
  const store = createMemoryMetaStore()
  await store.put(rows)
  return store
}

/** i18n 全局词典为空（见 sdk 测试 setup），t() 回退 key 本身——断言锚 data-testid 与 key 文本 */
function mountDialog(opts: { store?: MetaStore; client?: FakeListClient; open?: boolean } = {}) {
  const store = opts.store ?? createMemoryMetaStore()
  const client = opts.client ?? new FakeListClient()
  const w: VueWrapper = mount(SearchDialog, {
    props: {
      client,
      rootPrefix: 'root/',
      storeFactory: () => store,
      ...(opts.open === undefined ? {} : { open: opts.open }),
    },
  })
  return { w, store, client }
}

describe('SearchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks() // toastSpies 跨用例隔离
  })

  it('挂载渲染：搜索框 placeholder/扫描钮/索引提示；空索引无结果、无空态、无计数', async () => {
    const { w } = mountDialog()
    await flushPromises()
    expect(w.find('[data-testid="scan"]').exists()).toBe(true)
    expect(w.find('[data-testid="index-hint"]').text()).toBe('search.index-hint')
    const input = w.find<HTMLInputElement>('.search-dialog__query input')
    expect(input.exists()).toBe(true)
    expect(input.element.placeholder).toBe('search.placeholder')
    expect(w.find('[data-testid="result-list"]').exists()).toBe(false)
    expect(w.find('[data-testid="empty"]').exists()).toBe(false)
    expect(w.find('[data-testid="index-count"]').exists()).toBe(false)
    w.unmount()
  })

  it('open=false：不渲染对话框内容（父层 v-model:open 收口）', async () => {
    const { w } = mountDialog({ open: false })
    await flushPromises()
    expect(w.find('[data-testid="scan"]').exists()).toBe(false)
    w.unmount()
  })

  it('预置索引：挂载即出结果行（lastModified 降序、大小人读、路径列相对根域），计数可见', async () => {
    const { w } = mountDialog({
      store: await seededStore([row('root/a/b.txt', 2048, 100), row('root/top.txt', 5, 200)]),
    })
    await flushPromises()
    const rows = w.findAll('[data-testid="result-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('top.txt')
    expect(rows[1]!.text()).toContain('b.txt')
    expect(rows[1]!.text()).toContain('2.0 KB')
    expect(rows[1]!.find('.search-dialog__path').text()).toBe('a/')
    expect(rows[1]!.find('.search-dialog__path').attributes('title')).toBe('root/a/b.txt')
    expect(w.find('[data-testid="index-count"]').text()).toBe('2')
    w.unmount()
  })

  it('行操作：打开=emit open{key}、定位目录=emit locate{key}；双击行=打开', async () => {
    const { w } = mountDialog({
      store: await seededStore([row('root/a/b.txt', 1), row('root/c.txt', 2)]),
    })
    await flushPromises()
    const rows = w.findAll('[data-testid="result-row"]')
    await rows[0]!.find('[data-testid="row-open"]').trigger('click')
    expect(w.emitted('open')?.[0]?.[0]).toEqual({ key: 'root/a/b.txt' })
    await rows[0]!.find('[data-testid="row-locate"]').trigger('click')
    expect(w.emitted('locate')?.[0]?.[0]).toEqual({ key: 'root/a/b.txt' })
    await rows[1]!.trigger('dblclick')
    expect(w.emitted('open')?.[1]?.[0]).toEqual({ key: 'root/c.txt' })
    w.unmount()
  })

  it('搜索框实时过滤（无通配=包含匹配）；无命中出空态（search.empty）；清空恢复', async () => {
    const { w } = mountDialog({
      store: await seededStore([row('root/a.txt', 1), row('root/b.txt', 1), row('root/sub/c.pdf', 1)]),
    })
    await flushPromises()
    const input = w.find<HTMLInputElement>('.search-dialog__query input')
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(3)
    await input.setValue('c.p')
    await flushPromises() // search 异步落库后再断言 DOM
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(1)
    await input.setValue('zzz')
    await flushPromises()
    expect(w.find('[data-testid="empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="empty"]').text()).toContain('search.empty')
    await input.setValue('')
    await flushPromises()
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(3)
    expect(w.find('[data-testid="empty"]').exists()).toBe(false)
    w.unmount()
  })

  it('glob 通配在搜索框可用：*.pdf 命中扩展名', async () => {
    const { w } = mountDialog({
      store: await seededStore([row('root/a.pdf', 1), row('root/b.txt', 1), row('root/c.pdf', 1)]),
    })
    await flushPromises()
    await w.find<HTMLInputElement>('.search-dialog__query input').setValue('*.pdf')
    await flushPromises()
    const names = w.findAll('[data-testid="result-row"]').map((r) => r.text())
    expect(names).toHaveLength(2)
    expect(names.join('|')).toContain('a.pdf')
    expect(names.join('|')).not.toContain('b.txt')
    w.unmount()
  })

  it('大小区间过滤：min/max 边界含等号，清空恢复不限制', async () => {
    const { w } = mountDialog({
      store: await seededStore([row('root/s.txt', 100), row('root/m.txt', 2000), row('root/l.txt', 5000)]),
    })
    await flushPromises()
    await w.find<HTMLInputElement>('[data-testid="size-min"]').setValue('2000')
    await flushPromises()
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(2) // 2000、5000
    await w.find<HTMLInputElement>('[data-testid="size-max"]').setValue('2000')
    await flushPromises()
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(1) // 2000（边界含等号）
    expect(w.find('[data-testid="result-row"]').text()).toContain('m.txt')
    await w.find<HTMLInputElement>('[data-testid="size-min"]').setValue('')
    await flushPromises()
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(2) // ≤2000
    await w.find<HTMLInputElement>('[data-testid="size-max"]').setValue('')
    await flushPromises()
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(3)
    w.unmount()
  })

  it('类型下拉过滤：按扩展名分类', async () => {
    const { w } = mountDialog({
      store: await seededStore([
        row('root/img.png', 1),
        row('root/clip.mp4', 1),
        row('root/doc.pdf', 1),
      ]),
    })
    await flushPromises()
    await w.find<HTMLSelectElement>('[data-testid="type"]').setValue('image')
    await flushPromises()
    const rows = w.findAll('[data-testid="result-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('img.png')
    await w.find<HTMLSelectElement>('[data-testid="type"]').setValue('')
    await flushPromises()
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(3)
    w.unmount()
  })

  it('扫描：gate 挂起期间按钮禁用+重复触发不发出第二次请求+进度可见；完成后入库/toast/结果刷新', async () => {
    const client = new FakeListClient()
    client.pageSize = 2 // 3 个对象 → 2 页，验证翻页聚合
    client.objects.set('root/1.txt', { size: 1 })
    client.objects.set('root/2.txt', { size: 2 })
    client.objects.set('root/3.txt', { size: 3 })
    let release!: () => void
    client.gate = new Promise<void>((r) => { release = r })
    const { w, store } = mountDialog({ client })
    await flushPromises()
    expect(w.find('[data-testid="result-list"]').exists()).toBe(false) // 扫前无结果

    await w.find('[data-testid="scan"]').trigger('click')
    expect(client.calls).toBe(1) // 首页已发出
    expect(w.find('[data-testid="scan"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="scan-progress"]').exists()).toBe(true)
    expect(w.find('[data-testid="scan-progress"]').text()).toBe('0')

    const callsAtGate = client.calls
    await w.find('[data-testid="scan"]').trigger('click') // 禁用+重入兜底
    expect(client.calls).toBe(callsAtGate)

    release()
    await flushPromises()
    expect(await store.count()).toBe(3)
    expect(client.calls).toBe(2) // 翻页聚合到尽
    expect(toastSpies.success).toHaveBeenCalledTimes(1)
    expect(String(toastSpies.success.mock.calls[0]?.[0])).toContain('search.scan-done')
    expect(w.findAll('[data-testid="result-row"]')).toHaveLength(3)
    expect(w.find('[data-testid="scan-progress"]').exists()).toBe(false) // 进度条随扫描结束隐去
    expect(w.find('[data-testid="scan"]').attributes('disabled')).toBeUndefined() // 状态复位可再扫
    expect(w.find('[data-testid="index-count"]').text()).toBe('3')
    w.unmount()
  })

  it('扫描失败：toast.error（消息原文）+ 状态复位可重试，不误报 scan-done', async () => {
    const client = new FakeListClient()
    client.fail = true
    const { w } = mountDialog({ client })
    await flushPromises()
    await w.find('[data-testid="scan"]').trigger('click')
    await flushPromises()
    expect(toastSpies.error).toHaveBeenCalledTimes(1)
    expect(toastSpies.success).not.toHaveBeenCalled()
    expect(w.find('[data-testid="scan"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-testid="result-list"]').exists()).toBe(false)
    w.unmount()
  })

  it('关闭透传：el-dialog update:modelValue → emit update:open(false)', async () => {
    const { w } = mountDialog()
    await flushPromises()
    const dialog = w.findComponent({ name: 'ElDialog' })
    expect(dialog.exists()).toBe(true)
    ;(dialog.vm as unknown as { $emit: (e: string, v: boolean) => void }).$emit('update:modelValue', false)
    await flushPromises()
    expect(w.emitted('update:open')?.[0]).toEqual([false])
    w.unmount()
  })

  // R2-14：时间列按 i18n locale 短格式（date+time），不再走浏览器缺省 locale
  it('时间列按 i18n locale 格式化：zh-CN 短格式 + en-US 短格式随 locale 切换', async () => {
    // setup.ts 的全局 i18n 实例（locale 默认 zh-CN）；经 config.global.plugins 取回
    const i18nPlugin = config.global.plugins?.[0] as { global: { locale: { value: string } } } | undefined
    expect(i18nPlugin?.global?.locale).toBeDefined()
    const lastModified = new Date(2026, 8, 1, 8, 0, 0).getTime() // 2026-09-01 08:00 本地时区
    try {
      i18nPlugin!.global.locale.value = 'zh-CN'
      const { w } = mountDialog({ store: await seededStore([row('root/a.txt', 1, lastModified)]) })
      await flushPromises()
      const zhTime = w.find('.search-dialog__time').text()
      expect(zhTime).toMatch(/2026\/9\/1/)
      expect(zhTime).toContain('08:00')
      w.unmount()

      i18nPlugin!.global.locale.value = 'en-US'
      const { w: w2 } = mountDialog({ store: await seededStore([row('root/a.txt', 1, lastModified)]) })
      await flushPromises()
      const enTime = w2.find('.search-dialog__time').text()
      expect(enTime).toMatch(/9\/1\/26/)
      expect(enTime).toContain('AM')
      w2.unmount()
    } finally {
      i18nPlugin!.global.locale.value = 'zh-CN'
    }
  })
})
