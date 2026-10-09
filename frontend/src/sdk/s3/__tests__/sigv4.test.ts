/**
 * SigV4 签名测试
 * 金样本（golden vector）均用 python/openssl 独立推算，与实现零耦合：
 * - Case A 对齐 AWS 官方 SigV4 test-suite 的 get-vanilla 用例
 * - Case B 覆盖 S3 场景：query 编码 + payload 哈希 + sessionToken
 * - presignGet（查询串预签名）：金样本 + node:crypto 按公开口径独立复算签名
 */
import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { S3Credentials } from '../../types'
import { encodeRfc3986, formatAmzDate, hmacSha256Sync, observeServerDate, presignGet, sha256HexSync, signRequest } from '../sigv4'

const AK_SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
/** 无 sessionToken（空串 → 不带 x-amz-security-token） */
const CREDS_NO_TOKEN: S3Credentials = { accessKeyId: 'AKIDEXAMPLE', accessKeySecret: AK_SECRET, sessionToken: '' }
const CREDS_TOKEN: S3Credentials = { accessKeyId: 'AKID-TEST', accessKeySecret: 'SECRET-TEST-KEY', sessionToken: 'STStoken123' }

/** 20150830T123600Z（AWS test-suite 固定时刻） */
const T_A = Date.UTC(2015, 7, 30, 12, 36, 0)
/** 20260101T000000Z */
const T_B = Date.UTC(2026, 0, 1, 0, 0, 0)

describe('signRequest 金样本', () => {
  it('Case A：AWS 官方 get-vanilla 签名逐字命中', async () => {
    const signed = await signRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      credentials: CREDS_NO_TOKEN,
      region: 'us-east-1',
      service: 'service',
      nowMs: T_A,
    })
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    )
    // 空串 sessionToken 不产生 security-token 头
    expect(signed['x-amz-security-token']).toBeUndefined()
  })

  it('Case B：S3 PUT 带 query/body/sessionToken 逐字命中', async () => {
    const signed = await signRequest({
      method: 'PUT',
      // 路径已按 RFC3986 编码（%20 空格 / %2B 加号），query 值已编码
      url: 'https://s3.test/bucket/up%20load/a%2Bb.txt?partNumber=2&uploadId=abc%2F123%2Bdef%3D',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
      credentials: CREDS_TOKEN,
      region: 'us-east-1',
      nowMs: T_B,
    })
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKID-TEST/20260101/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token, ' +
        'Signature=e3e41fb80b8624849f1fc4dd70ce28d2321d4f5bbfe834f5a2ea3aa52c9a8cc9',
    )
    expect(signed['x-amz-content-sha256']).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(signed['x-amz-security-token']).toBe('STStoken123')
  })

  it('确定性：同输入两次签名完全一致', async () => {
    const make = () =>
      signRequest({
        method: 'PUT',
        url: 'https://s3.test/bkt/a%20b/c.txt?uploadId=u%2F1',
        headers: { 'x-amz-copy-source': '/bkt/x' },
        body: 'payload',
        credentials: CREDS_TOKEN,
        region: 'cn-test-1',
        nowMs: T_B,
      })
    expect(await make()).toEqual(await make())
  })
})

describe('signRequest 头集合', () => {
  it('关键头齐全且格式正确', async () => {
    const signed = await signRequest({
      method: 'GET',
      url: 'https://s3.test/bkt/k.txt',
      credentials: CREDS_TOKEN,
      region: 'us-east-1',
      nowMs: T_B,
    })
    expect(signed.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID-TEST\/20260101\/us-east-1\/s3\/aws4_request, SignedHeaders=[\w;-]+, Signature=[0-9a-f]{64}$/)
    expect(signed['x-amz-date']).toBe('20260101T000000Z')
    // undefined body → 空串哈希
    expect(signed['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    // host 只参与签名，不返回（浏览器 fetch 按 URL 自动携带）
    expect(signed['host']).toBeUndefined()
  })

  it('clockOffsetMs 校正 x-amz-date（§4.3）', async () => {
    const base = { method: 'GET', url: 'https://s3.test/bkt/k', credentials: CREDS_NO_TOKEN, region: 'us-east-1', nowMs: T_B }
    expect((await signRequest({ ...base, clockOffsetMs: 3_600_000 }))['x-amz-date']).toBe('20260101T010000Z')
    expect((await signRequest({ ...base, clockOffsetMs: -90_000 }))['x-amz-date']).toBe('20251231T235830Z')
  })

  it('unsignedPayload → x-amz-content-sha256 用 UNSIGNED-PAYLOAD', async () => {
    const signed = await signRequest({
      method: 'PUT',
      url: 'https://s3.test/bkt/big.bin',
      body: 'ignored',
      unsignedPayload: true,
      credentials: CREDS_NO_TOKEN,
      region: 'us-east-1',
      nowMs: T_B,
    })
    expect(signed['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD')
  })

  it('body 各形态（string/Blob/Uint8Array）哈希一致', async () => {
    const base = { method: 'PUT', url: 'https://s3.test/bkt/k', credentials: CREDS_NO_TOKEN, region: 'us-east-1', nowMs: T_B }
    const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    expect((await signRequest({ ...base, body: 'hello' }))['x-amz-content-sha256']).toBe(expected)
    expect((await signRequest({ ...base, body: new Blob(['hello']) }))['x-amz-content-sha256']).toBe(expected)
    expect((await signRequest({ ...base, body: new TextEncoder().encode('hello') }))['x-amz-content-sha256']).toBe(expected)
  })

  it('header 名大小写归一、值多余空白折叠，不影响签名', async () => {
    const base = { method: 'GET', url: 'https://s3.test/bkt/k', credentials: CREDS_NO_TOKEN, region: 'us-east-1', nowMs: T_B }
    const a = await signRequest({ ...base, headers: { 'Content-Type': 'text/plain' } })
    const b = await signRequest({ ...base, headers: { 'CONTENT-TYPE': '  text/plain  ' } })
    expect(a.authorization).toBe(b.authorization)
    // 业务头原样回传（小写键），fetch 可直接并入
    expect(a['content-type']).toBe('text/plain')
    expect(a.authorization).toContain('SignedHeaders=content-type;host;')
  })

  it('不同请求内容产生不同签名（防串号）', async () => {
    const base = { method: 'GET', credentials: CREDS_NO_TOKEN, region: 'us-east-1', nowMs: T_B }
    const a = await signRequest({ ...base, url: 'https://s3.test/bkt/a' })
    const b = await signRequest({ ...base, url: 'https://s3.test/bkt/b' })
    expect(a.authorization).not.toBe(b.authorization)
  })
})

describe('observeServerDate（§4.3 时钟偏移补偿）', () => {
  it('服务器快 1 分钟 → offset = +60s', () => {
    const server = Date.UTC(2026, 0, 1, 12, 0, 0)
    const offset = observeServerDate(new Date(server).toUTCString(), server - 60_000)
    expect(offset).toBe(60_000)
  })

  it('服务器慢 → offset 为负', () => {
    const server = Date.UTC(2026, 0, 1, 12, 0, 0)
    expect(observeServerDate(new Date(server).toUTCString(), server + 5_000)).toBe(-5_000)
  })

  it('非法 Date 头 → 0（不校准）', () => {
    expect(observeServerDate('not-a-date', Date.now())).toBe(0)
  })
})

describe('工具函数', () => {
  it('formatAmzDate 输出 UTC basic 格式', () => {
    expect(formatAmzDate(Date.UTC(2026, 0, 1, 7, 8, 9))).toBe('20260101T070809Z')
  })

  it('encodeRfc3986 按 RFC3986 保留字编码', () => {
    expect(encodeRfc3986('a b+c~d-e_f.g')).toBe('a%20b%2Bc~d-e_f.g')
    expect(encodeRfc3986("!'()*")).toBe('%21%27%28%29%2A')
    expect(encodeRfc3986('目录/文件')).toBe('%E7%9B%AE%E5%BD%95%2F%E6%96%87%E4%BB%B6')
  })
})

describe('presignGet（查询串 SigV4 预签名）', () => {
  /** Case C 金样本：node:crypto 按 AWS Presigned URL 公开口径独立推算（与实现零耦合） */
  const GOLDEN =
    'https://s3.test/bkt/docs/a%20b.txt' +
    '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
    '&X-Amz-Credential=AKID-TEST%2F20260101%2Fus-east-1%2Fs3%2Faws4_request' +
    '&X-Amz-Date=20260101T000000Z' +
    '&X-Amz-Expires=3600' +
    '&X-Amz-Security-Token=STStoken123' +
    '&X-Amz-SignedHeaders=host' +
    '&X-Amz-Signature=9d3bc9a14e0a41fd8037ac6535da9828bc8f6b3f1bb2d55b80643b62bc1a7d4f'

  it('金样本：预签名 URL 逐字命中（字段齐全 + 签名独立复算一致）', () => {
    const url = presignGet({
      url: 'https://s3.test/bkt/docs/a%20b.txt',
      expiresSec: 3600,
      credentials: CREDS_TOKEN,
      region: 'us-east-1',
      nowMs: T_B,
    })
    expect(url).toBe(GOLDEN)
  })

  it('字段齐全：Algorithm/Credential/Date/Expires/SignedHeaders=host/Signature；host 不入查询串', () => {
    const url = presignGet({ url: 'https://s3.test/bkt/k', expiresSec: 60, credentials: CREDS_TOKEN, region: 'us-east-1', nowMs: T_B })
    const q = new URL(url).searchParams
    expect(q.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(q.get('X-Amz-Credential')).toBe('AKID-TEST/20260101/us-east-1/s3/aws4_request')
    expect(q.get('X-Amz-Date')).toBe('20260101T000000Z')
    expect(q.get('X-Amz-Expires')).toBe('60')
    expect(q.get('X-Amz-SignedHeaders')).toBe('host')
    expect(q.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    // host 只参与签名（CanonicalHeaders），不作为查询参数出现
    expect(url).not.toContain('host=')
  })

  it('签名可复算：从 URL 自身参数按 AWS 规范用 node:crypto 独立重建签名并比对', () => {
    const url = presignGet({ url: 'https://s3.test/bkt/p%20q/x%2By.bin', expiresSec: 900, credentials: CREDS_TOKEN, region: 'cn-test-1', nowMs: T_B })
    const u = new URL(url)
    const q = u.searchParams
    const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    // 规范化查询串：除 X-Amz-Signature 外逐对重编码排序
    const pairs = Array.from(q.entries())
      .filter(([n]) => n !== 'X-Amz-Signature')
      .map(([n, v]) => [enc(n), enc(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const canonicalRequest = [
      'GET',
      u.pathname,
      pairs.map(([n, v]) => `${n}=${v}`).join('&'),
      `host:${u.host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')
    const scope = q.get('X-Amz-Credential')!.split('/').slice(1).join('/')
    const stringToSign = ['AWS4-HMAC-SHA256', q.get('X-Amz-Date')!, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
    const hmac = (key: string | Uint8Array | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()
    const [, region, service] = scope.split('/')
    let key = hmac(`AWS4${CREDS_TOKEN.accessKeySecret}`, q.get('X-Amz-Date')!.slice(0, 8))
    key = hmac(key, region!)
    key = hmac(key, service!)
    key = hmac(key, 'aws4_request')
    expect(hmac(key, stringToSign).toString('hex')).toBe(q.get('X-Amz-Signature'))
  })

  it('无 sessionToken → 无 X-Amz-Security-Token', () => {
    const url = presignGet({ url: 'https://s3.test/bkt/k', expiresSec: 60, credentials: CREDS_NO_TOKEN, region: 'us-east-1', nowMs: T_B })
    expect(new URL(url).searchParams.get('X-Amz-Security-Token')).toBeNull()
  })

  it('确定性：同输入同输出；expiresSec 变化 → 签名变化（Expires 参与签名）', () => {
    const base = { url: 'https://s3.test/bkt/k', credentials: CREDS_TOKEN, region: 'us-east-1', nowMs: T_B }
    expect(presignGet({ ...base, expiresSec: 3600 })).toBe(presignGet({ ...base, expiresSec: 3600 }))
    expect(presignGet({ ...base, expiresSec: 3600 })).not.toBe(presignGet({ ...base, expiresSec: 1200 }))
  })
})

describe('同步 SHA-256 / HMAC-SHA256（presign 专用：契约同步、WebCrypto 无同步面）', () => {
  it('sha256HexSync 命中标准向量（空串 / abc）', () => {
    expect(sha256HexSync(new TextEncoder().encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256HexSync(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('sha256HexSync 与 WebCrypto 结果一致（跨实现互证，含 >64B 跨块输入）', async () => {
    const long = 'mmagic presign cross-check '.repeat(20) // 540B：跨多块 + 非对齐
    const bytes = new TextEncoder().encode(long)
    const webcryptoHex = bufToHex(await crypto.subtle.digest('SHA-256', bytes))
    expect(sha256HexSync(bytes)).toBe(webcryptoHex)
  })

  it('hmacSha256Sync 命中 RFC 4231 Case 2；与 WebCrypto 互证', async () => {
    const key = new TextEncoder().encode('Jefe')
    const msg = 'what do ya want for nothing?'
    expect(Buffer.from(hmacSha256Sync(key, msg)).toString('hex')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
    // 互证：>64B key（需先哈希的分支）
    const longKey = new TextEncoder().encode('k'.repeat(100))
    const cryptoKey = await crypto.subtle.importKey('raw', longKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expected = bufToHex(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg)))
    expect(Buffer.from(hmacSha256Sync(longKey, msg)).toString('hex')).toBe(expected)
  })
})

function bufToHex(buf: ArrayBuffer): string {
  let hex = ''
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0')
  return hex
}
