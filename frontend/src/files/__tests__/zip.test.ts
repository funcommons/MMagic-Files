/**
 * zip 打包测试（Lane F5）：多选打包下载的 store 模式（level=0 防 CPU 尖峰）。
 * 断言：unzip 往返一致 / PK 字节结构（本地头+EOCD）/ store 不压缩 / 与 fflate 原生 zipSync 等价 / 上限常量。
 */
import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { ZIP_SIZE_LIMIT, zipStore } from '../zip'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('zipStore（多选打包下载）', () => {
  it('两文件打包可 unzip 往返（文件名与内容一致）', () => {
    const out = zipStore([
      { name: 'a.txt', data: enc('hello zip') },
      { name: 'b.json', data: enc('{"json":true}') },
    ])
    const un = unzipSync(out)
    expect(new TextDecoder().decode(un['a.txt'])).toBe('hello zip')
    expect(new TextDecoder().decode(un['b.json'])).toBe('{"json":true}')
  })

  it('字节结构：PK\\x03\\x04 本地头 + 尾部 EOCD（PK\\x05\\x06）', () => {
    const out = zipStore([{ name: 't.txt', data: enc('payload') }])
    expect([out[0], out[1], out[2], out[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
    const tail = out.slice(Math.max(0, out.length - 64))
    const eocd = tail.findIndex(
      (b, i) => b === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06,
    )
    expect(eocd).toBeGreaterThanOrEqual(0)
  })

  it('store 模式（level=0）：compression method=0 且产物不小于原文（不压缩）', () => {
    const text = enc('a'.repeat(2048)) // 高度可压缩文本
    const out = zipStore([{ name: 't.txt', data: text }])
    // 本地文件头：sig(4) + version(2) + flags(2) + method(2 @ offset 8)
    expect(out[8]).toBe(0)
    expect(out[9]).toBe(0)
    expect(out.length).toBeGreaterThanOrEqual(text.length)
  })

  it('与 fflate 原生 zipSync（level 0）字节等价（防依赖漂移）', () => {
    const data = enc('x')
    const mine = zipStore([{ name: 'x.txt', data }])
    const native = zipSync({ 'x.txt': [data, { level: 0 }] })
    expect(Buffer.from(mine).equals(Buffer.from(native))).toBe(true)
  })

  it('ZIP_SIZE_LIMIT = 256MB（打包预算上限常量）', () => {
    expect(ZIP_SIZE_LIMIT).toBe(256 * 1024 * 1024)
  })
})
