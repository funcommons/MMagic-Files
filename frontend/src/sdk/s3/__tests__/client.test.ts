/**
 * S3 API 子集客户端测试：mock fetcher 断言请求形态（URL/方法/关键头/query）+ 响应映射
 */
import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, SdkError } from '../../errorCodes'
import type { BackendConfig } from '../../types'
import { crc32Base64, S3SigV4Client } from '../client'

const CONFIG: BackendConfig = {
  endpoint: 'https://s3.test',
  region: 'us-east-1',
  bucket: 'bkt',
  prefix: 'sessions/abc/',
  credentials: { accessKeyId: 'AKID', accessKeySecret: 'SK', sessionToken: 'TOK' },
}

/** 签名无关断言的公用校验：请求带了 SigV4 关键头 */
function expectSignedHeaders(init: RequestInit | undefined): void {
  const headers = (init?.headers ?? {}) as Record<string, string>
  expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//)
  expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
  expect(headers['x-amz-security-token']).toBe('TOK')
  expect(headers['x-amz-content-sha256']).toBeTruthy()
}

function makeClient(responses: Response[] | ((url: string, init?: RequestInit) => Response)) {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
  if (Array.isArray(responses)) {
    for (const r of responses) fetcher.mockResolvedValueOnce(r)
  } else {
    fetcher.mockImplementation(async (url, init) => responses(url, init))
  }
  return { fetcher, client: new S3SigV4Client(CONFIG, fetcher) }
}

const xml = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'application/xml', ...headers } })

describe('list（ListObjectsV2）', () => {
  it('query 形态与 CommonPrefixes/Contents 映射，目录标记归入 dirs', async () => {
    const { fetcher, client } = makeClient([
      xml(`<ListBucketResult>
        <IsTruncated>false</IsTruncated>
        <CommonPrefixes><Prefix>sessions/abc/photos/</Prefix></CommonPrefixes>
        <Contents><Key>sessions/abc/a.txt</Key><Size>3</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
        <Contents><Key>sessions/abc/notes/</Key><Size>0</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>
        <Contents><Key>sessions/abc/empty.bin</Key><Size>0</Size></Contents>
      </ListBucketResult>`),
    ])
    const result = await client.list('sessions/abc/', { continuationToken: 'tok/1+2=' })
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://s3.test/bkt?list-type=2&prefix=sessions%2Fabc%2F&delimiter=%2F&continuation-token=tok%2F1%2B2%3D')
    expect(init?.method).toBe('GET')
    expectSignedHeaders(init)
    // CommonPrefixes + 目录标记（'notes/' 零字节）都进 dirs；零字节普通文件仍在 files
    expect(result.dirs.map((d) => d.key).sort()).toEqual(['sessions/abc/notes/', 'sessions/abc/photos/'])
    expect(result.dirs.every((d) => d.isDir && d.name.length > 0)).toBe(true)
    expect(result.files.map((f) => f.key)).toEqual(['sessions/abc/a.txt', 'sessions/abc/empty.bin'])
    expect(result.files[0]).toMatchObject({ name: 'a.txt', size: 3, isDir: false, lastModified: Date.parse('2026-01-01T00:00:00.000Z') })
    expect(result.prefix).toBe('sessions/abc/')
    expect(result.continuationToken).toBeUndefined()
  })

  it('IsTruncated=true → 透出 NextContinuationToken', async () => {
    const { client } = makeClient([xml('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next/1+2=</NextContinuationToken></ListBucketResult>')])
    const result = await client.list('sessions/abc/')
    expect(result.continuationToken).toBe('next/1+2=')
  })

  it('默认 delimiter=/；可显式覆盖', async () => {
    const { fetcher, client } = makeClient([xml('<ListBucketResult/>'), xml('<ListBucketResult/>')])
    await client.list('p/')
    await client.list('p/', { delimiter: '' })
    expect(fetcher.mock.calls[0]?.[0]).toContain('delimiter=%2F')
    expect(fetcher.mock.calls[1]?.[0]).toContain('delimiter=')
  })
})

describe('对象读写', () => {
  it('put：URL 逐段编码、content-type、etag 解析', async () => {
    const { fetcher, client } = makeClient([new Response('', { headers: { etag: '"abc123"' } })])
    const { etag } = await client.put('a dir/b+c.txt', new Blob(['x']), 'text/plain')
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://s3.test/bkt/a%20dir/b%2Bc.txt')
    expect(init?.method).toBe('PUT')
    expect((init?.headers as Record<string, string>)['content-type']).toBe('text/plain')
    expectSignedHeaders(init)
    expect(etag).toBe('"abc123"')
  })

  it('get：可选 Range 头，返回原始 Response', async () => {
    const { fetcher, client } = makeClient([new Response('partial', { status: 206, headers: { 'content-range': 'bytes 0-6/100' } })])
    const res = await client.get('a/b.txt', { rangeHeader: 'bytes=0-6' })
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://s3.test/bkt/a/b.txt')
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>).range).toBe('bytes=0-6')
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('partial')
  })

  it('get：404 正常返回（对象不存在是业务态，不抛错）', async () => {
    const { client } = makeClient([new Response('', { status: 404 })])
    const res = await client.get('missing.txt')
    expect(res.status).toBe(404)
  })

  it('head：200 透出 size/contentType/etag；404 → exists=false', async () => {
    const ok = makeClient([new Response(null, { headers: { 'content-length': '3', 'content-type': 'text/plain', etag: '"e1"' } })])
    expect(await ok.client.head('a.txt')).toEqual({ exists: true, size: 3, contentType: 'text/plain', etag: '"e1"' })
    expect(ok.fetcher.mock.calls[0]?.[1]?.method).toBe('HEAD')

    const missing = makeClient([new Response(null, { status: 404 })])
    expect(await missing.client.head('a.txt')).toEqual({ exists: false })
  })

  it('copy：PUT + x-amz-copy-source 编码源路径', async () => {
    const { fetcher, client } = makeClient([xml('<CopyObjectResult><ETag>"e9"</ETag></CopyObjectResult>')])
    await client.copy('src dir/a.txt', 'dst dir/a.txt')
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://s3.test/bkt/dst%20dir/a.txt')
    expect(init?.method).toBe('PUT')
    expect((init?.headers as Record<string, string>)['x-amz-copy-source']).toBe('/bkt/src%20dir/a.txt')
  })
})

describe('remove（DeleteObjects 批量）', () => {
  it('POST ?delete，XML 组装 + CRC32 校验头', async () => {
    const { fetcher, client } = makeClient([xml('<DeleteResult></DeleteResult>')])
    await client.remove(['a.txt', 'd ir/b+c.txt'])
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://s3.test/bkt?delete')
    expect(init?.method).toBe('POST')
    const body = String(init?.body)
    expect(body).toContain('<Delete><Object><Key>a.txt</Key></Object><Object><Key>d ir/b+c.txt</Key></Object>')
    expect(body).toContain('<Quiet>true</Quiet></Delete>')
    expect((init?.headers as Record<string, string>)['x-amz-checksum-crc32']).toBe(crc32Base64(new TextEncoder().encode(body)))
  })

  it('结果含 Error 项 → 抛 S3_ERROR 且 detail 携失败清单', async () => {
    const { client } = makeClient([xml('<DeleteResult><Error><Key>k1</Key><Code>AccessDenied</Code><Message>no</Message></Error></DeleteResult>')])
    const err = await client.remove(['k1']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SdkError)
    expect((err as SdkError).code).toBe(ERROR_CODES.S3_ERROR)
    expect((err as SdkError).detail).toMatchObject({ status: 200, errors: [{ key: 'k1', code: 'AccessDenied' }] })
  })
})

describe('multipart', () => {
  it('createMultipart：POST ?uploads → 解析 UploadId', async () => {
    const { fetcher, client } = makeClient([xml('<InitiateMultipartUploadResult><UploadId>UP/1+2=</UploadId></InitiateMultipartUploadResult>')])
    const { uploadId } = await client.createMultipart('big.bin', 'application/octet-stream')
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://s3.test/bkt/big.bin?uploads')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/octet-stream')
    expect(uploadId).toBe('UP/1+2=')
  })

  it('uploadPart：PUT partNumber&uploadId → 响应 ETag', async () => {
    const { fetcher, client } = makeClient([new Response('', { headers: { etag: '"part1"' } })])
    const { etag } = await client.uploadPart('big.bin', 'UP1', 1, new Blob(['chunk']))
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://s3.test/bkt/big.bin?partNumber=1&uploadId=UP1')
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('PUT')
    expect(etag).toBe('"part1"')
  })

  it('completeMultipart：POST ?uploadId，Part XML 按 partNumber 升序组装', async () => {
    const { fetcher, client } = makeClient([xml('<CompleteMultipartUploadResult><ETag>"all"</ETag></CompleteMultipartUploadResult>')])
    await client.completeMultipart('big.bin', 'UP1', [
      { partNumber: 2, etag: '"p2"' },
      { partNumber: 1, etag: '"p1"' },
    ])
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://s3.test/bkt/big.bin?uploadId=UP1')
    expect(init?.method).toBe('POST')
    const body = String(init?.body)
    expect(body).toBe('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"p1"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"p2"</ETag></Part></CompleteMultipartUpload>')
  })

  it('completeMultipart：200 但 body 含 <Error> → 抛 S3_ERROR', async () => {
    const { client } = makeClient([xml('<Error><Code>EntityTooSmall</Code></Error>')])
    const err = await client.completeMultipart('big.bin', 'UP1', [{ partNumber: 1, etag: '"p1"' }]).catch((e: unknown) => e)
    expect((err as SdkError).code).toBe(ERROR_CODES.S3_ERROR)
  })

  it('abortMultipart：DELETE ?uploadId', async () => {
    const { fetcher, client } = makeClient([new Response(null, { status: 204 })])
    await client.abortMultipart('big.bin', 'UP1')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://s3.test/bkt/big.bin?uploadId=UP1')
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('DELETE')
  })
})

describe('错误映射', () => {
  it('403 + ExpiredToken → CREDENTIAL_EXPIRED', async () => {
    const { client } = makeClient([xml('<Error><Code>ExpiredToken</Code><Message>expired</Message></Error>', 403)])
    const err = await client.list('p/').catch((e: unknown) => e)
    expect((err as SdkError).code).toBe(ERROR_CODES.CREDENTIAL_EXPIRED)
    expect((err as SdkError).detail).toMatchObject({ status: 403 })
  })

  it('403 + TokenExpired（子串）→ CREDENTIAL_EXPIRED', async () => {
    const { client } = makeClient([xml('<Error><Code>TokenExpired</Code></Error>', 403)])
    const err = await client.put('k', new Blob(['body'])).catch((e: unknown) => e)
    expect((err as SdkError).code).toBe(ERROR_CODES.CREDENTIAL_EXPIRED)
  })

  it('403 普通 AccessDenied → CREDENTIAL_INVALID', async () => {
    const { client } = makeClient([xml('<Error><Code>AccessDenied</Code></Error>', 403)])
    const err = await client.list('p/').catch((e: unknown) => e)
    expect((err as SdkError).code).toBe(ERROR_CODES.CREDENTIAL_INVALID)
  })

  it('401 → CREDENTIAL_INVALID', async () => {
    const { client } = makeClient([xml('<Error/>', 401)])
    const err = await client.remove(['k']).catch((e: unknown) => e)
    expect((err as SdkError).code).toBe(ERROR_CODES.CREDENTIAL_INVALID)
  })

  it('其他非 2xx → S3_ERROR，detail={status}', async () => {
    const { client } = makeClient([xml('<Error><Code>NoSuchBucket</Code></Error>', 404)])
    const err = await client.list('p/').catch((e: unknown) => e)
    expect((err as SdkError).code).toBe(ERROR_CODES.S3_ERROR)
    expect((err as SdkError).detail).toMatchObject({ status: 404 })
  })

  it('网络异常 → S3_ERROR，detail={status:0}', async () => {
    const { client } = makeClient(() => {
      throw new TypeError('fetch failed')
    })
    const err = await client.head('k').catch((e: unknown) => e)
    expect((err as SdkError).code).toBe(ERROR_CODES.S3_ERROR)
    expect((err as SdkError).detail).toEqual({ status: 0 })
  })
})

describe('时钟偏移补偿（§4.3）', () => {
  it('calibrateClock 后，签名 x-amz-date 贴齐服务器时间', async () => {
    const serverMs = Date.UTC(2026, 0, 1, 12, 0, 0)
    const withDate = new Response(null, { headers: { date: new Date(serverMs).toUTCString() } })
    const { fetcher, client } = makeClient([withDate, new Response('', { headers: { etag: '"e"' } })])
    await client.get('k') // 先拿到一次响应（真实场景每响应皆可校准）
    client.calibrateClock(withDate)
    await client.put('k2', new Blob(['body']))
    const dateHeader = (fetcher.mock.calls[1]?.[1]?.headers as Record<string, string>)['x-amz-date'] ?? ''
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(dateHeader)
    const signedMs = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : NaN
    // 本机时间可能晚于 serverMs 任意多，校准后签名时刻应贴齐服务器时间（2s 容差）
    expect(Math.abs(signedMs - serverMs)).toBeLessThan(2_000)
  })
})

describe('crc32Base64（DeleteObjects 完整性头）', () => {
  it('对齐标准校验向量 crc32("123456789")=0xCBF43926', () => {
    expect(crc32Base64(new TextEncoder().encode('123456789'))).toBe('y/Q5Jg==')
  })
})

describe('getPresignedUrl（查询串 SigV4 预签名，媒体 Range 拖动直链）', () => {
  /** 20260101T000000Z；nowMs 注入保证签名确定性（金样本独立以 node:crypto 推算） */
  const T = Date.UTC(2026, 0, 1, 0, 0, 0)

  it('默认 3600s：金样本逐字命中（字段齐全 + 签名独立复算一致）', () => {
    const { client } = makeClient([])
    const url = client.getPresignedUrl('docs/a b.txt', undefined, T)
    expect(url).toBe(
      'https://s3.test/bkt/docs/a%20b.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKID%2F20260101%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20260101T000000Z' +
        '&X-Amz-Expires=3600' +
        '&X-Amz-Security-Token=TOK' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=4edd6534c2550e3ce1747f11598c2ba86afb9ff8ec6ace061acc3688aca23c44',
    )
  })

  it('显式 expiresSec 透传；key 路径逐段编码；不发起任何网络请求', () => {
    const { fetcher, client } = makeClient([])
    const url = client.getPresignedUrl('a dir/b.txt', 900, T)
    const q = new URL(url).searchParams
    expect(url.startsWith('https://s3.test/bkt/a%20dir/b.txt?')).toBe(true)
    expect(q.get('X-Amz-Expires')).toBe('900')
    expect(q.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(fetcher).not.toHaveBeenCalled() // 纯本地签名：零网络
  })

  it('ttlSeconds 钳制上限：请求 999999 → X-Amz-Expires=600（预签名不比凭证活得久）', () => {
    const client = new S3SigV4Client({ ...CONFIG, ttlSeconds: 600 }, vi.fn())
    const url = client.getPresignedUrl('k', 999_999, T)
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('600')
  })

  it('未配置 ttlSeconds → 对齐 AWS 硬上限 604800；非法入值（0/负）兜底 1s', () => {
    const { client } = makeClient([])
    expect(new URL(client.getPresignedUrl('k', 999_999_999, T)).searchParams.get('X-Amz-Expires')).toBe('604800')
    expect(new URL(client.getPresignedUrl('k', 0, T)).searchParams.get('X-Amz-Expires')).toBe('1')
  })

  it('clockOffsetMs 校准进 X-Amz-Date（与请求签名同口径；对齐服务器时间 2s 容差）', () => {
    const serverMs = Date.UTC(2026, 0, 1, 12, 0, 0)
    const client = new S3SigV4Client(CONFIG, vi.fn())
    client.calibrateClock(new Response(null, { headers: { date: new Date(serverMs).toUTCString() } }))
    const url = client.getPresignedUrl('k')
    const amzDate = new URL(url).searchParams.get('X-Amz-Date') ?? ''
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate)
    const signedMs = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : NaN
    expect(Math.abs(signedMs - serverMs)).toBeLessThan(2_000)
  })
})

describe('presignPutUrl（分享「上传链接」：与 getPresignedUrl 完全同构，仅 method=PUT）', () => {
  /** 20260101T000000Z；nowMs 注入保证签名确定性 */
  const T = Date.UTC(2026, 0, 1, 0, 0, 0)

  it('字段对称：与 GET 链接共享全部预签名参数，仅 X-Amz-Signature 不同（method 参与签名）', () => {
    const { client } = makeClient([])
    const get = client.getPresignedUrl('docs/a b.txt', 3600, T)
    const put = client.presignPutUrl('docs/a b.txt', 3600, T)
    expect(put.startsWith('https://s3.test/bkt/docs/a%20b.txt?')).toBe(true)
    const getQ = new URL(get).searchParams
    const putQ = new URL(put).searchParams
    for (const name of ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-Security-Token', 'X-Amz-SignedHeaders']) {
      expect(putQ.get(name)).toBe(getQ.get(name))
    }
    expect(putQ.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(putQ.get('X-Amz-Signature')).not.toBe(getQ.get('X-Amz-Signature'))
  })

  it('默认 3600s；key 路径逐段编码；零网络（与 GET 同口径）', () => {
    const { fetcher, client } = makeClient([])
    const put = client.presignPutUrl('a dir/b.txt', undefined, T)
    expect(put.startsWith('https://s3.test/bkt/a%20dir/b.txt?')).toBe(true)
    expect(new URL(put).searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('ttlSeconds 钳制与非法入值兜底与 getPresignedUrl 完全一致', () => {
    const capped = new S3SigV4Client({ ...CONFIG, ttlSeconds: 600 }, vi.fn())
    expect(new URL(capped.presignPutUrl('k', 999_999, T)).searchParams.get('X-Amz-Expires')).toBe('600')
    const { client } = makeClient([])
    expect(new URL(client.presignPutUrl('k', 999_999_999, T)).searchParams.get('X-Amz-Expires')).toBe('604800')
    expect(new URL(client.presignPutUrl('k', 0, T)).searchParams.get('X-Amz-Expires')).toBe('1')
  })
})
