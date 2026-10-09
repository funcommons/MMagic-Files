/**
 * setupWorkspace 装配测试（Wave2-T2）
 * 覆盖：file 模式 null / workspace 构造链（client 收 backend、tree 根=prefix、queue 收 params）/
 * 模块级单例 / bus.emit 透传（fileChanged 与 upload*）/ 拒收参数接线（denyExts、uploadMaxBytes）；
 * Lane F3：calibrateClock 接缝（包装 fetcher 注入、响应透传、best-effort 吞错）。
 * S3SigV4Client 经 vi.mock 换内存 Fake（不触网）；bus 以 { emit: spy } 最小形状注入。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendConfig, S3Client, WorkspaceConfig } from '@/sdk/types'
import type { BootHandle } from '@/boot'
// mock 后的假类（下方 vi.mock 工厂注入；取静态 instances 与实例上的 calibrate 记录）
import { S3SigV4Client } from '@/sdk/s3/client'
import { resetWorkspaceSetup, setupWorkspace } from '../setup'
import { UploadQueue } from '../upload-queue'

vi.mock('@/sdk/s3/client', () => {
  class FakeS3Client implements S3Client {
    static instances: Array<{ config: unknown }> = []
    readonly config: unknown
    /** Lane F3：记录经包装 fetcher 喂进来的响应（校准接缝） */
    calibrateCalls: Response[] = []
    /** 构造注入的 fetcher（真实类用它取 Response 喂 calibrateClock） */
    readonly fetcher: unknown
    constructor(config: unknown, fetcher: unknown = undefined) {
      this.config = config
      this.fetcher = fetcher
      FakeS3Client.instances.push(this)
    }
    /** x-boom 头模拟校准抛错（验证 best-effort 不影响请求） */
    calibrateClock(res: Response): void {
      this.calibrateCalls.push(res)
      if (res.headers.get('x-boom')) throw new Error('boom')
    }
    async list() {
      return { prefix: '', dirs: [], files: [] }
    }
    async put() {
      return { etag: 'fake-etag' }
    }
    async get() {
      return new Response('', { status: 404 })
    }
    async head() {
      return { exists: false }
    }
    async copy() {}
    async remove() {}
    async createMultipart() {
      return { uploadId: 'u-1' }
    }
    async uploadPart() {
      return { etag: 'p-1' }
    }
    async completeMultipart() {}
    async abortMultipart() {}
  }
  return { S3SigV4Client: FakeS3Client }
})

const backend: BackendConfig = {
  endpoint: 'https://s3.test',
  region: 'test-1',
  bucket: 'bkt',
  prefix: 'sessions/abc/',
  credentials: { accessKeyId: 'ak', accessKeySecret: 'sk', sessionToken: 'tok' },
}

function workspaceHandle(over: Partial<WorkspaceConfig> = {}): { handle: BootHandle; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn()
  const handle = {
    config: {
      mode: 'workspace',
      v: 1,
      backend,
      security: { allowedOrigins: ['https://host.test'] },
      ...over,
    },
    bus: { emit },
  } as unknown as BootHandle
  return { handle, emit }
}

function fakeClients(): Array<{ config: unknown }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (S3SigV4Client as any).instances as Array<{ config: unknown }>
}

describe('setupWorkspace', () => {
  beforeEach(() => resetWorkspaceSetup())

  it('file 模式返回 null（不构造 client/queue）', () => {
    const handle = {
      config: { mode: 'file', v: 1, source: { url: 'https://x.test/a.txt' } },
      bus: { emit: vi.fn() },
    } as unknown as BootHandle
    expect(setupWorkspace(handle)).toBeNull()
    expect(fakeClients()).toHaveLength(0)
  })

  it('workspace 构造链：client 收 backend / tree 根=prefix / queue 为 UploadQueue', () => {
    const { handle } = workspaceHandle()
    const ws = setupWorkspace(handle)
    if (!ws) throw new Error('workspace 装配应成功')
    expect(fakeClients()).toHaveLength(1)
    expect(fakeClients()[0]?.config).toBe(backend)
    expect(ws.tree.currentPath).toBe('sessions/abc/')
    expect(ws.queue).toBeInstanceOf(UploadQueue)
  })

  it('模块级单例：重复调用返回同一实例', () => {
    const first = workspaceHandle()
    const second = workspaceHandle()
    const a = setupWorkspace(first.handle)
    expect(a).not.toBeNull()
    expect(setupWorkspace(second.handle)).toBe(a)
  })

  it('onFileChanged 透传 bus.emit(fileChanged)', async () => {
    const { handle, emit } = workspaceHandle()
    const ws = setupWorkspace(handle)
    if (!ws) throw new Error('workspace 装配应成功')
    await ws.tree.mkdir('sessions/abc/', 'sub')
    expect(emit).toHaveBeenCalledWith('fileChanged', { key: 'sessions/abc/sub/', action: 'put' })
  })

  it('queue params 接线：denyExts 与 uploadMaxBytes 拒收', () => {
    const { handle } = workspaceHandle({ params: { uploadMaxBytes: 10 }, permissions: { denyExts: ['exe'] } })
    const ws = setupWorkspace(handle)
    if (!ws) throw new Error('workspace 装配应成功')
    expect(ws.queue.enqueue([new File(['x'], 'a.exe')]).rejected).toEqual([{ name: 'a.exe', reason: 'ext' }])
    expect(ws.queue.enqueue([new File(['12345678901'], 'big.txt')]).rejected).toEqual([
      { name: 'big.txt', reason: 'size' },
    ])
  })

  it('upload hooks 透传 bus.emit(uploadDone)', async () => {
    const { handle, emit } = workspaceHandle()
    const ws = setupWorkspace(handle)
    if (!ws) throw new Error('workspace 装配应成功')
    const r = ws.queue.enqueue([new File(['hello'], 'ok.txt')])
    expect(r.accepted).toHaveLength(1)
    expect(r.rejected).toHaveLength(0)
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith('uploadDone', { id: r.accepted[0]?.id, key: 'ok.txt' })
    })
  })

  // F6：上传终态接树刷新——uploadDone 后强拉当前目录（force 绕缓存），新文件免手动刷新即可见
  it('上传完成后自动强刷当前目录（loadDir force，当前目录 bucket 置为 loaded）', async () => {
    const { handle, emit } = workspaceHandle()
    const ws = setupWorkspace(handle)
    if (!ws) throw new Error('workspace 装配应成功')
    expect(ws.tree.nodes.get('sessions/abc/')?.loaded ?? false).toBe(false)

    const r = ws.queue.enqueue([new File(['hello'], 'ok.txt')])
    expect(r.accepted).toHaveLength(1)
    await vi.waitFor(() => {
      expect(ws.tree.nodes.get('sessions/abc/')?.loaded).toBe(true)
    })
    // 刷新发生在 uploadDone 透出之后（事件顺序契约：宿主先收 uploadDone，树刷新不抢占）
    expect(emit).toHaveBeenCalledWith('uploadDone', { id: r.accepted[0]?.id, key: 'ok.txt' })
    // 不劫持树导航：currentPath 保持不变
    expect(ws.tree.currentPath).toBe('sessions/abc/')
  })

  // ── Lane F3：calibrateClock 接线（审计：该方法曾为死代码） ──

  it('时钟校准接线：构造注入包装 fetcher，响应透传并喂给 calibrateClock（§4.3）', async () => {
    const { handle } = workspaceHandle()
    const ws = setupWorkspace(handle)
    if (!ws) throw new Error('workspace 装配应成功')
    // instances 随用例累积，取最新（resetWorkspaceSetup 只清单例，不清 mock 静态表）
    const latest = fakeClients()[fakeClients().length - 1]
    const inst = latest as unknown as { fetcher: unknown; calibrateCalls: Response[] }
    expect(typeof inst.fetcher).toBe('function')
    const res = new Response('', { status: 200, headers: { date: 'Fri, 09 Oct 2026 00:00:00 GMT' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res)
    try {
      const fetcher = inst.fetcher as (url: string, init?: RequestInit) => Promise<Response>
      await expect(fetcher('https://s3.test/bkt', { method: 'GET' })).resolves.toBe(res)
      expect(inst.calibrateCalls).toEqual([res])
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('时钟校准 best-effort：calibrateClock 抛错不拦截响应透传', async () => {
    const { handle } = workspaceHandle()
    const ws = setupWorkspace(handle)
    if (!ws) throw new Error('workspace 装配应成功')
    const inst = fakeClients()[fakeClients().length - 1] as unknown as {
      fetcher: unknown
      calibrateCalls: Response[]
    }
    const res = new Response('', { status: 200, headers: { 'x-boom': '1' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(res)
    try {
      const fetcher = inst.fetcher as (url: string, init?: RequestInit) => Promise<Response>
      await expect(fetcher('https://s3.test/bkt', { method: 'GET' })).resolves.toBe(res)
      expect(inst.calibrateCalls).toHaveLength(1)
    } finally {
      fetchMock.mockRestore()
    }
  })
})
