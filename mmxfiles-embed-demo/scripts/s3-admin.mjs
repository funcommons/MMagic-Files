#!/usr/bin/env node
/**
 * s3-admin.mjs —— 演示环境 S3 管理小工具（SigV4 头签名，UNSIGNED-PAYLOAD）
 *
 *   node scripts/s3-admin.mjs <endpoint> <ak> <sk> <region> <command> [args...]
 *   commands:
 *     listBuckets
 *     createBucket <bucket>
 *     seed <bucket>            （灌入演示种子对象；目录见 SEEDS）
 *
 *   例：node scripts/s3-admin.mjs http://localhost:9000 rag_flow infini_rag_flow us-east-1 seed mmagic-demo
 */
import { createHmac, createHash } from 'node:crypto'

const [endpoint, ak, sk, region, cmd, ...args] = process.argv.slice(2)
if (!endpoint || !ak || !sk || !region || !cmd) {
  console.error('usage: s3-admin.mjs <endpoint> <ak> <sk> <region> <listBuckets|createBucket|seed> [args]')
  process.exit(1)
}

const sha256hex = (s) => createHash('sha256').update(s).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()
const amzDate = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** SigV4 头签名（path-style；UNSIGNED-PAYLOAD——MinIO/s3rver 皆接受） */
function signedFetch(method, path, { query = {}, body, contentType } = {}) {
  const url = new URL(endpoint.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)) // path-style：endpoint/bucket/key
  const amzDt = amzDate()
  const dateStamp = amzDt.slice(0, 8)
  const payloadHash = body === undefined ? 'UNSIGNED-PAYLOAD' : sha256hex(body)
  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDt,
    ...(contentType ? { 'content-type': contentType } : {}),
  }
  const sortedHeaders = Object.keys(headers).sort()
  const canonicalHeaders = sortedHeaders.map((h) => `${h}:${headers[h]}\n`).join('')
  const signedHeaders = sortedHeaders.join(';')
  const canonicalQuery = Object.keys(query).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&')
  const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDt, scope, sha256hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${sk}`, dateStamp), region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const qs = new URLSearchParams(query).toString()
  return fetch(`${url.origin}${url.pathname}${qs ? '?' + qs : ''}`, {
    method, headers, ...(body !== undefined ? { body } : {}),
  })
}

const SEEDS = [
  { key: 'hello.md', type: 'text/markdown; charset=utf-8',
    body: `# MMagic-Files × MinIO 演示\n\n这是一份由 **MinIO** 提供的 Markdown 对象（SigV4 签名写入）。\n\n- 目录树左侧应能看到它\n- 点开即渲染预览\n- 编辑保存（Ctrl+S）→ putObject 走 SigV4 PUT\n\n> endpoint: ${endpoint} · bucket: {BUCKET} · region: ${region}\n` },
  { key: 'notes/meeting.md', type: 'text/markdown; charset=utf-8',
    body: `# 会议纪要\n\n## 事项\n1. iframe 接入演示走通（ready 握手 → workspace 装载）\n2. SigV4 签名请求被 MinIO 受理\n\n## 待办\n- [ ] 上传一张图片试试预览\n- [ ] 拖拽一个文件进树面板\n` },
  { key: 'demo.csv', type: 'text/csv; charset=utf-8',
    body: `id,name,city,amount\n1,Alice,杭州,120.50\n2,Bob,上海,89.00\n3,Carol,深圳,240.75\n4,Dave,北京,15.20\n` },
  { key: 'logo.svg', type: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="16" fill="#409eff"/><text x="60" y="70" font-size="40" fill="#fff" text-anchor="middle" font-family="sans-serif">MF</text></svg>\n` },
]

if (cmd === 'listBuckets') {
  const res = await signedFetch('GET', '/')
  const text = await res.text()
  console.log(res.status, text.slice(0, 800))
} else if (cmd === 'createBucket') {
  const bucket = args[0]
  const res = await signedFetch('PUT', `/${bucket}`)
  console.log(`createBucket ${bucket}:`, res.status, res.status === 200 ? '✓' : await res.text())
} else if (cmd === 'seed') {
  const bucket = args[0]
  let fail = 0
  for (const { key, type, body } of SEEDS) {
    const b = body.replaceAll('{BUCKET}', bucket)
    const res = await signedFetch('PUT', `/${bucket}/${key}`, { body: b, contentType: type })
    console.log(`seed ${res.ok ? '✓' : '✗'} ${bucket}/${key} (${b.length}B)`, res.ok ? '' : await res.text())
    if (!res.ok) fail++
  }
  process.exit(fail ? 1 : 0)
} else {
  console.error(`unknown command: ${cmd}`)
  process.exit(1)
}
