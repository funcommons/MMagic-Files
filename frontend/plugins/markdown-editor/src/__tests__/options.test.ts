/**
 * options.ts 单测（插件纯逻辑：参数归一化与形态解析）
 * 被测：plugins/markdown-editor/src/options.ts
 * 契约：方案 §二——优先级 initialMode > stored（本地存储） > defaultMode > DEFAULT_MODE('split')；
 *       非法值一律丢弃走下一级，不抛错；存储不可用静默。
 * 策略：storage 全注入内存 stub（getItem/setItem 普通对象），不触碰真实 localStorage；
 *       isMdMode 按实现断言（大小写敏感，不做 toLowerCase 宽松化）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODE,
  MD_MODES,
  MODE_STORAGE_KEY,
  isMdMode,
  normalizeOptions,
  readStoredMode,
  resolveInitialMode,
  writeStoredMode,
} from '../options'
import type { MdMode } from '../types'

// ───────────────────────── 常量导出 ─────────────────────────

describe('导出常量', () => {
  it('MD_MODES 为三合法形态且 DEFAULT_MODE/MODE_STORAGE_KEY 取值正确', () => {
    expect(MD_MODES).toEqual(['source', 'preview', 'split'])
    expect(DEFAULT_MODE).toBe('split')
    expect(MODE_STORAGE_KEY).toBe('mm-md-mode')
  })
})

// ───────────────────────── isMdMode ─────────────────────────

describe('isMdMode', () => {
  it('三个合法值（source/preview/split）→ true', () => {
    for (const m of MD_MODES) expect(isMdMode(m)).toBe(true)
  })

  it('非法/畸形值 → false（按实现：大小写敏感，不宽松化）', () => {
    expect(isMdMode('SOURCE')).toBe(false) // 大写 → 实现是大小写敏感的
    expect(isMdMode('')).toBe(false) // 空串
    expect(isMdMode(null)).toBe(false)
    expect(isMdMode(undefined)).toBe(false)
    expect(isMdMode(['source'])).toBe(false) // 数组不是 string
  })
})

// ───────────────────────── normalizeOptions ─────────────────────────

describe('normalizeOptions', () => {
  it('undefined/null/数组/字符串 → 空对象（非普通对象直接短路）', () => {
    expect(normalizeOptions(undefined)).toEqual({})
    expect(normalizeOptions(null)).toEqual({})
    expect(normalizeOptions(['split'])).toEqual({}) // 数组虽是 object 也拒绝
    expect(normalizeOptions('split')).toEqual({}) // 字符串拒绝
    expect(normalizeOptions({})).toEqual({}) // 空对象 → 空参数
  })

  it('合法 initialMode/defaultMode 原样保留', () => {
    expect(normalizeOptions({ initialMode: 'source', defaultMode: 'preview' })).toEqual({
      initialMode: 'source',
      defaultMode: 'preview',
    })
  })

  it('非法值字段丢弃（坏参数不击穿渲染链）', () => {
    expect(normalizeOptions({ initialMode: 'SOURCE' })).toEqual({}) // 大写非法
    expect(normalizeOptions({ defaultMode: 'nope' })).toEqual({})
    expect(
      normalizeOptions({ initialMode: 123, defaultMode: ['split'] }),
    ).toEqual({})
  })

  it('多余字段（如 foo）不透出——只取白名单字段', () => {
    const out = normalizeOptions({ initialMode: 'split', foo: 'bar' } as Record<string, unknown>)
    expect(out).toEqual({ initialMode: 'split' })
    expect(out).not.toHaveProperty('foo')
  })
})

// ───────────────────────── resolveInitialMode 优先级矩阵 ─────────────────────────

describe('resolveInitialMode 优先级：initialMode > stored > defaultMode > DEFAULT_MODE', () => {
  it('有 initialMode：压过 stored 与 defaultMode', () => {
    expect(
      resolveInitialMode(
        { initialMode: 'source', defaultMode: 'preview' },
        'split' as MdMode | null,
      ),
    ).toBe('source')
    expect(resolveInitialMode({ initialMode: 'preview' }, 'source')).toBe('preview')
  })

  it('无 initialMode：用 stored（并压过 defaultMode）', () => {
    expect(resolveInitialMode({ defaultMode: 'split' }, 'preview')).toBe('preview')
    expect(resolveInitialMode({}, 'source')).toBe('source')
  })

  it('无 initialMode 且无 stored：用 defaultMode', () => {
    expect(resolveInitialMode({ defaultMode: 'preview' }, null)).toBe('preview')
  })

  it('全空（无 initialMode、stored=null、无 defaultMode）→ split（DEFAULT_MODE）', () => {
    expect(resolveInitialMode({}, null)).toBe('split')
    expect(resolveInitialMode({ defaultMode: undefined }, null)).toBe('split')
  })
})

// ───────────────────────── readStoredMode / writeStoredMode（注入内存 stub）─────────────────────────

/** 内存版 storage stub：Map 承载，getItem/setItem 均为普通方法（满足 Pick<Storage, …>） */
function makeMemoryStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    map,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      map.set(k, v)
    },
  }
}

describe('readStoredMode / writeStoredMode', () => {
  it('读写往返：写入的形态可用同一 stub 原样读回，且落在 MODE_STORAGE_KEY 上', () => {
    const mem = makeMemoryStorage()
    writeStoredMode('preview', mem)
    expect(mem.map.get(MODE_STORAGE_KEY)).toBe('preview')
    expect(readStoredMode(mem)).toBe('preview')

    writeStoredMode('source', mem)
    expect(readStoredMode(mem)).toBe('source')
  })

  it('存了非法值（大写/乱串/空串）→ read 返回 null（非法即视为无记忆）', () => {
    expect(readStoredMode(makeMemoryStorage({ [MODE_STORAGE_KEY]: 'SOURCE' }))).toBe(null)
    expect(readStoredMode(makeMemoryStorage({ [MODE_STORAGE_KEY]: 'nope' }))).toBe(null)
    expect(readStoredMode(makeMemoryStorage({ [MODE_STORAGE_KEY]: '' }))).toBe(null)
    // getItem 返回 undefined（键不存在）→ 亦归一为 null
    expect(readStoredMode(makeMemoryStorage())).toBe(null)
  })

  it('getItem 抛异常 → 返回 null，不上抛（隐私模式/禁用存储口径）', () => {
    const mem = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(() => readStoredMode(mem)).not.toThrow()
    expect(readStoredMode(mem)).toBe(null)
  })

  it('setItem 抛异常 → 静默吞掉，不上抛（持久化失败不阻断形态切换）', () => {
    const mem = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => writeStoredMode('split', mem)).not.toThrow()
  })
})
