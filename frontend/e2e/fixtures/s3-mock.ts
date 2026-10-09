/**
 * S3 网络层 Mock（fixtures）——拦截 https://s3.mock.local 的 SigV4 请求并按特征应答。
 * 请求形态依据 src/sdk/s3/client.ts：
 *  - ListObjectsV2:  GET /{bucket}?list-type=2&prefix=..&delimiter=/[&continuation-token=..]
 *  - GetObject:      GET /{bucket}/{key}
 *  - PutObject:      PUT /{bucket}/{key}
 *  - CopyObject:     PUT /{bucket}/{toKey}（头 x-amz-copy-source）
 *  - DeleteObjects:  POST /{bucket}?delete（body XML）
 *  - Multipart:      POST ?uploads / PUT ?partNumber&uploadId / POST ?uploadId / DELETE ?uploadId
 * 失败开关（failListPrefix/failGetKey）为可变对象：测试中途翻转可模拟「先失败后恢复」（重试用）。
 */
import type { Page, Route } from '@playwright/test'
import { MOCK_BUCKET, MOCK_ENDPOINT } from './config'

export interface MockObject {
  bytes: Buffer
  contentType: string
  etag?: string
}

export interface S3MockState {
  /** 活动对象仓（PUT 会写入 → 后续 list 可见；DELETE 移除） */
  objects: Map<string, MockObject>
  listRequests: { prefix: string; continuationToken: string | null }[]
  getRequests: string[]
  putRequests: string[]
  copyRequests: { from: string; to: string }[]
  /** 每次 DeleteObjects 的 key 清单 */
  deleteRequests: string[][]
  multipartRequests: string[]
  /** 可变失败开关：prefix → HTTP status */
  failListPrefix: Record<string, number>
  /** 可变失败开关：key → HTTP status */
  failGetKey: Record<string, number>
  /** 慢 PUT 开关：key → 延迟毫秒（模拟慢上传，供 UploadPanel 取消钮等时序用例） */
  delayPutKeys: Record<string, number>
}

export interface S3MockOptions {
  endpoint?: string
  bucket?: string
  /** 预置对象 { key: { bytes, contentType } } */
  seed?: Record<string, { bytes: Buffer | string; contentType: string }>
  /** 初始失败开关 */
  failListPrefix?: Record<string, number>
  failGetKey?: Record<string, number>
  /** 这些 prefix 的 list 首页截断（IsTruncated + NextContinuationToken），测聚合翻页 */
  paginatePrefixes?: string[]
  /** 慢 PUT 开关：key → 延迟毫秒（应答前挂起，供上传取消等时序用例观察中间态） */
  delayPutKeys?: Record<string, number>
}

const XML_OK_HEADERS = { 'content-type': 'application/xml' }

function xmlEscape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
}

function errorXml(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`
}

export async function installS3Mock(page: Page, opts: S3MockOptions = {}): Promise<S3MockState> {
  const endpoint = opts.endpoint ?? MOCK_ENDPOINT
  const bucket = opts.bucket ?? MOCK_BUCKET
  const endpointHost = new URL(endpoint).hostname
  const paginatePrefixes = new Set(opts.paginatePrefixes ?? [])

  const state: S3MockState = {
    objects: new Map(),
    listRequests: [],
    getRequests: [],
    putRequests: [],
    copyRequests: [],
    deleteRequests: [],
    multipartRequests: [],
    failListPrefix: { ...(opts.failListPrefix ?? {}) },
    failGetKey: { ...(opts.failGetKey ?? {}) },
    delayPutKeys: { ...(opts.delayPutKeys ?? {}) },
  }
  for (const [k, v] of Object.entries(opts.seed ?? {})) {
    state.objects.set(k, { bytes: Buffer.from(v.bytes), contentType: v.contentType })
  }

  const bucketBase = `/${bucket}`

  async function handler(route: Route): Promise<void> {
    const req = route.request()
    const u = new URL(req.url())
    const method = req.method()
    const q = u.searchParams

    let key = ''
    if (u.pathname.startsWith(bucketBase + '/')) {
      key = decodeURIComponent(u.pathname.slice(bucketBase.length + 1))
    }

    // ── ListObjectsV2 ──
    if (method === 'GET' && q.get('list-type') === '2') {
      const prefix = q.get('prefix') ?? ''
      const token = q.get('continuation-token')
      state.listRequests.push({ prefix, continuationToken: token })

      const failStatus = state.failListPrefix[prefix]
      if (failStatus) {
        await route.fulfill({
          status: failStatus,
          headers: XML_OK_HEADERS,
          body: errorXml(failStatus === 403 ? 'AccessDenied' : 'InternalError', `mock list failure (${failStatus})`),
        })
        return
      }

      // 收集直接子目录与文件
      const dirs = new Set<string>()
      let files: string[] = []
      for (const k of state.objects.keys()) {
        if (!k.startsWith(prefix) || k === prefix) continue
        const rest = k.slice(prefix.length)
        const slash = rest.indexOf('/')
        if (slash === -1) {
          if (k.endsWith('/') && (state.objects.get(k)?.bytes.length ?? 0) === 0) continue // 纯目录标记
          files.push(k)
        } else {
          dirs.add(prefix + rest.slice(0, slash + 1))
        }
      }
      // 目录标记对象（key 以 / 结尾）归目录不归文件
      files = files.filter((k) => !k.endsWith('/'))
      const allFiles = [...files].sort()

      let pageFiles = allFiles
      let truncated = false
      let nextToken: string | null = null
      if (paginatePrefixes.has(prefix) && !token) {
        pageFiles = allFiles.slice(0, 1)
        truncated = allFiles.length > 1
        nextToken = truncated ? `token-${encodeURIComponent(prefix)}-2` : null
      } else if (token) {
        // 第二页：跳过首页已给的 1 条
        pageFiles = allFiles.slice(1)
      }

      const contentsXml = pageFiles
        .map((k) => {
          const o = state.objects.get(k)
          return `<Contents><Key>${xmlEscape(k)}</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified><ETag>&quot;${o?.etag ?? 'mock-etag'}&quot;</ETag><Size>${o?.bytes.length ?? 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`
        })
        .join('')
      const commonsXml = [...dirs]
        .sort()
        .map((p) => `<CommonPrefixes><Prefix>${xmlEscape(p)}</Prefix></CommonPrefixes>`)
        .join('')
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
        `<Name>${bucket}</Name><Prefix>${xmlEscape(prefix)}</Prefix><Delimiter>/</Delimiter>` +
        `<IsTruncated>${truncated}</IsTruncated>` +
        (nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : '') +
        contentsXml +
        commonsXml +
        `</ListBucketResult>`
      await route.fulfill({ status: 200, headers: XML_OK_HEADERS, body: xml })
      return
    }

    // ── GetObject / HEAD ──
    if (method === 'GET' || method === 'HEAD') {
      if (method === 'GET') state.getRequests.push(key)
      const failStatus = state.failGetKey[key]
      if (failStatus) {
        await route.fulfill({
          status: failStatus,
          headers: XML_OK_HEADERS,
          body: errorXml(failStatus === 403 ? 'AccessDenied' : 'InternalError', `mock get failure (${failStatus})`),
        })
        return
      }
      const o = state.objects.get(key)
      if (!o) {
        await route.fulfill({ status: 404, headers: XML_OK_HEADERS, body: errorXml('NoSuchKey', 'mock: no such key') })
        return
      }
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': o.contentType,
          etag: `"${o.etag ?? 'mock-etag'}"`,
          'last-modified': 'Wed, 01 Oct 2026 00:00:00 GMT',
        },
        body: o.bytes,
      })
      return
    }

    // ── CopyObject ──
    if (method === 'PUT' && req.headers()['x-amz-copy-source']) {
      const from = decodeURIComponent(req.headers()['x-amz-copy-source']!).replace(`/${bucket}/`, '')
      state.copyRequests.push({ from, to: key })
      const src = state.objects.get(from)
      if (src) state.objects.set(key, { ...src })
      await route.fulfill({
        status: 200,
        headers: XML_OK_HEADERS,
        body: `<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>&quot;copy-etag&quot;</ETag><LastModified>2026-10-01T00:00:00.000Z</LastModified></CopyObjectResult>`,
      })
      return
    }

    // ── PutObject ──
    if (method === 'PUT') {
      state.putRequests.push(key)
      const body = req.postDataBuffer() ?? Buffer.alloc(0)
      const delay = state.delayPutKeys[key] ?? 0
      if (delay > 0) await new Promise((r) => setTimeout(r, delay)) // 慢上传：留观察/取消窗口
      state.objects.set(key, {
        bytes: body,
        contentType: req.headers()['content-type'] ?? 'application/octet-stream',
      })
      await route.fulfill({ status: 200, headers: { etag: '"put-etag"' }, body: '' })
      return
    }

    // ── DeleteObjects ──
    if (method === 'POST' && q.has('delete')) {
      const body = req.postData() ?? ''
      const keys = [...body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!)
      state.deleteRequests.push(keys)
      for (const k of keys) state.objects.delete(k)
      await route.fulfill({
        status: 200,
        headers: XML_OK_HEADERS,
        body: `<?xml version="1.0" encoding="UTF-8"?><DeleteResult></DeleteResult>`,
      })
      return
    }

    // ── Multipart 族 ──
    if (method === 'POST' && q.has('uploads')) {
      state.multipartRequests.push(`create:${key}`)
      await route.fulfill({
        status: 200,
        headers: XML_OK_HEADERS,
        body: `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xmlEscape(key)}</Key><UploadId>mock-upload-id-1</UploadId></InitiateMultipartUploadResult>`,
      })
      return
    }
    if (method === 'PUT' && q.has('partNumber') && q.has('uploadId')) {
      state.multipartRequests.push(`part:${key}:${q.get('partNumber')}`)
      await route.fulfill({ status: 200, headers: { etag: `"part-${q.get('partNumber')}"` }, body: '' })
      return
    }
    if (method === 'POST' && q.has('uploadId')) {
      state.multipartRequests.push(`complete:${key}`)
      await route.fulfill({
        status: 200,
        headers: XML_OK_HEADERS,
        body: `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Location>https://${endpointHost}/${bucket}/${key}</Location><Bucket>${bucket}</Bucket><Key>${xmlEscape(key)}</Key><ETag>&quot;mpu-etag&quot;</ETag></CompleteMultipartUploadResult>`,
      })
      return
    }
    if (method === 'DELETE' && q.has('uploadId')) {
      state.multipartRequests.push(`abort:${key}`)
      await route.fulfill({ status: 204, body: '' })
      return
    }

    // 兜底：记录并 400
    await route.fulfill({ status: 400, headers: XML_OK_HEADERS, body: errorXml('UnhandledRequest', `${method} ${u.pathname}${u.search}`) })
  }

  await page.route((url) => url.hostname === endpointHost, handler)
  return state
}

/** 拦截并 abort 指定主机（模拟不可达插件 CDN） */
export async function abortHost(page: Page, hostname: string): Promise<void> {
  await page.route((url) => url.hostname === hostname, (route) => route.abort('connectionrefused'))
}

// ───────────────────────── 预置内容 ─────────────────────────

export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export const README_MD = [
  '# 欢迎使用 MMagic-Files',
  '',
  '这是 **加粗** 与 *斜体* 文本。',
  '',
  '[外链](https://example.com/mmagic)',
  '',
  '- 列表项 一',
  '- 列表项 二',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
  '',
].join('\n')

export const NOTES_TXT = ['hello mmagic', '第二行文本', 'function foo() { return 42 }'].join('\n')

export const DATA_CSV = 'name,age,city\nAlice,30,Beijing\nBob,25,Shanghai\nCarol,35,Shenzhen\n'

/** 非法 docx（非 zip 字节）→ docx-preview 降级路径 */
export const INVALID_DOCX = Buffer.from('this is definitely not a zip archive for docx preview')

/** 最小 mp4 头（ftyp box）——渲染器只挂 <video> 元素，不需可解码流 */
export function minimalMp4(): Buffer {
  const ftyp = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('isomiso2avc1mp41', 'ascii'),
  ])
  const free = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x08]), Buffer.from('free', 'ascii')])
  return Buffer.concat([ftyp, free])
}
