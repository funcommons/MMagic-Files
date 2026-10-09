/**
 * UrlSourceProvider 单测（Wave1-A6）
 * 被测：src/sdk/url-source.ts——单文件模式 URL 数据源（ctx.getObject/putObject 底座）
 * 注入：vi.fn 构造 fetcher，不发真实网络请求；Response 用全局构造。
 */
import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, SdkError } from '../errorCodes'
import { UrlSourceProvider } from '../url-source'
import type { FileSave, FileSource } from '../types'

const SRC_URL = 'https://src.example.com/report.txt'
const SAVE_URL = 'https://dst.example.com/upload'

/** 固定状态码/响应体的 fetcher 实现（忽略入参，仅供断言透传用） */
function resFor(status: number, body: string | null = 'x') {
  return (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
    Promise.resolve(new Response(body, { status }))
}

/** 直接 reject 的 fetcher（模拟网络故障） */
function rejectingFetcher(): typeof fetch {
  return async (): Promise<Response> => {
    throw new TypeError('network down')
  }
}

function makeProvider(
  fetcher: typeof fetch,
  opts: { source?: Partial<FileSource>; save?: FileSave } = {},
): UrlSourceProvider {
  const source: FileSource = { url: SRC_URL, ...opts.source }
  return new UrlSourceProvider({
    source,
    ...(opts.save !== undefined ? { save: opts.save } : {}),
    fetcher,
  })
}

/** 断言 promise 以 SdkError(code, detail={status}) 拒绝 */
async function expectSdkError(p: Promise<unknown>, code: number, status?: number): Promise<void> {
  const err: unknown = await p.then(
    () => {
      throw new Error('应拒绝，却成功返回')
    },
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(SdkError)
  expect((err as SdkError).code).toBe(code)
  if (status !== undefined) expect((err as SdkError).detail).toEqual({ status })
}

// ───────────────────────── 构造 / writable ─────────────────────────

describe('构造与 writable', () => {
  it('无 save 段 → writable=false（只读）', () => {
    const p = makeProvider(vi.fn(resFor(200)))
    expect(p.writable).toBe(false)
  })

  it('有 save 段 → writable=true（可写）', () => {
    const p = makeProvider(vi.fn(resFor(200)), {
      save: { method: 'PUT', url: SAVE_URL },
    })
    expect(p.writable).toBe(true)
  })
})

// ───────────────────────── get()：请求透传 ─────────────────────────

describe('get() 请求透传', () => {
  it('缺省 method → GET，url 透传，无 body/headers', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher).get()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe(SRC_URL)
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toBeUndefined()
  })

  it('GET 显式声明 + source.headers 透传', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, {
      source: { method: 'GET', headers: { Authorization: 'Bearer t0' } },
    }).get()
    const [, init] = fetcher.mock.calls[0] ?? []
    expect(init?.method).toBe('GET')
    expect(init?.headers).toEqual({ Authorization: 'Bearer t0' })
  })

  it('GET 时即使 source 带 body 也不发送', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, { source: { method: 'GET', body: 'a=1' } }).get()
    const [, init] = fetcher.mock.calls[0] ?? []
    expect(init?.body).toBeUndefined()
  })

  it('POST → body 与 headers 均透传', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, {
      source: { method: 'POST', body: 'a=1&b=2', headers: { 'X-Sign': 's1' } },
    }).get()
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe(SRC_URL)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('a=1&b=2')
    expect(init?.headers).toEqual({ 'X-Sign': 's1' })
  })

  it('成功时返回原始 Response（可继续读流）', async () => {
    const p = makeProvider(vi.fn(resFor(200, 'payload')))
    const res = await p.get()
    expect(res.status).toBe(200)
    expect(res.ok).toBe(true)
    await expect(res.text()).resolves.toBe('payload')
  })
})

// ───────────────────────── get()：参数校验与错误映射 ─────────────────────────

describe('get() 参数校验与错误映射', () => {
  it('method 非法（DELETE）→ BAD_PARAM 4005，且不发请求', async () => {
    const fetcher = vi.fn(resFor(200))
    const p = makeProvider(fetcher, {
      source: { method: 'DELETE' as unknown as FileSource['method'] },
    })
    await expectSdkError(p.get(), ERROR_CODES.BAD_PARAM)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fetch 抛错 → S3_ERROR 4101，detail.status=0', async () => {
    const p = makeProvider(vi.fn(rejectingFetcher()))
    await expectSdkError(p.get(), ERROR_CODES.S3_ERROR, 0)
  })

  it('401 → CREDENTIAL_INVALID 4002（detail.status=401）', async () => {
    const p = makeProvider(vi.fn(resFor(401)))
    await expectSdkError(p.get(), ERROR_CODES.CREDENTIAL_INVALID, 401)
  })

  it('403 → CREDENTIAL_INVALID 4002（detail.status=403）', async () => {
    const p = makeProvider(vi.fn(resFor(403)))
    await expectSdkError(p.get(), ERROR_CODES.CREDENTIAL_INVALID, 403)
  })

  it('500 → S3_ERROR 4101（detail.status=500）', async () => {
    const p = makeProvider(vi.fn(resFor(500)))
    await expectSdkError(p.get(), ERROR_CODES.S3_ERROR, 500)
  })

  it('302（非 2xx 且非 401/403）→ S3_ERROR 4101', async () => {
    const p = makeProvider(vi.fn(resFor(302, null)))
    await expectSdkError(p.get(), ERROR_CODES.S3_ERROR, 302)
  })
})

// ───────────────────────── getText / getBlob ─────────────────────────

describe('getText() / getBlob() 便捷方法', () => {
  it('getText 返回响应文本', async () => {
    const p = makeProvider(vi.fn(resFor(200, 'hello url source')))
    await expect(p.getText()).resolves.toBe('hello url source')
  })

  it('getBlob 返回 Blob（大小与内容一致）', async () => {
    const p = makeProvider(vi.fn(resFor(200, 'hello')))
    const blob = await p.getBlob()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBe(5)
    await expect(blob.text()).resolves.toBe('hello')
  })
})

// ───────────────────────── put()：写链 ─────────────────────────

describe('put() 无 save 段（只读）', () => {
  it('→ UNSUPPORTED_MODE 4305，且不发任何请求', async () => {
    const fetcher = vi.fn(resFor(200))
    const p = makeProvider(fetcher)
    await expectSdkError(p.put('data', 'text/plain'), ERROR_CODES.UNSUPPORTED_MODE)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('put() 请求透传（有 save 段）', () => {
  const SAVE: FileSave = {
    method: 'PUT',
    url: SAVE_URL,
    headers: { 'X-Token': 't1' },
  }

  it('save.method / save.url / save.headers / body 透传', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, { save: SAVE }).put('new-content')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe(SAVE_URL)
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ 'X-Token': 't1' })
    expect(init?.body).toBe('new-content')
  })

  it('save.method=POST 被采用', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, {
      save: { method: 'POST', url: SAVE_URL },
    }).put('x')
    const [, init] = fetcher.mock.calls[0] ?? []
    expect(init?.method).toBe('POST')
  })

  it('显式 contentType 写入 Content-Type（save.headers 原本没有）', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, { save: SAVE }).put('x', 'text/csv')
    const [, init] = fetcher.mock.calls[0] ?? []
    expect(init?.headers).toEqual({ 'X-Token': 't1', 'Content-Type': 'text/csv' })
  })

  it('显式 contentType 覆盖 save.headers 已有的 Content-Type', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, {
      save: { method: 'PUT', url: SAVE_URL, headers: { 'Content-Type': 'application/json' } },
    }).put('{"a":1}', 'text/plain')
    const [, init] = fetcher.mock.calls[0] ?? []
    expect(init?.headers).toEqual({ 'Content-Type': 'text/plain' })
  })

  it('无 contentType 且 save.headers 缺省 → 不凭空造 Content-Type', async () => {
    const fetcher = vi.fn(resFor(200))
    await makeProvider(fetcher, {
      save: { method: 'PUT', url: SAVE_URL },
    }).put('x')
    const [, init] = fetcher.mock.calls[0] ?? []
    expect(init?.headers).toEqual({})
  })

  it('Blob body 以同一引用透传', async () => {
    const fetcher = vi.fn(resFor(200))
    const blob = new Blob(['abc'])
    await makeProvider(fetcher, { save: SAVE }).put(blob)
    const [, init] = fetcher.mock.calls[0] ?? []
    expect(init?.body).toBe(blob)
  })

  it('2xx（204 无响应体）不抛', async () => {
    const p = makeProvider(vi.fn(resFor(204, null)), { save: SAVE })
    await expect(p.put('x')).resolves.toBeUndefined()
  })
})

describe('put() 错误映射（与 get 同口径）', () => {
  const SAVE: FileSave = { method: 'PUT', url: SAVE_URL }

  it('fetch 抛错 → S3_ERROR 4101，detail.status=0', async () => {
    const p = makeProvider(vi.fn(rejectingFetcher()), { save: SAVE })
    await expectSdkError(p.put('x'), ERROR_CODES.S3_ERROR, 0)
  })

  it('401 → CREDENTIAL_INVALID 4002', async () => {
    const p = makeProvider(vi.fn(resFor(401)), { save: SAVE })
    await expectSdkError(p.put('x'), ERROR_CODES.CREDENTIAL_INVALID, 401)
  })

  it('403 → CREDENTIAL_INVALID 4002', async () => {
    const p = makeProvider(vi.fn(resFor(403)), { save: SAVE })
    await expectSdkError(p.put('x'), ERROR_CODES.CREDENTIAL_INVALID, 403)
  })

  it('500 → S3_ERROR 4101（detail.status=500）', async () => {
    const p = makeProvider(vi.fn(resFor(500)), { save: SAVE })
    await expectSdkError(p.put('x'), ERROR_CODES.S3_ERROR, 500)
  })
})
