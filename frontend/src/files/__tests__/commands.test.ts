/**
 * M1 命令接线测试（Wave2-A10 + Lane F4 命令语义补齐）：joinKey / createM1Overrides
 * （navigate/createFolder/rename/remove/uploadFiles/download）/ createUploadHooks /
 * createUploadProgressThrottle。
 * 隔离策略：vi.mock('@/utils/download')（triggerDownload spy）+ URL.createObjectURL stub
 * （jsdom 未实现）+ 手写 Fake（tree/queue/client/emit），不依赖真实 S3Client / pinia。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import { triggerDownload } from '@/utils/download'
import type { EventName, S3Client } from '@/sdk/types'
import type { DirBucket, FileTreeController } from '@/files/tree-store'
import type { EnqueueResult, UploadQueue } from '@/files/upload-queue'
import { createM1Overrides, createUploadHooks, createUploadProgressThrottle, joinKey } from '@/files/commands'
import type { M1OverridesDeps } from '@/files/commands'

vi.mock('@/utils/download', () => ({ triggerDownload: vi.fn() }))

/** 排空微任务（download 的异步取流链全在微任务内，一个宏任务兜底足够） */
const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0) })

/**
 * 断言抛 SdkError 且 code 匹配：handler 校验失败多为同步 throw（requireFeature/参数校验
 * 在返回 Promise 前），await run() 兼容同步 throw 与 rejection 两种形态。
 */
async function expectSdkError(run: () => unknown, code: number): Promise<void> {
  try {
    await run()
    expect.unreachable(`应抛出 SdkError(code=${code})`)
  } catch (e) {
    expect(e).toBeInstanceOf(SdkError)
    expect((e as SdkError).code).toBe(code)
  }
}

// ───────────────────────── 环境补丁 ─────────────────────────

/** jsdom 缺 URL.createObjectURL：stub 成可观测 spy（按调用次数返回稳定假 blob: URL） */
const createObjectURL = vi.fn((): string => `blob:mock-${createObjectURL.mock.calls.length}`)
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
    writable: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks() // 清调用记录；实现（createObjectURL 的模板）保留
  document.body.innerHTML = '' // F4：选择器用例会往 body 挂 <input type=file>，逐用例清场
})

afterAll(() => {
  vi.useRealTimers() // 节流用例用 fake timers，兜底还原避免泄漏到其他文件
})

// ───────────────────────── 手写 Fake ─────────────────────────

function makeTree(): FileTreeController {
  return {
    currentPath: '',
    loading: false,
    error: null,
    nodes: new Map<string, DirBucket>(),
    loadDir: vi.fn(() => Promise.resolve()),
    mkdir: vi.fn(() => Promise.resolve('sessions/abc/new/')),
    rename: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    applyChange: vi.fn(), // Lane F3 接口字段：本文件用例不涉及，补齐以满足 FileTreeController
  }
}

function makeQueue(): UploadQueue {
  return {
    enqueue: vi.fn((_files: File[]): EnqueueResult => ({ accepted: [], rejected: [] })),
  } as unknown as UploadQueue
}

/** 只实现 get 的 Response 形状（jsdom 下直接 new Response 不保证可用） */
const fakeRes = (blob: Blob = new Blob(['x'])): Response =>
  ({ blob: () => Promise.resolve(blob) }) as Response

function makeClient(): S3Client {
  return {
    get: vi.fn((_key: string): Promise<Response> => Promise.resolve(fakeRes())),
  } as unknown as S3Client
}

const ALL_ON: Record<string, boolean> = {
  upload: true,
  delete: true,
  rename: true,
  mkdir: true,
  download: true,
}

interface Harness {
  tree: FileTreeController
  queue: UploadQueue
  client: S3Client
  emit: ReturnType<typeof vi.fn<(evt: EventName, payload: unknown) => void>>
  overrides: ReturnType<typeof createM1Overrides>
}

function setup(opts?: { rootPrefix?: string; features?: Record<string, boolean> }): Harness {
  const tree = makeTree()
  const queue = makeQueue()
  const client = makeClient()
  const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
  const deps: M1OverridesDeps = {
    tree,
    queue,
    client,
    rootPrefix: opts?.rootPrefix ?? '',
    features: opts?.features ?? { ...ALL_ON },
    emit,
  }
  return { tree, queue, client, emit, overrides: createM1Overrides(deps) }
}

// ───────────────────────── joinKey ─────────────────────────

describe('joinKey', () => {
  it("root='' + rel='a/b.txt' → 'a/b.txt'（bucket 根无前缀）", () => {
    expect(joinKey('', 'a/b.txt')).toBe('a/b.txt')
  })

  it("root='sessions/abc/' + rel='/x' → 'sessions/abc/x'（根尾斜杠保留、rel 前导斜杠剥除）", () => {
    expect(joinKey('sessions/abc/', '/x')).toBe('sessions/abc/x')
  })

  it("root 无尾斜杠规范化补 '/'：'sessions/abc' + 'x' → 'sessions/abc/x'", () => {
    expect(joinKey('sessions/abc', 'x')).toBe('sessions/abc/x')
  })
})

// ───────────────────────── navigate ─────────────────────────

describe('navigate', () => {
  it('loadDir(full,{force:true}) resolve 后才 emit pathChanged，reply {path:full}', async () => {
    const h = setup()
    let resolveLoad!: () => void
    vi.mocked(h.tree.loadDir).mockImplementation(
      () => new Promise<void>((r) => { resolveLoad = r }),
    )

    const pending = h.overrides.navigate!({ path: 'docs' })
    expect(h.tree.loadDir).toHaveBeenCalledTimes(1)
    expect(h.tree.loadDir).toHaveBeenCalledWith('docs/', { force: true })
    expect(h.emit).not.toHaveBeenCalled() // loadDir 未 resolve 不发事件

    resolveLoad()
    await expect(pending).resolves.toEqual({ path: 'docs/' })
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith('pathChanged', { path: 'docs/' })
  })

  it('rootPrefix + 前导斜杠 rel → 全键规范化目录 prefix', async () => {
    const h = setup({ rootPrefix: 'sessions/abc/' })
    const reply = await h.overrides.navigate!({ path: '/x' })
    expect(h.tree.loadDir).toHaveBeenCalledWith('sessions/abc/x/', { force: true })
    expect(reply).toEqual({ path: 'sessions/abc/x/' })
    expect(h.emit).toHaveBeenCalledWith('pathChanged', { path: 'sessions/abc/x/' })
  })

  it('rel 非字符串 → 4005 且不触 loadDir', async () => {
    const h = setup()
    await expectSdkError(() => h.overrides.navigate!({ path: 42 }), ERROR_CODES.BAD_PARAM)
    await expectSdkError(() => h.overrides.navigate!({}), 4005)
    expect(h.tree.loadDir).not.toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
  })
})

// ───────────────────────── createFolder ─────────────────────────

describe('createFolder', () => {
  it('features.mkdir=false → 4301 且 tree.mkdir 未调', async () => {
    const h = setup({ features: { ...ALL_ON, mkdir: false } })
    await expectSdkError(() => h.overrides.createFolder!({ path: 'new' }), ERROR_CODES.FEATURE_DISABLED)
    expect(h.tree.mkdir).not.toHaveBeenCalled()
  })

  it('成功 → tree.mkdir(parent,name)，reply {key}', async () => {
    const h = setup({ rootPrefix: 'sessions/abc/' })
    const reply = await h.overrides.createFolder!({ path: 'new' })
    expect(h.tree.mkdir).toHaveBeenCalledTimes(1)
    expect(h.tree.mkdir).toHaveBeenCalledWith('sessions/abc/', 'new')
    expect(reply).toEqual({ key: 'sessions/abc/new/' })
  })

  it('嵌套路径拆 parent/name：path=a/b → mkdir(a/, b)', async () => {
    const h = setup({ rootPrefix: 'sessions/abc/' })
    await h.overrides.createFolder!({ path: 'a/b' })
    expect(h.tree.mkdir).toHaveBeenCalledWith('sessions/abc/a/', 'b')
  })
})

// ───────────────────────── rename / remove ─────────────────────────

describe('rename', () => {
  it('features.rename=false → 4301 且 tree.rename 未调', async () => {
    const h = setup({ features: { ...ALL_ON, rename: false } })
    await expectSdkError(() => h.overrides.rename!({ from: 'a.txt', to: 'b.txt' }), ERROR_CODES.FEATURE_DISABLED)
    expect(h.tree.rename).not.toHaveBeenCalled()
  })

  it('成功 → tree.rename(joinKey(from), joinKey(to))，reply {}', async () => {
    const h = setup({ rootPrefix: 'sessions/abc/' })
    const reply = await h.overrides.rename!({ from: '/a.txt', to: 'b.txt' })
    expect(h.tree.rename).toHaveBeenCalledTimes(1)
    expect(h.tree.rename).toHaveBeenCalledWith('sessions/abc/a.txt', 'sessions/abc/b.txt')
    expect(reply).toEqual({})
  })
})

describe('remove', () => {
  it('features.delete=false → 4301 且 tree.remove 未调', async () => {
    const h = setup({ features: { ...ALL_ON, delete: false } })
    await expectSdkError(() => h.overrides.remove!({ paths: ['a.txt'] }), ERROR_CODES.FEATURE_DISABLED)
    expect(h.tree.remove).not.toHaveBeenCalled()
  })

  it('空数组 → 直接 {} 不调 tree.remove（同步返回，不进 Promise）', () => {
    const h = setup()
    expect(h.overrides.remove!({ paths: [] })).toEqual({})
    expect(h.tree.remove).not.toHaveBeenCalled()
  })

  it('非空 → 逐项 joinKey 后调 tree.remove，reply {}', async () => {
    const h = setup({ rootPrefix: 'sessions/abc/' })
    const reply = await h.overrides.remove!({ paths: ['/a.txt', 'd/'] })
    expect(h.tree.remove).toHaveBeenCalledTimes(1)
    expect(h.tree.remove).toHaveBeenCalledWith(['sessions/abc/a.txt', 'sessions/abc/d/'])
    expect(reply).toEqual({})
  })
})

// ───────────────────────── uploadFiles ─────────────────────────

describe('uploadFiles', () => {
  it('features.upload=false → 4301 且 queue.enqueue 未调', async () => {
    const h = setup({ features: { ...ALL_ON, upload: false } })
    await expectSdkError(
      () => h.overrides.uploadFiles!({ files: [new File(['a'], 'a.txt')] }),
      ERROR_CODES.FEATURE_DISABLED,
    )
    expect(h.queue.enqueue).not.toHaveBeenCalled()
  })

  // F4 断言修订：rejected 由「原样透传」改为「逐项补 code」（契约 §五 ext=4304/size=4302，
  // types.ts UploadRejected.code?: number 已预留）——原 toEqual 期望随之加 code 字段。
  it('enqueue 结果映射为 {accepted:[{id}], rejected 逐项补 code（ext→4304）}', async () => {
    const h = setup()
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.exe')]
    vi.mocked(h.queue.enqueue).mockReturnValue({
      accepted: [{ id: 'up-1' }, { id: 'up-2' }],
      rejected: [{ name: 'b.exe', reason: 'ext' }],
    })
    const reply = await h.overrides.uploadFiles!({ files })
    expect(h.queue.enqueue).toHaveBeenCalledTimes(1)
    expect(h.queue.enqueue).toHaveBeenCalledWith(files)
    expect(reply).toEqual({
      accepted: [{ id: 'up-1' }, { id: 'up-2' }],
      rejected: [{ name: 'b.exe', reason: 'ext', code: 4304 }],
    })
    expect(h.emit).not.toHaveBeenCalled() // 部分拒收（有受理）不发批失败事件
  })

  it('rejected 补 code：size→4302', async () => {
    const h = setup()
    vi.mocked(h.queue.enqueue).mockReturnValue({
      accepted: [{ id: 'up-1' }],
      rejected: [{ name: 'big.bin', reason: 'size' }],
    })
    const reply = await h.overrides.uploadFiles!({ files: [new File(['a'], 'big.bin')] })
    expect(reply).toEqual({
      accepted: [{ id: 'up-1' }],
      rejected: [{ name: 'big.bin', reason: 'size', code: ERROR_CODES.LIMIT_EXCEEDED }],
    })
  })

  // F4 断言修订：`{}`（缺省无 files）由 4005 改为拉起文件选择器（契约 §五「缺省拉起选择器」）；
  // files 字段存在但类型非法仍 4005（§五 payload 统一注记④：参数非法=reject 4005）。
  it('files 字段存在但非数组 → 4005 且 enqueue 未调', async () => {
    const h = setup()
    await expectSdkError(() => h.overrides.uploadFiles!({ files: 'a.txt' }), ERROR_CODES.BAD_PARAM)
    await expectSdkError(() => h.overrides.uploadFiles!({ files: 42 }), ERROR_CODES.BAD_PARAM)
    expect(h.queue.enqueue).not.toHaveBeenCalled()
  })
})

// ───────────────────────── uploadFiles 全批拒收 → uploadFailed（Lane F4）─────────────────────────

describe('uploadFiles 全批拒收事件', () => {
  it('全批拒 ext：reply.rejected 补 code=4304，且补发 uploadFailed{error.code:4304, files:[全部被拒名]}', async () => {
    const h = setup()
    vi.mocked(h.queue.enqueue).mockReturnValue({
      accepted: [],
      rejected: [{ name: 'a.exe', reason: 'ext' }, { name: 'b.exe', reason: 'ext' }],
    })
    const reply = await h.overrides.uploadFiles!({ files: [] })
    expect(reply).toEqual({
      accepted: [],
      rejected: [
        { name: 'a.exe', reason: 'ext', code: 4304 },
        { name: 'b.exe', reason: 'ext', code: 4304 },
      ],
    })
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith('uploadFailed', {
      error: { code: ERROR_CODES.EXT_DENIED, message: expect.any(String) },
      files: ['a.exe', 'b.exe'],
    })
  })

  it('全批拒 size → error.code=4302(LIMIT_EXCEEDED)', async () => {
    const h = setup()
    vi.mocked(h.queue.enqueue).mockReturnValue({
      accepted: [],
      rejected: [{ name: 'big.bin', reason: 'size' }],
    })
    await h.overrides.uploadFiles!({ files: [] })
    expect(h.emit).toHaveBeenCalledWith('uploadFailed', {
      error: { code: ERROR_CODES.LIMIT_EXCEEDED, message: expect.any(String) },
      files: ['big.bin'],
    })
  })

  it('混批全拒 → code 取首项原因（契约只定义 4302/4304 两值；逐项原因看 reply.rejected）', async () => {
    const h = setup()
    vi.mocked(h.queue.enqueue).mockReturnValue({
      accepted: [],
      rejected: [{ name: 'big.bin', reason: 'size' }, { name: 'a.exe', reason: 'ext' }],
    })
    await h.overrides.uploadFiles!({ files: [] })
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith('uploadFailed', {
      error: { code: ERROR_CODES.LIMIT_EXCEEDED, message: expect.any(String) },
      files: ['big.bin', 'a.exe'],
    })
  })

  it('空批（无受理也无拒收）→ 不发 uploadFailed', async () => {
    const h = setup() // 默认 mock 回包 {accepted:[],rejected:[]}
    await h.overrides.uploadFiles!({ files: [] })
    expect(h.emit).not.toHaveBeenCalled()
  })
})

// ───────────────────────── uploadFiles 缺省拉起选择器（Lane F4）─────────────────────────

describe('uploadFiles 缺省拉起文件选择器', () => {
  /** jsdom 的 input.files 只读：测试里直接把 File[] 断言成 FileList（enqueue 侧只做 Array.from） */
  const asFileList = (files: File[]): FileList => files as unknown as FileList
  const spyClick = (): ReturnType<typeof vi.spyOn> =>
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

  it('payload 无 files → 创建 <input type=file multiple> 并 click()；reply 立即空批、enqueue 未调、无事件', () => {
    const click = spyClick()
    try {
      const h = setup()
      const reply = h.overrides.uploadFiles!({}) as { accepted: unknown[]; rejected: unknown[] }
      expect(reply).toEqual({ accepted: [], rejected: [] }) // 选择结果全走 upload* 事件，reply 先回空批
      expect(h.queue.enqueue).not.toHaveBeenCalled()
      expect(h.emit).not.toHaveBeenCalled()

      const input = document.querySelector('input[type="file"]')
      expect(input).toBeInstanceOf(HTMLInputElement)
      expect((input as HTMLInputElement).multiple).toBe(true)
      expect(click).toHaveBeenCalledTimes(1)
    } finally {
      click.mockRestore()
    }
  })

  it('change → enqueue(选中文件, 当前目录)（结果走既有 hooks 事件），input 选完自清', () => {
    const click = spyClick()
    try {
      const h = setup({ rootPrefix: 'sessions/abc/' })
      h.tree.currentPath = 'sessions/abc/docs/' // 用户已浏览到 docs/
      h.overrides.uploadFiles!({})
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      const picked = [new File(['x'], 'x.txt'), new File(['y'], 'y.png')]
      Object.defineProperty(input, 'files', { value: asFileList(picked), configurable: true })
      input.dispatchEvent(new Event('change'))

      expect(h.queue.enqueue).toHaveBeenCalledTimes(1)
      expect(h.queue.enqueue).toHaveBeenCalledWith(picked, 'sessions/abc/docs/')
      expect(document.querySelector('input[type="file"]')).toBeNull()
    } finally {
      click.mockRestore()
    }
  })

  it('cancel 或空选 → 不 enqueue、无事件，input 移除', () => {
    const click = spyClick()
    try {
      const h = setup()
      h.overrides.uploadFiles!({})
      let input = document.querySelector('input[type="file"]') as HTMLInputElement
      input.dispatchEvent(new Event('cancel')) // 现代浏览器取消路径
      expect(document.querySelector('input[type="file"]')).toBeNull()
      expect(h.queue.enqueue).not.toHaveBeenCalled()
      expect(h.emit).not.toHaveBeenCalled()

      h.overrides.uploadFiles!({}) // 空选路径：change 但 files 为空
      input = document.querySelector('input[type="file"]') as HTMLInputElement
      Object.defineProperty(input, 'files', { value: asFileList([]), configurable: true })
      input.dispatchEvent(new Event('change'))
      expect(h.queue.enqueue).not.toHaveBeenCalled()
      expect(document.querySelector('input[type="file"]')).toBeNull()
    } finally {
      click.mockRestore()
    }
  })

  it('features.upload=false 且缺省 → 4301 且不创建 input', async () => {
    const h = setup({ features: { ...ALL_ON, upload: false } })
    await expectSdkError(() => h.overrides.uploadFiles!({}), ERROR_CODES.FEATURE_DISABLED)
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})

// ───────────────────────── download ─────────────────────────

describe('download', () => {
  it('成功：client.get→blob→triggerDownload（文件名取末段）→ emit downloadDone，reply {id}', async () => {
    const h = setup()
    vi.mocked(h.client.get).mockResolvedValue(fakeRes(new Blob(['hi'])))
    const reply = (await h.overrides.download!({ paths: ['a/b.txt'] })) as { id: string }

    expect(reply.id).toEqual(expect.any(String))
    await flush()
    expect(h.client.get).toHaveBeenCalledTimes(1)
    expect(h.client.get).toHaveBeenCalledWith('a/b.txt')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(triggerDownload).toHaveBeenCalledTimes(1)
    // 首参 = createObjectURL 的返回值（透传），次参 = key 末段文件名
    expect(triggerDownload).toHaveBeenCalledWith(createObjectURL.mock.results[0]?.value, 'b.txt')
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith('downloadDone', { id: reply.id })
  })

  it('多文件按序取流（key 拼 rootPrefix），逐个触发下载后统一 downloadDone', async () => {
    const h = setup({ rootPrefix: 'sessions/abc/' })
    vi.mocked(h.client.get).mockResolvedValue(fakeRes())
    const reply = (await h.overrides.download!({ paths: ['a/b.txt', 'd.pdf'] })) as { id: string }

    await flush()
    expect(h.client.get).toHaveBeenNthCalledWith(1, 'sessions/abc/a/b.txt')
    expect(h.client.get).toHaveBeenNthCalledWith(2, 'sessions/abc/d.pdf')
    expect(triggerDownload).toHaveBeenCalledTimes(2)
    expect(vi.mocked(triggerDownload).mock.calls[0]?.[1]).toBe('b.txt')
    expect(vi.mocked(triggerDownload).mock.calls[1]?.[1]).toBe('d.pdf')
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith('downloadDone', { id: reply.id })
  })

  it('client.get reject SdkError(4101) → emit downloadFailed{id,error:{code:4101}}，不触发下载，reply {id}', async () => {
    const h = setup()
    vi.mocked(h.client.get).mockRejectedValue(new SdkError(ERROR_CODES.S3_ERROR, 'boom'))
    const reply = (await h.overrides.download!({ paths: ['x.txt'] })) as { id: string }

    await flush()
    expect(triggerDownload).not.toHaveBeenCalled()
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith('downloadFailed', {
      id: reply.id,
      error: { code: ERROR_CODES.S3_ERROR, message: 'boom' },
    })
  })

  it('多文件部分失败：失败不中断其余（复审①：继续下载后续文件），终态 downloadFailed 携首个失败', async () => {
    const h = setup()
    vi.mocked(h.client.get)
      .mockRejectedValueOnce(new SdkError(ERROR_CODES.S3_ERROR, 'boom1'))
      .mockResolvedValueOnce(fakeRes(new Blob(['ok'])))
    const reply = (await h.overrides.download!({ paths: ['bad.txt', 'good.txt'] })) as { id: string }

    await flush()
    expect(h.client.get).toHaveBeenCalledTimes(2)
    expect(triggerDownload).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledWith('downloadFailed', {
      id: reply.id,
      error: { code: ERROR_CODES.S3_ERROR, message: 'boom1' },
    })
  })

  it('features.download=false → 4301 且 client.get 未调', async () => {
    const h = setup({ features: { ...ALL_ON, download: false } })
    await expectSdkError(() => h.overrides.download!({ paths: ['a.txt'] }), ERROR_CODES.FEATURE_DISABLED)
    expect(h.client.get).not.toHaveBeenCalled()
  })
})

// ───────────────────────── createUploadHooks ─────────────────────────

describe('createUploadHooks', () => {
  it('onProgress → emit uploadProgress {id,loaded,total}', () => {
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    createUploadHooks(emit).onProgress?.('up-1', 30, 120)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('uploadProgress', { id: 'up-1', loaded: 30, total: 120 })
  })

  it('onDone → emit uploadDone {id,key}', () => {
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    createUploadHooks(emit).onDone?.('up-1', 'sessions/abc/a.txt')
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('uploadDone', { id: 'up-1', key: 'sessions/abc/a.txt' })
  })

  it('onFailed：err 带 code → 原样透传（含 4101/取消码 4901 等一切业务码）', () => {
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    const hooks = createUploadHooks(emit)
    hooks.onFailed?.('up-1', new SdkError(ERROR_CODES.S3_ERROR, 'boom'))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('uploadFailed', {
      id: 'up-1',
      error: { code: ERROR_CODES.S3_ERROR, message: 'boom' },
    })
    emit.mockClear()
    hooks.onFailed?.('up-2', new SdkError(4901, '上传已取消'))
    expect(emit).toHaveBeenCalledWith('uploadFailed', {
      id: 'up-2',
      error: { code: 4901, message: '上传已取消' },
    })
  })

  it('onFailed：普通 Error（无 code）→ code 兜底 4101(S3_ERROR)，message 取 err.message', () => {
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    createUploadHooks(emit).onFailed?.('up-3', new Error('net down'))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('uploadFailed', {
      id: 'up-3',
      error: { code: ERROR_CODES.S3_ERROR, message: 'net down' },
    })
  })
})

// ───────────────────────── uploadProgress 200ms 节流（Lane F4：契约 §六「节流 ~200ms」）─────────────────────────

describe('createUploadProgressThrottle', () => {
  /** fake timers 同时 fake Date.now（vitest 默认 toFake 含 Date），节流的墙钟判定随之推进 */
  it('窗口内 N 次进度只发首个，flush 冲刷最新尾值（首+尾共 2 条）', () => {
    vi.useFakeTimers()
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    const t = createUploadProgressThrottle(emit)
    t.push('up-1', 0, 100) // t=0 首发
    vi.advanceTimersByTime(50)
    t.push('up-1', 30, 100) // 窗口内 → 只记最新
    vi.advanceTimersByTime(50)
    t.push('up-1', 60, 100)
    vi.advanceTimersByTime(50)
    t.push('up-1', 90, 100)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('uploadProgress', { id: 'up-1', loaded: 0, total: 100 })

    t.flush('up-1') // 终态强制冲刷
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenNthCalledWith(2, 'uploadProgress', { id: 'up-1', loaded: 90, total: 100 })
    t.flush('up-1') // 已冲刷 → 不重复
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('窗口过期后再 push → 立即发新值（窗口内旧 pending 不补发，最新值优先）', () => {
    vi.useFakeTimers()
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    const t = createUploadProgressThrottle(emit)
    t.push('up-1', 0, 100) // t=0 发
    vi.advanceTimersByTime(30)
    t.push('up-1', 20, 100) // pending
    vi.advanceTimersByTime(210) // t=240，窗口（200ms）已过
    t.push('up-1', 80, 100) // 新窗口 → 立即发 80
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenNthCalledWith(2, 'uploadProgress', { id: 'up-1', loaded: 80, total: 100 })
    t.flush('up-1') // 无 pending → 不补发（终值已实时发出，避免重复）
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('多上传项独立节流：各项首发互不影响，冲刷只清自身', () => {
    vi.useFakeTimers()
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    const t = createUploadProgressThrottle(emit)
    t.push('a', 1, 10)
    t.push('b', 2, 10) // 各项首次 → 各发一条
    expect(emit).toHaveBeenCalledTimes(2)
    t.push('a', 5, 10)
    t.push('b', 8, 10) // 均进各自 pending
    expect(emit).toHaveBeenCalledTimes(2)
    t.flush('a')
    expect(emit).toHaveBeenCalledTimes(3)
    expect(emit).toHaveBeenNthCalledWith(3, 'uploadProgress', { id: 'a', loaded: 5, total: 10 })
    expect(emit).not.toHaveBeenCalledWith('uploadProgress', { id: 'b', loaded: 8, total: 10 })
    t.flush('b')
    expect(emit).toHaveBeenLastCalledWith('uploadProgress', { id: 'b', loaded: 8, total: 10 })
  })
})

describe('createUploadHooks 节流接线', () => {
  it('onDone 先冲刷未发进度再发 uploadDone（宿主先见最新进度再见终态）', () => {
    vi.useFakeTimers()
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    const hooks = createUploadHooks(emit)
    hooks.onProgress?.('up-1', 0, 100) // 首发
    hooks.onProgress?.('up-1', 100, 100) // 窗口内 pending
    hooks.onDone?.('up-1', 'a.txt')
    expect(emit).toHaveBeenCalledTimes(3)
    expect(emit).toHaveBeenNthCalledWith(1, 'uploadProgress', { id: 'up-1', loaded: 0, total: 100 })
    expect(emit).toHaveBeenNthCalledWith(2, 'uploadProgress', { id: 'up-1', loaded: 100, total: 100 })
    expect(emit).toHaveBeenNthCalledWith(3, 'uploadDone', { id: 'up-1', key: 'a.txt' })
  })

  it('onFailed 同样先冲刷未发进度再发 uploadFailed', () => {
    vi.useFakeTimers()
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    const hooks = createUploadHooks(emit)
    hooks.onProgress?.('up-1', 0, 100)
    hooks.onProgress?.('up-1', 40, 100) // pending
    hooks.onFailed?.('up-1', new SdkError(ERROR_CODES.S3_ERROR, 'boom'))
    expect(emit).toHaveBeenCalledTimes(3)
    expect(emit).toHaveBeenNthCalledWith(2, 'uploadProgress', { id: 'up-1', loaded: 40, total: 100 })
    expect(emit).toHaveBeenNthCalledWith(3, 'uploadFailed', {
      id: 'up-1',
      error: { code: ERROR_CODES.S3_ERROR, message: 'boom' },
    })
  })

  it('进度间隔超窗口 → 每次都实时发，onDone 不再补发（无重复终值）', () => {
    vi.useFakeTimers()
    const emit = vi.fn<(evt: EventName, payload: unknown) => void>()
    const hooks = createUploadHooks(emit)
    hooks.onProgress?.('up-1', 0, 100)
    vi.advanceTimersByTime(300)
    hooks.onProgress?.('up-1', 100, 100) // 窗口已过 → 实时发
    hooks.onDone?.('up-1', 'a.txt')
    const progress = emit.mock.calls.filter((c) => c[0] === 'uploadProgress')
    expect(progress).toHaveLength(2)
    expect(emit).toHaveBeenLastCalledWith('uploadDone', { id: 'up-1', key: 'a.txt' })
  })
})
