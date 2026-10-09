/**
 * ConnectWizard 组件级单测（Lane G5）。
 * - FcDialog 内容 teleport 到 body：断言统一查 document.body（挂载 attachTo + nextTick 冲刷）
 * - 存储注入 memoryStorage（profiles 与 raw 备份共用一个键空间隔离的内存库）；
 *   reload / clientFactory 注入 spy——不触真实 location.reload 与真实网络
 * - 连接路径金样例：persist 落盘的 raw 以 '#config='+encodeURIComponent 开头，且能被既有
 *   parseAppConfig 消费（= reload 后 boot restore 链成立）；凭据不进 URL（hash 保持空）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import ConnectWizard from '../ui/ConnectWizard.vue'
import { PROFILES_STORAGE_KEY, createProfile } from '../profiles'
import type { S3Profile } from '../profiles'
import { RAW_CONFIG_STORAGE_KEY, parseAppConfig } from '@/sdk/config'
import type { BackendConfig, WorkspaceConfig } from '@/sdk/types'

/** 内存 Storage stub（与 profiles.test.ts 同形） */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await nextTick()
}
const q = (sel: string): HTMLElement => document.body.querySelector(sel) as HTMLElement
const exists = (sel: string): boolean => document.body.querySelector(sel) !== null
const textOf = (sel: string): string => document.body.querySelector(sel)?.textContent ?? ''

/** data-testid 落点自适应：EP el-input 把 $attrs 透传到原生 input，其余组件落在包装元素 */
function inputOf(testid: string): HTMLInputElement {
  const el = document.body.querySelector(`[data-testid="${testid}"]`)
  if (el instanceof HTMLInputElement) return el
  const inner = el?.querySelector('input')
  if (inner instanceof HTMLInputElement) return inner
  throw new Error(`input not found: ${testid}`)
}

/** el-input 设值（native input 事件驱动 v-model） */
async function setField(testid: string, value: string): Promise<void> {
  const el = inputOf(testid)
  el.value = value
  el.dispatchEvent(new Event('input'))
  await nextTick()
}

/** 触发带 data-testid 元素上的原生 click（沿冒泡路径命中 Vue 监听） */
async function clickAt(testid: string): Promise<void> {
  q(testid.startsWith('data-') ? `[${testid}]` : `[data-testid="${testid}"]`)?.dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  )
  await nextTick()
}

const VALID = {
  name: '本地 MinIO',
  endpoint: 'https://minio.example.com',
  region: 'us-east-1',
  bucket: 'files',
  accessKeyId: 'ak-1',
  secretAccessKey: 'sk-2',
  prefix: 'docs/',
}
async function fillValidForm(over: Partial<typeof VALID> = {}): Promise<void> {
  const v = { ...VALID, ...over }
  await setField('f-name', v.name)
  await setField('f-endpoint', v.endpoint)
  await setField('f-region', v.region)
  await setField('f-bucket', v.bucket)
  await setField('f-access-key', v.accessKeyId)
  await setField('f-secret-key', v.secretAccessKey)
  await setField('f-prefix', v.prefix)
}

let store: Storage
let reload: ReturnType<typeof vi.fn<() => void>>

async function mountWizard(extra: Record<string, unknown> = {}): Promise<VueWrapper> {
  const w = mount(ConnectWizard, {
    props: { open: true, storageFactory: () => store, reload, ...extra },
    attachTo: document.body,
  })
  await flush()
  return w
}

beforeEach(() => {
  document.body.innerHTML = ''
  store = memoryStorage()
  reload = vi.fn()
})

describe('ConnectWizard 渲染', () => {
  it('open=true 渲染标题/副标题/表单/操作钮与常驻明文警示条', async () => {
    const w = await mountWizard()
    expect(document.body.textContent).toContain('wizard.title')
    expect(document.body.textContent).toContain('wizard.subtitle')
    for (const id of ['f-name', 'f-endpoint', 'f-region', 'f-bucket', 'f-access-key', 'f-secret-key', 'f-prefix', 'f-path-style', 'f-ttl']) {
      expect(exists(`[data-testid="${id}"]`)).toBe(true)
    }
    expect(exists('[data-testid="btn-test"]')).toBe(true)
    expect(exists('[data-testid="btn-connect"]')).toBe(true)
    expect(exists('[data-testid="btn-save"]')).toBe(true)
    expect(textOf('[data-testid="plaintext-warn"]')).toContain('wizard.plaintext-warn')
    w.unmount()
  })
})

describe('表单校验与连接路径', () => {
  it('空表单连接：form-errors 可见；不 persist、不 reload、不建 client', async () => {
    const clientFactory = vi.fn(() => ({ list: vi.fn() }))
    const w = await mountWizard({ clientFactory })
    await clickAt('btn-connect')
    expect(exists('[data-testid="form-errors"]')).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    expect(store.getItem(RAW_CONFIG_STORAGE_KEY)).toBeNull()
    expect(clientFactory).not.toHaveBeenCalled()
    w.unmount()
  })

  it('连接：persist raw=#config=+encodeURIComponent 且 parseAppConfig 可消费；reload 被调；凭据不进 URL', async () => {
    const before = Date.now()
    const w = await mountWizard()
    await fillValidForm()
    await clickAt('btn-connect')

    expect(reload).toHaveBeenCalledTimes(1)
    const recordText = store.getItem(RAW_CONFIG_STORAGE_KEY)
    expect(recordText).not.toBeNull()
    const record = JSON.parse(recordText!) as { raw: string; exp: number }
    expect(record.raw.startsWith('#config=')).toBe(true)

    // raw 前缀 '#config='+encodeURIComponent：解码还原即配置对象，且既有校验链直接通过
    const decoded = JSON.parse(decodeURIComponent(record.raw.slice('#config='.length))) as WorkspaceConfig
    expect(decoded.v).toBe(1)
    expect(decoded.mode).toBe('workspace')
    expect(decoded.backend.endpoint).toBe('https://minio.example.com')
    expect(decoded.backend.prefix).toBe('docs/')
    expect(decoded.backend.credentials).toMatchObject({ accessKeyId: 'ak-1', accessKeySecret: 'sk-2' })
    expect(decoded.security.allowedOrigins).toEqual([window.location.origin])
    const parsed = parseAppConfig(record.raw)
    expect(parsed.mode).toBe('workspace')

    // 备份寿命对齐 ttl：默认 3600 分钟 → ttlSeconds 截断 86400 → exp≈now+24h
    expect((parsed as WorkspaceConfig).backend.ttlSeconds).toBe(86400)
    expect(record.exp - before).toBeGreaterThanOrEqual(86400_000 - 1000)
    expect(record.exp - before).toBeLessThanOrEqual(86400_000 + 1000)

    // 核心理由断言：凭据只进 sessionStorage 备份，不写 URL/历史（hash 保持空）
    expect(window.location.hash).toBe('')
    // 连接不自动保存 profile（保存是显式动作）
    expect(store.getItem(PROFILES_STORAGE_KEY)).toBeNull()
    w.unmount()
  })

  it('ttl 分钟换算：30 分钟 → ttlSeconds 1800；巨大值 → 截断 86400（备份覆盖写新记录）', async () => {
    const w = await mountWizard()
    await fillValidForm()
    await setField('f-ttl', '30')
    await clickAt('btn-connect')
    let record = JSON.parse(store.getItem(RAW_CONFIG_STORAGE_KEY)!) as { raw: string }
    let parsed = parseAppConfig(record.raw) as WorkspaceConfig
    expect(parsed.backend.ttlSeconds).toBe(1800)

    await setField('f-ttl', '525600')
    await clickAt('btn-connect')
    record = JSON.parse(store.getItem(RAW_CONFIG_STORAGE_KEY)!) as { raw: string }
    parsed = parseAppConfig(record.raw) as WorkspaceConfig
    expect(parsed.backend.ttlSeconds).toBe(86400)
    w.unmount()
  })

  it('pathStyle 开关：开后 backend 携 pathStyle:true（未知键由解析层原样保留），关则不携带', async () => {
    const w = await mountWizard()
    await fillValidForm()
    await q('[data-testid="f-path-style"] button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    await clickAt('btn-connect')
    let raw = (JSON.parse(store.getItem(RAW_CONFIG_STORAGE_KEY)!) as { raw: string }).raw
    expect((JSON.parse(decodeURIComponent(raw.slice('#config='.length))) as { backend: Record<string, unknown> }).backend.pathStyle).toBe(true)

    // 复原再连：键不携带
    await q('[data-testid="f-path-style"] button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    await clickAt('btn-connect')
    raw = (JSON.parse(store.getItem(RAW_CONFIG_STORAGE_KEY)!) as { raw: string }).raw
    expect((JSON.parse(decodeURIComponent(raw.slice('#config='.length))) as { backend: Record<string, unknown> }).backend.pathStyle).toBeUndefined()
    w.unmount()
  })
})

describe('测试连接', () => {
  it('成功：clientFactory 收到真实 backend（sessionToken 为空串=AK/SK 形态）；list(prefix,{delimiter:/}) 一次成功即 OK', async () => {
    const list = vi.fn(async () => ({ dirs: [], files: [] }))
    const clientFactory = vi.fn((backend: BackendConfig) => ({ list, backend }))
    const w = await mountWizard({ clientFactory })
    await fillValidForm()
    await clickAt('btn-test')
    await flush()

    expect(clientFactory).toHaveBeenCalledTimes(1)
    const backend = clientFactory.mock.calls[0]![0] as BackendConfig
    expect(backend).toMatchObject({
      endpoint: 'https://minio.example.com',
      region: 'us-east-1',
      bucket: 'files',
      prefix: 'docs/',
      credentials: { accessKeyId: 'ak-1', accessKeySecret: 'sk-2', sessionToken: '' },
    })
    expect(list).toHaveBeenCalledWith('docs/', { delimiter: '/' })
    expect(textOf('[data-testid="test-ok"]')).toContain('wizard.test-ok')
    expect(exists('[data-testid="test-fail"]')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    w.unmount()
  })

  it('失败：test-fail 提示携带错误 message；不 persist 不 reload', async () => {
    const list = vi.fn(async () => {
      throw new Error('HTTP 403（SignatureDoesNotMatch）')
    })
    const w = await mountWizard({ clientFactory: () => ({ list }) })
    await fillValidForm()
    await clickAt('btn-test')
    await flush()

    const fail = textOf('[data-testid="test-fail"]')
    expect(fail).toContain('wizard.test-fail')
    expect(fail).toContain('HTTP 403（SignatureDoesNotMatch）')
    expect(store.getItem(RAW_CONFIG_STORAGE_KEY)).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    w.unmount()
  })

  it('进行中 testing 禁重复：pending 期间二次点击不再建 client；结算后恢复可用', async () => {
    let resolveList: (v: { dirs: unknown[]; files: unknown[] }) => void = () => {}
    const list = vi.fn(
      () => new Promise<{ dirs: unknown[]; files: unknown[] }>((resolve) => { resolveList = resolve }),
    )
    const clientFactory = vi.fn(() => ({ list }))
    const w = await mountWizard({ clientFactory })
    await fillValidForm()
    await clickAt('btn-test')
    await nextTick()
    await clickAt('btn-test') // testing 中：早退
    expect(clientFactory).toHaveBeenCalledTimes(1)
    resolveList({ dirs: [], files: [] })
    await flush()
    expect(textOf('[data-testid="test-ok"]')).toContain('wizard.test-ok')

    await clickAt('btn-test') // 结算后可再测
    await flush()
    expect(list).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('表单非法时测试连接：只出校验错误，不建 client', async () => {
    const clientFactory = vi.fn(() => ({ list: vi.fn() }))
    const w = await mountWizard({ clientFactory })
    await setField('f-name', '只有名字')
    await clickAt('btn-test')
    await flush()
    expect(exists('[data-testid="form-errors"]')).toBe(true)
    expect(clientFactory).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('Profile 侧栏与保存', () => {
  const p1 = (): S3Profile =>
    createProfile({ name: 'A', endpoint: 'https://a.example.com', region: 'r1', bucket: 'b1', accessKeyId: 'ak-a', secretAccessKey: 'sk-a', prefix: 'a/' })
  const p2 = (): S3Profile =>
    createProfile({ name: 'B', endpoint: 'https://b.example.com', region: 'r2', bucket: 'b2', accessKeyId: 'ak-b', secretAccessKey: 'sk-b' })

  it('列出已存配置；选用=回填表单；删除=移除并落盘', async () => {
    store.setItem(PROFILES_STORAGE_KEY, JSON.stringify([p1(), p2()]))
    const w = await mountWizard()
    let items = document.body.querySelectorAll('[data-testid="profile-item"]')
    expect(items.length).toBe(2)

    // 选用 A：表单回填（编辑态）
    ;(items[0] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(inputOf('f-endpoint').value).toBe('https://a.example.com')
    expect(inputOf('f-name').value).toBe('A')

    // 删除 A：列表与落盘同步收敛
    q('[data-testid="profile-item"] [data-testid="profile-delete"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    items = document.body.querySelectorAll('[data-testid="profile-item"]')
    expect(items.length).toBe(1)
    const kept = JSON.parse(store.getItem(PROFILES_STORAGE_KEY)!) as S3Profile[]
    expect(kept).toHaveLength(1)
    expect(kept[0]?.name).toBe('B')
    w.unmount()
  })

  it('空库渲染空态占位', async () => {
    const w = await mountWizard()
    expect(exists('[data-testid="profile-empty"]')).toBe(true)
    w.unmount()
  })

  it('保存配置：落盘（id/createdAt 由 createProfile 填充）；二次保存=更新不重复；坏表单拒存', async () => {
    const w = await mountWizard()
    await fillValidForm()
    await clickAt('btn-save')
    await flush()
    let saved = JSON.parse(store.getItem(PROFILES_STORAGE_KEY)!) as S3Profile[]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ name: '本地 MinIO', endpoint: 'https://minio.example.com', prefix: 'docs/' })
    expect(saved[0]?.id).toBeTruthy()
    expect(saved[0]?.createdAt).toBeGreaterThan(0)

    // 保存后进入编辑态：改名再存=更新同一条
    await setField('f-name', '改名')
    await clickAt('btn-save')
    await flush()
    saved = JSON.parse(store.getItem(PROFILES_STORAGE_KEY)!) as S3Profile[]
    expect(saved).toHaveLength(1)
    expect(saved[0]?.name).toBe('改名')

    // 坏表单（清空 endpoint）：拒存且列表不变
    await setField('f-endpoint', '')
    await clickAt('btn-save')
    await flush()
    expect(exists('[data-testid="form-errors"]')).toBe(true)
    expect((JSON.parse(store.getItem(PROFILES_STORAGE_KEY)!) as S3Profile[]).length).toBe(1)
    w.unmount()
  })
})
