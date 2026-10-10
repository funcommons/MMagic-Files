/**
 * formatBytes 单测（R2-05：全仓文件大小统一口径）
 * 契约正本：format.ts 文件头——1024 基；「数值+空格+单位」；<100 一位小数否则整数；负数钳 0。
 * 消费方：TreePanel（树列表 size 列）、preview（largefile.rejected {limit}）、
 *        csv/markdown/code 渲染器（too-large {limit}）——口径必须与树列「6.3 MB」同源。
 */
import { describe, expect, it } from 'vitest'
import { formatBytes } from '../format'

const KB = 1024
const MB = 1024 * 1024
const GB = 1024 * 1024 * 1024

describe('formatBytes 字节格式化（R2-05 统一口径）', () => {
  it('字节段（<1024）：整数 + 空格 + B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(174)).toBe('174 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('KB 段：1024 基、<100 一位小数', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(99 * KB)).toBe('99.0 KB')
    expect(formatBytes(100 * KB)).toBe('100 KB') // ≥100 整数
  })

  it('MB 段：回归报告实测值（6.3 MB / 25.1 MB）与 100/999 整数口径', () => {
    expect(formatBytes(MB)).toBe('1.0 MB')
    expect(formatBytes(6.3 * MB)).toBe('6.3 MB')
    expect(formatBytes(25.1 * MB)).toBe('25.1 MB')
    expect(formatBytes(100 * MB)).toBe('100 MB')
    expect(formatBytes(999 * MB)).toBe('999 MB')
  })

  it('GB/TB 段：1 GiB/1 TiB 及以上', () => {
    expect(formatBytes(GB)).toBe('1.0 GB')
    expect(formatBytes(1.2 * GB)).toBe('1.2 GB')
    expect(formatBytes(1024 * GB)).toBe('1.0 TB')
    expect(formatBytes(2 * 1024 * GB)).toBe('2.0 TB')
    // 超出 TB 不再升单位（单位表末端钳制；≥100 整数口径）
    expect(formatBytes(1024 * 1024 * GB)).toBe('1024 TB')
  })

  it('负数钳 0（上游脏数据不产生 "-1 B" 口径）', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(-25 * MB)).toBe('0 B')
  })

  it('阈值邻域：恰好落单位边界与差 1 进位', () => {
    expect(formatBytes(1024 - 1)).toBe('1023 B')
    expect(formatBytes(1024 + 1)).toBe('1.0 KB')
    expect(formatBytes(MB - 1)).toBe('1024 KB') // ≥100 整数口径（Math.round）
    expect(formatBytes(MB + 1)).toBe('1.0 MB')
  })
})
