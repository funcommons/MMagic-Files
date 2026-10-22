#!/usr/bin/env node
/**
 * single-file-server.mjs —— MMagic-Files #file（单文件模式）的读/写后端（演示用）
 *
 *   GET  /files/<name>   → 返回本地文件（不存在 404）；Content-Type 按扩展名
 *   PUT  /files/<name>   → 覆写本地文件（body 原样落盘）
 *   POST /files/<name>   → 同 PUT
 *   OPTIONS               → CORS 预检（演示全开）
 *
 * 端口 5210；文件落在 <repo>/single-file-data/<name>。
 * 用法：node single-file-server.mjs [dataDir]
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

const PORT = 5210
const dataDir = process.argv[2] || join(process.cwd(), 'single-file-data')
mkdirSync(dataDir, { recursive: true })

const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

createServer((req, res) => {
  const headers = { ...CORS }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers)
    res.end()
    return
  }
  const name = decodeURIComponent((req.url ?? '').replace(/^\/files\//, '').split('?')[0])
  if (!name || name.includes('..') || name.includes('/')) {
    res.writeHead(400, { ...headers, 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid file name' }))
    return
  }
  const path = join(dataDir, name)

  if (req.method === 'GET') {
    if (!existsSync(path)) {
      res.writeHead(404, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    res.writeHead(200, {
      ...headers,
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
    })
    res.end(readFileSync(path))
    return
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      writeFileSync(path, Buffer.concat(chunks))
      console.log(`[${new Date().toISOString()}] ${req.method} /files/${name} (${Buffer.concat(chunks).length} bytes)`)
      res.writeHead(200, { ...headers, 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, name, size: Buffer.concat(chunks).length }))
    })
    return
  }

  res.writeHead(405, { ...headers, 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'method not allowed' }))
}).listen(PORT, () => {
  console.log(`single-file-server listening on http://localhost:${PORT}/files/<name> (dataDir=${dataDir})`)
})
