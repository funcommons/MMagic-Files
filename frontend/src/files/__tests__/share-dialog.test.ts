/**
 * ShareDialog 组件测试（Lane H-2）：fake client 注入（结构类型面向 S3Client，不依赖实现单例）。
 * 覆盖：打开渲染（标题/条目名/有效期三档/生成钮）、生成（GET/PUT 两行只读链接 + client 调参）、
 * 换有效期清空旧链接、无 presign 能力 client → 禁用态、目录条目 → 禁用态、
 * 复制成功 toast（clipboard API）/降级 execCommand、open=false 不渲染、关闭透传 update:open。
 * toast 以模块 mock 收口（断言 share.copied 键）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { FcDialog } from '@/components/sdk'
import type { S3Client, S3ObjectSummary } from '@/sdk/types'
import ShareDialog from '../ui/ShareDialog.vue'

const { toastSpies } = vi.hoisted(() => ({
  toastSpies: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

// 只换 toast（share.copied 断言口），组件库其余导出保持原实现
vi.mock('@/components/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/sdk')>()
  return { ...actual, toast: toastSpies as unknown as typeof actual.toast }
})

const fileEntry = (over: Partial<S3ObjectSummary> = {}): S3ObjectSummary => ({
  key: 'root/a/report.pdf',
  name: 'report.pdf',
  size: 1024,
  isDir: false,
  ...over,
})

/** 双预签名 fake：链接形态含 method 标记，便于断言 GET/PUT 两行走线 */
function makePresignClient(): S3Client {
  return {
    getPresignedUrl: vi.fn((key: string, expiresSec?: number) => `https://s3.test/get/${key}?expires=${String(expiresSec)}&m=get`),
    presignPutUrl: vi.fn((key: string, expiresSec?: number) => `https://s3.test/put/${key}?expires=${String(expiresSec)}&m=put`),
  } as unknown as S3Client
}

/** 无预签名能力 fake（S3Client 其余方法为必需面，最小桩补齐） */
function makePlainClient(): S3Client {
  return { list: vi.fn(), get: vi.fn(), put: vi.fn() } as unknown as S3Client
}

function mountDialog(opts: { client?: S3Client; entry?: S3ObjectSummary | null; open?: boolean } = {}) {
  const w: VueWrapper = mount(ShareDialog, {
    props: {
      client: opts.client ?? makePresignClient(),
      entry: opts.entry !== undefined ? opts.entry : fileEntry(),
      ...(opts.open === undefined ? {} : { open: opts.open }),
    },
  })
  return w
}

const body = (w: VueWrapper) => w.find('[data-testid="share-dialog"]')

afterEach(() => {
  vi.clearAllMocks()
  delete (window.navigator as { clipboard?: unknown }).clipboard
  // 降级用例给 document 挂的 execCommand 假体撤掉（configurable 定义可删）
  delete (document as unknown as { execCommand?: unknown }).execCommand
})

describe('ShareDialog', () => {
  it('打开渲染：标题/条目名/有效期三档（1h/24h/7d）/生成钮可用；未生成无链接行', async () => {
    const w = mountDialog()
    await flushPromises()
    expect(body(w).exists()).toBe(true)
    expect(w.text()).toContain('share.title')
    expect(w.text()).toContain('report.pdf')
    const labels = w.findAll('.share-dialog__opt').map((l) => l.text())
    expect(labels).toEqual(['share.expiry-h', 'share.expiry-d', 'share.expiry-d'])
    expect(body(w).find('[data-testid="share-generate"]').attributes('disabled')).toBeUndefined()
    expect(body(w).find('[data-testid="share-get-url"]').exists()).toBe(false)
    expect(body(w).find('[data-testid="share-put-url"]').exists()).toBe(false)
    w.unmount()
  })

  it('生成：GET/PUT 两行只读链接 + client 以当前有效期调用；默认 1h', async () => {
    const client = makePresignClient()
    const w = mountDialog({ client })
    await flushPromises()
    await body(w).find('[data-testid="share-generate"]').trigger('click')
    expect(client.getPresignedUrl).toHaveBeenCalledWith('root/a/report.pdf', 3600)
    expect(client.presignPutUrl).toHaveBeenCalledWith('root/a/report.pdf', 3600)
    const get = body(w).find('[data-testid="share-get-url"]')
    const put = body(w).find('[data-testid="share-put-url"]')
    expect((get.element as HTMLInputElement).value).toContain('m=get')
    expect((get.element as HTMLInputElement).readOnly).toBe(true)
    expect((put.element as HTMLInputElement).value).toContain('m=put')
    w.unmount()
  })

  it('换有效期清空旧链接；再生成按新有效期调 client（7d=604800）', async () => {
    const client = makePresignClient()
    const w = mountDialog({ client })
    await flushPromises()
    await body(w).find('[data-testid="share-generate"]').trigger('click')
    expect(body(w).find('[data-testid="share-get-url"]').exists()).toBe(true)

    const radios = body(w).findAll('input[type="radio"]')
    await radios[2]!.setValue() // 7 天档
    expect(body(w).find('[data-testid="share-get-url"]').exists()).toBe(false) // 旧链接清空
    await body(w).find('[data-testid="share-generate"]').trigger('click')
    expect(client.getPresignedUrl).toHaveBeenLastCalledWith('root/a/report.pdf', 604_800)
    expect(client.presignPutUrl).toHaveBeenLastCalledWith('root/a/report.pdf', 604_800)
    expect((body(w).find('[data-testid="share-get-url"]').element as HTMLInputElement).value).toContain('expires=604800')
    w.unmount()
  })

  it('client 无 presign 能力 → 生成钮/有效期禁用（禁用态，不产生链接）', async () => {
    const w = mountDialog({ client: makePlainClient() })
    await flushPromises()
    expect(body(w).find('[data-testid="share-generate"]').attributes('disabled')).toBeDefined()
    for (const radio of body(w).findAll('input[type="radio"]')) {
      expect(radio.attributes('disabled')).toBeDefined()
    }
    await body(w).find('[data-testid="share-generate"]').trigger('click') // 禁用态点按不产生链接
    expect(body(w).find('[data-testid="share-get-url"]').exists()).toBe(false)
    w.unmount()
  })

  it('目录条目 → 禁用态（前缀分享列 P2，简化口径不给分享）', async () => {
    const w = mountDialog({ entry: { key: 'root/a/', name: 'a', size: 0, isDir: true } })
    await flushPromises()
    expect(body(w).find('[data-testid="share-generate"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('复制成功：clipboard.writeText 收到链接，toast share.copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = mountDialog()
    await flushPromises()
    await body(w).find('[data-testid="share-generate"]').trigger('click')
    await body(w).find('[data-testid="share-copy-get"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('m=get'))
    expect(toastSpies.success).toHaveBeenCalledWith('share.copied')
    w.unmount()
  })

  it('clipboard 不可用 → 降级 document.execCommand（注释口径：废弃 API 仅作兜底），成功仍 toast', async () => {
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => true), configurable: true, writable: true })
    const w = mountDialog()
    await flushPromises()
    await body(w).find('[data-testid="share-generate"]').trigger('click')
    await body(w).find('[data-testid="share-copy-put"]').trigger('click')
    await flushPromises()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(toastSpies.success).toHaveBeenCalledWith('share.copied')
    w.unmount()
  })

  it('open=false：不渲染对话框内容；FcDialog 关闭转发 update:open(false)', async () => {
    const w = mountDialog({ open: false })
    await flushPromises()
    expect(body(w).exists()).toBe(false)
    w.unmount()

    const w2 = mountDialog({ open: true })
    await flushPromises()
    // 关闭链本身归 FcDialog（SDK 自测覆盖）：此处断言 ShareDialog 对 update:open 的转发缝
    w2.findComponent(FcDialog).vm.$emit('update:open', false)
    await flushPromises()
    const all = w2.emitted('update:open') ?? []
    expect(all[all.length - 1]?.[0]).toBe(false)
    w2.unmount()
  })
})
