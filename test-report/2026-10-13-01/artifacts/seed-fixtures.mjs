#!/usr/bin/env node
// 回归边界夹具上传（临时脚本，不入仓）：huge.mmd / broken-mind.mmd / empty-graph.mmd
import { createHmac, createHash } from 'node:crypto'

const [endpoint, ak, sk, region, bucket] = process.argv.slice(2)
if (!endpoint || !ak || !sk || !region || !bucket) {
  console.error('usage: seed-fixtures.mjs <endpoint> <ak> <sk> <region> <bucket>')
  process.exit(1)
}
const sha256hex = (d) => createHash('sha256').update(d).digest('hex')
const hmac = (k, d) => createHmac('sha256', k).update(d).digest()
const amzDate = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')

function signedFetch(method, key, { body, contentType } = {}) {
  const url = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${key}`)
  const amzDt = amzDate()
  const dateStamp = amzDt.slice(0, 8)
  const payloadHash = body === undefined ? 'UNSIGNED-PAYLOAD' : sha256hex(body)
  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDt,
    ...(contentType ? { 'content-type': contentType } : {}),
  }
  const sorted = Object.keys(headers).sort()
  const canonicalHeaders = sorted.map((h) => `${h}:${headers[h]}\n`).join('')
  const canonicalRequest = [method, url.pathname, '', canonicalHeaders, sorted.join(';'), payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDt, scope, sha256hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${sk}`, dateStamp), region), 's3'), 'aws4_request')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${sorted.join(';')}, Signature=${createHmac('sha256', signingKey).update(stringToSign).digest('hex')}`
  return fetch(url, { method, headers, ...(body !== undefined ? { body } : {}) })
}

// ① huge.mmd：合法 graph TD，≈6MB（> 5MiB 预览闸）
const padLine = `%% ${'x'.repeat(1300)}`
const pad = Array.from({ length: 4300 }, () => padLine).join('\n')
const huge = `graph TD\n  S[开始] --> E[结束]\n${pad}\n`
// ② broken-mind.mmd：非 graph TD 语法且 mermaid 也无法渲染 → 降级失败提示
const brokenMind = 'mindmap\n  root((MM))\n    分支\n  @@@@ 非法记号 []]] {{{\n'
// ②b broken-tab.mmd：mindmap + tab 缩进（mermaid 已知解析错误）→ 降级失败提示
const brokenTab = 'mindmap\n  root((MM))\n\t分支(tab缩进)\n'
// ③ empty-graph.mmd：只有 header，0 节点 0 边 → 内部降级只读渲染
const emptyGraph = 'graph TD\n'

for (const [key, body] of [
  ['apps-demo/diagrams/huge.mmd', huge],
  ['apps-demo/diagrams/broken-mind.mmd', brokenMind],
  ['apps-demo/diagrams/broken-tab.mmd', brokenTab],
  ['apps-demo/diagrams/empty-graph.mmd', emptyGraph],
]) {
  const res = await signedFetch('PUT', key, { body, contentType: 'text/plain; charset=utf-8' })
  console.log(res.ok ? `OK  ${key} (${body.length}B)` : `FAIL ${key} ${res.status} ${await res.text()}`)
}
