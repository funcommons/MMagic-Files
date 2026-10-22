#!/usr/bin/env node
/**
 * seed-apps.mjs —— 全应用演示种子：本地生成覆盖每个内置应用的样例文件，SigV4 上传到 MinIO。
 *
 *   node scripts/seed-apps.mjs <endpoint> <ak> <sk> <region> <bucket>
 *   例：node scripts/seed-apps.mjs http://localhost:9000 rag_flow infini_rag_flow us-east-1 mmagic-demo
 *
 * 生成矩阵（apps-demo/ 前缀）：
 *   images/ photo.{png,jpg,gif,webp,bmp,heic}   → image-viewer / image-painter
 *   media/  clip.{mp4,webm,mov} tone.{mp3,wav,ogg,flac,m4a} → video-player / audio-player
 *   docs/   sample.pdf sample.docx sample.xlsx big.md       → pdf/docx/xlsx-viewer / markdown-renderer
 *   code/   main.py app.ts data.json config.yaml page.html style.css run.sh query.sql
 *           notes.txt app.log server.conf app.ini app.env data.tsv → code-editor / csv-table
 * 依赖：node:zlib（PNG/zip 手写）、sips（jpg/gif/bmp/heic 转码）、ffmpeg（webp/视频/音频）。
 */
import { execFileSync } from 'node:child_process'
import { createHmac, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const [endpoint, ak, sk, region, bucket] = process.argv.slice(2)
if (!endpoint || !ak || !sk || !region || !bucket) {
  console.error('usage: seed-apps.mjs <endpoint> <ak> <sk> <region> <bucket>')
  process.exit(1)
}

// ───────────────────────── SigV4（同 s3-admin.mjs 口径：path-style + UNSIGNED-PAYLOAD） ─────────────────────────
const sha256hex = (s) => createHash('sha256').update(s).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()
const amzDate = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

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

// ───────────────────────── 基础编码器：CRC32 / PNG / BMP / ZIP(store) / PDF ─────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** 24-bit 真彩 PNG（无依赖手写：filter 0 + zlib deflate） */
function makePng(width, height, pixelFn) {
  const stride = 1 + width * 3
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y)
      const o = y * stride + 1 + x * 3
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit truecolor
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 24-bit BMP（行 4 字节对齐，bottom-up） */
function makeBmp(width, height, pixelFn) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const px = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, height - 1 - y)
      const o = y * rowSize + x * 3
      px[o] = b; px[o + 1] = g; px[o + 2] = r
    }
  const fh = Buffer.alloc(14); const ih = Buffer.alloc(40)
  fh.write('BM'); fh.writeUInt32LE(54 + px.length, 2); fh.writeUInt32LE(54, 10)
  ih.writeUInt32LE(40, 0); ih.writeInt32LE(width, 4); ih.writeInt32LE(height, 8)
  ih.writeUInt16LE(1, 12); ih.writeUInt16LE(24, 14); ih.writeUInt32LE(px.length, 20)
  return Buffer.concat([fh, ih, px])
}

/** 演示像素：彩虹渐变 + 白色方块角标（视觉可辨，非纯色） */
const demoPixel = (x, y) => {
  const inBox = x > 12 && x < 60 && y > 12 && y < 60
  if (inBox) return [255, 255, 255]
  return [Math.round((x / 256) * 255), Math.round((y / 160) * 255), 128 + Math.round(127 * Math.sin(x / 20))]
}

/** ZIP(store 不压缩)——docx/xlsx 最小 OOXML 包足够（Word/Excel 接受 stored 条目） */
function zipStore(entries) {
  const parts = []; const central = []; let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6) // UTF-8 flag
    lh.writeUInt16LE(0, 8) // stored
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x548c, 12)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    parts.push(lh, nameBuf, data)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x548c, 14)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([ch, nameBuf]))
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, eocd])
}

const xml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function makeDocx() {
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>MMagic-Files DOCX 演示</w:t></w:r></w:p>
<w:p><w:r><w:t>这是由 seed-apps.mjs 生成的最小 OOXML 文档（stored zip），用于演示 docx-viewer。</w:t></w:r></w:p>
<w:p><w:r><w:t>要点：S3 直连、iframe 嵌入、多应用打开方式。</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>
</w:body></w:document>`) },
  ])
}

function makeXlsx() {
  const rows = [
    ['应用', '类型', '演示文件'],
    ['image-viewer', 'view', 'images/photo.png'],
    ['video-player', 'view', 'media/clip.mp4'],
    ['code-editor', 'edit', 'code/main.py'],
    ['csv-table', 'view', 'code/data.tsv'],
  ]
  const cell = (v, ref) =>
    `<c r="${ref}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`
  const rowXml = rows
    .map((cells, i) => `<row r="${i + 1}">${cells.map((v, j) => cell(v, `${String.fromCharCode(65 + j)}${i + 1}`)).join('')}</row>`)
    .join('')
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="应用清单" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`) },
  ])
}

function makePdf() {
  const text = 'BT /F1 24 Tf 72 760 Td (MMagic-Files PDF Demo) Tj ET\nBT /F1 12 Tf 72 720 Td (Generated by seed-apps.mjs - one page, Helvetica.) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefAt = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// ───────────────────────── 本地工作区 ─────────────────────────
const WORK = join(tmpdir(), 'mmf-seed-apps')
rmSync(WORK, { recursive: true, force: true })
mkdirSync(join(WORK, 'out'), { recursive: true })
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' })

/** sips 转码（png → jpg/gif/bmp/heic） */
function sipsFromPng(fmt, outName) {
  const src = join(WORK, 'base.png')
  writeFileSync(src, makePng(256, 160, demoPixel))
  run('sips', ['-s', 'format', fmt, src, '--out', join(WORK, 'out', outName)])
  return readFileSync(join(WORK, 'out', outName))
}

/** ffmpeg lavfi 生成（失败即跳过并告警，不阻塞种子） */
function ffmpeg(outName, args) {
  try {
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, join(WORK, 'out', outName)])
    return readFileSync(join(WORK, 'out', outName))
  } catch (e) {
    console.warn(`  ⚠ ffmpeg 生成 ${outName} 失败，跳过：`, String(e).slice(0, 120))
    return null
  }
}

// ───────────────────────── 生成清单（key → {type, body, contentType}） ─────────────────────────
const files = []
const add = (key, contentType, body) => files.push({ key, contentType, body: Buffer.isBuffer(body) ? body : Buffer.from(body) })

// images/：image-viewer 全格式（含 heic-viewer 的 heic）
add('apps-demo/images/photo.png', 'image/png', makePng(256, 160, demoPixel))
add('apps-demo/images/photo.bmp', 'image/bmp', makeBmp(256, 160, demoPixel))
add('apps-demo/images/photo.jpg', 'image/jpeg', sipsFromPng('jpeg', 'photo.jpg'))
add('apps-demo/images/photo.gif', 'image/gif', sipsFromPng('gif', 'photo.gif'))
add('apps-demo/images/photo.heic', 'image/heic', sipsFromPng('heic', 'photo.heic'))
// 本机 ffmpeg 无 libwebp → 用 cwebp（webp 官方编码器；无则跳过）
let webpBody = null
try {
  const src = join(WORK, 'base.png')
  writeFileSync(src, makePng(256, 160, demoPixel))
  run('cwebp', ['-quiet', src, '-o', join(WORK, 'out', 'photo.webp')])
  webpBody = readFileSync(join(WORK, 'out', 'photo.webp'))
} catch (e) {
  console.warn('  ⚠ cwebp 生成 photo.webp 失败，跳过：', String(e).slice(0, 120))
}
files.push({ key: 'apps-demo/images/photo.webp', contentType: 'image/webp', body: webpBody })

// media/：video-player / audio-player
for (const [name, fmt, args] of [
  ['clip.mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
  ['clip.webm', 'video/webm', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-c:v', 'libvpx', '-b:v', '200k']],
  ['clip.mov', 'video/quicktime', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'mov']],
  ['tone.mp3', 'audio/mpeg', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame']],
  ['tone.wav', 'audio/wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'pcm_s16le']],
  ['tone.ogg', 'audio/ogg', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libopus']], // 本机无 libvorbis：ogg/opus 浏览器可解码
  ['tone.flac', 'audio/flac', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'flac']],
  ['tone.m4a', 'audio/mp4', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac']],
]) files.push({ key: `apps-demo/media/${name}`, contentType: fmt, body: ffmpeg(name, args) })

// docs/：pdf / docx / xlsx / markdown 大样例
add('apps-demo/docs/sample.pdf', 'application/pdf', makePdf())
add('apps-demo/docs/sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', makeDocx())
add('apps-demo/docs/sample.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', makeXlsx())
add('apps-demo/docs/big.md', 'text/markdown; charset=utf-8', `# 全功能演示文档\n\n## 支持的应用矩阵\n\n| 应用 | 类型 |\n|---|---|\n| markdown-renderer | view |\n| code-editor | edit |\n\n- 列表项一\n- 列表项二\n\n> 引用块：由 seed-apps.mjs 生成。\n\n\`\`\`py\nprint("hello mmagic-files")\n\`\`\`\n`)
// markdown-editor 插件样例：合法 mermaid（流程+时序）+ 一个语法坏块（验证单块失败不中断其余块）
add('apps-demo/docs/sample.md', 'text/markdown; charset=utf-8', `# Markdown 编辑器样例\n\n支持 **mermaid** 内置渲染、三形态（源码/双窗/预览）与保存回写。\n\n| 特性 | 状态 |\n|---|---|\n| 双窗联动 | ✅ |\n| mermaid | ✅ |\n| 保存链 | ✅ |\n\n## 合法流程图\n\n\`\`\`mermaid\ngraph TD\n  A[打开文件] --> B{形态?}\n  B -->|源码| C[编辑器]\n  B -->|双窗| D[编辑+预览]\n  B -->|预览| E[只读渲染]\n  D --> F[Ctrl+S 保存]\n\`\`\`\n\n## 合法时序图\n\n\`\`\`mermaid\nsequenceDiagram\n  participant H as 宿主\n  participant S as 文件服务\n  H->>S: openFile(sample.md)\n  S-->>H: tabId\n\`\`\`\n\n## 语法坏块（静默降级普通代码块）\n\n\`\`\`mermaid\ngraph TD\n  A-->\n\`\`\`\n`)

// diagrams/：mermaid-viewer 四类图（流程/时序/脑图/架构）
add('apps-demo/diagrams/approval.mmd', 'text/plain; charset=utf-8', `graph TD
  %% meta: schema=v1
  %% meta: B {"owner":"张三","sla":"4h"}
  A[提交申请] --> B{审批}
  B -->|通过| C[归档]
  B -->|驳回| A
  C --> D((结束))
`)
add('apps-demo/diagrams/login-seq.mmd', 'text/plain; charset=utf-8', `sequenceDiagram
  participant U as 用户
  participant F as 前端
  participant S as 服务端
  U->>F: 输入账密
  F->>S: POST /login
  alt 校验通过
    S-->>F: 200 token
    F-->>U: 进入工作台
  else 校验失败
    S-->>F: 401
    F-->>U: 提示重试
  end
`)
add('apps-demo/diagrams/product-mind.mmd', 'text/plain; charset=utf-8', `mindmap
  root((MMagic-Files))
    预览
      图片
      文档
      图示
    编辑
      代码
      画板
    嵌入
      iframe
      JSSDK
`)
add('apps-demo/diagrams/system-arch.mmd', 'text/plain; charset=utf-8', `architecture-beta
  group cloud(logos:aws-lambda)[云侧]
  service s3(logos:aws-s3)[S3 存储] in cloud
  service db(logos:aws-rds)[数据库] in cloud
  service fe(logos:react)[前端工作台]
  fe:R --> L:s3
  fe:B --> T:db
`)

// code/：code-editor 文本矩阵 + csv-table 的 tsv
const codeSamples = {
  'main.py': ['# 演示：Python 源码（code-editor）', 'def greet(name: str) -> str:', '    return f"hello, {name}!"', '', 'print(greet("mmagic-files"))', ''],
  'app.ts': ['// 演示：TypeScript 源码（code-editor）', 'export const answer = 42', 'export const greet = (n: string): string => `hi, ${n}`', ''],
  'data.json': ['{', '  "name": "mmagic-files",', '  "apps": 12,', '  "tags": ["s3", "iframe", "preview"]', '}'],
  'config.yaml': ['# 演示：YAML', 'server:', '  port: 9000', '  region: us-east-1', 'features:', '  multiTab: true'],
  'page.html': ['<!doctype html>', '<html lang="zh-CN">', '  <body>', '    <h1>MMagic-Files HTML 演示</h1>', '  </body>', '</html>'],
  'style.css': ['/* 演示：CSS */', '.demo {', '  color: var(--app-text-primary);', '  padding: 2px;', '}'],
  'run.sh': ['#!/bin/sh', '# 演示：Shell', 'echo "hello from mmagic-files"', ''],
  'query.sql': ['-- 演示：SQL', "SELECT key, size FROM objects WHERE prefix = 'apps-demo/' ORDER BY size DESC;", ''],
  'notes.txt': ['纯文本演示（code-editor 文本态）。', 'MMagic-Files 支持双击打开与 Ctrl+S 保存。', ''],
  'app.log': ['2026-10-12T10:00:00Z INFO  boot ok (mode=workspace)', '2026-10-12T10:00:01Z INFO  registry: 12 apps registered', '2026-10-12T10:00:02Z INFO  ready handshake complete', ''],
  'server.conf': ['# 演示：conf', 'listen 9000', 'bucket mmagic-demo', 'region us-east-1'],
  'app.ini': ['; 演示：ini', '[demo]', 'enabled = true', 'apps = 12'],
  'app.env': ['# 演示：env', 'VITE_S3_ENDPOINT=http://localhost:9000', 'VITE_S3_BUCKET=mmagic-demo'],
  'data.tsv': ['id\tname\tscore', '1\tAlice\t98.5', '2\tBob\t87.0', '3\tCarol\t92.5'],
}
for (const [name, lines] of Object.entries(codeSamples))
  add(`apps-demo/code/${name}`, 'text/plain; charset=utf-8', lines.join('\n'))

// ───────────────────────── 上传 ─────────────────────────
let ok = 0
let fail = 0
for (const { key, contentType, body } of files) {
  if (!body) { fail++; continue }
  const res = await signedFetch('PUT', key, { body, contentType })
  const mark = res.ok ? '✓' : '✗'
  console.log(`seed ${mark} ${key} (${body.length}B)`)
  if (res.ok) ok++
  else { fail++; console.error('  ', await res.text()) }
}
console.log(`\n完成：${ok} 上传成功 / ${fail} 失败（bucket=${bucket} 前缀 apps-demo/）`)
console.log(`本地产物保留在 ${WORK}/out（供 unzip -t 抽验；tmp 重启自清）`)
process.exit(fail ? 1 : 0)
