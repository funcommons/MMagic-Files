/**
 * profiles 单测（Lane G5）——本地连接模式的多 Profile 存储 + 连接配置构造。
 * - 存储一律注入内存 stub（不触真实 localStorage；null=显式无存储走静默降级分支）
 * - 金样例断言：buildWorkspaceConfig 产物拼成 '#config=' 片段后可被既有 parseAppConfig
 *   消费——这是「连接 → persist 备份 → reload → restore 链重建」成立的前提
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TTL_MINUTES,
  LOCAL_ROOT_PREFIX,
  LOCAL_SESSION_TOKEN,
  PROFILES_MAX,
  PROFILES_STORAGE_KEY,
  buildWorkspaceConfig,
  createProfile,
  listProfiles,
  removeProfile,
  resolveTtlSeconds,
  saveProfile,
  updateProfile,
  validateProfile,
} from '../profiles'
import { TTL_HARD_CAP_SEC } from '@/sdk/constants'
import { parseAppConfig } from '@/sdk/config'
import type { S3Profile } from '../profiles'
import type { WorkspaceConfig } from '@/sdk/types'

/** 内存 Storage stub（Storage 全形状；getter length 保持动态） */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

/** 合法 profile 样板（各用例按需覆写） */
const base = (over: Partial<S3Profile> = {}): S3Profile => ({
  id: 'p1',
  name: 'MinIO 本地',
  endpoint: 'https://minio.example.com',
  region: 'us-east-1',
  bucket: 'files',
  accessKeyId: 'AKIA1234',
  secretAccessKey: 'shhh',
  createdAt: 1700000000000,
  ...over,
})

describe('profiles 存储（list/save/update/remove）', () => {
  it('listProfiles：缺键/空库 → 空数组；落盘后往返一致（含可选 prefix/pathStyle）', () => {
    const empty = memoryStorage()
    expect(listProfiles({ storage: empty })).toEqual([])

    const profile = base({ prefix: 'docs/', pathStyle: true })
    const store = memoryStorage()
    saveProfile(profile, { storage: store })
    expect(listProfiles({ storage: store })).toEqual([profile])
    // 明文存储契约：JSON 原文直接可读（风险注释见 profiles.ts 头部）
    const raw = JSON.parse(store.getItem(PROFILES_STORAGE_KEY)!) as S3Profile[]
    expect(raw[0]?.accessKeyId).toBe('AKIA1234')
  })

  it('saveProfile：非法 profile（缺必填）→ 抛错且不落盘', () => {
    const store = memoryStorage()
    const bad = base({ name: '' }) as unknown as Record<string, unknown>
    delete bad.name
    expect(() => saveProfile(bad as unknown as S3Profile, { storage: store })).toThrow(/name/)
    expect(store.getItem(PROFILES_STORAGE_KEY)).toBeNull()
  })

  it('saveProfile：endpoint 非 URL / 非 http(s) → 抛错', () => {
    const store = memoryStorage()
    expect(() => saveProfile(base({ endpoint: 'not a url' }), { storage: store })).toThrow(/endpoint/)
    expect(() => saveProfile(base({ endpoint: 'ftp://x.example.com' }), { storage: store })).toThrow(/endpoint/)
    expect(() => saveProfile(base({ endpoint: 'http://x.example.com' }), { storage: store })).not.toThrow()
  })

  it('saveProfile 容量上限：满 PROFILES_MAX 份新增拒（抛错）；更新既有 id 放行', () => {
    const full = Array.from({ length: PROFILES_MAX }, (_, i) => base({ id: `p${i}`, name: `n${i}` }))
    const store = memoryStorage({ [PROFILES_STORAGE_KEY]: JSON.stringify(full) })
    expect(() => saveProfile(base({ id: 'new-one' }), { storage: store })).toThrow(/上限/)
    expect(listProfiles({ storage: store })).toHaveLength(PROFILES_MAX)
    expect(() => saveProfile(base({ id: 'p3', name: 'renamed' }), { storage: store })).not.toThrow()
    expect(listProfiles({ storage: store }).find((p) => p.id === 'p3')?.name).toBe('renamed')
  })

  it('updateProfile：合并 patch 且保留 id/createdAt；id 不存在 → null；非法 patch 抛错不落盘', () => {
    const store = memoryStorage()
    saveProfile(base(), { storage: store })

    const next = updateProfile('p1', { name: '改名', bucket: 'b2' }, { storage: store })
    expect(next).not.toBeNull()
    const kept = next![0]!
    expect(kept).toMatchObject({ id: 'p1', createdAt: 1700000000000, name: '改名', bucket: 'b2', endpoint: 'https://minio.example.com' })
    expect(listProfiles({ storage: store })[0]?.name).toBe('改名')

    expect(updateProfile('missing', { name: 'x' }, { storage: store })).toBeNull()

    expect(() => updateProfile('p1', { endpoint: 'nope' }, { storage: store })).toThrow(/endpoint/)
    expect(listProfiles({ storage: store })[0]?.endpoint).toBe('https://minio.example.com')
  })

  it('removeProfile：按 id 移除并落盘；id 不存在 → 列表原样返回', () => {
    const store = memoryStorage()
    saveProfile(base(), { storage: store })
    saveProfile(base({ id: 'p2', name: '第二份' }), { storage: store })

    const after = removeProfile('p1', { storage: store })
    expect(after.map((p) => p.id)).toEqual(['p2'])
    expect(listProfiles({ storage: store }).map((p) => p.id)).toEqual(['p2'])
    expect(removeProfile('ghost', { storage: store })).toHaveLength(1)
  })

  it('storage=null（显式无存储）：全部静默降级——list 空、save 返回内存列表不落盘', () => {
    expect(listProfiles({ storage: null })).toEqual([])
    expect(saveProfile(base(), { storage: null })).toHaveLength(1)
    expect(updateProfile('p1', { name: 'x' }, { storage: null })).toBeNull()
    expect(removeProfile('p1', { storage: null })).toEqual([])
  })

  it('损坏 JSON：清键重建为空库；数组内非法条目被过滤', () => {
    const corrupt = memoryStorage({ [PROFILES_STORAGE_KEY]: '{oops' })
    expect(listProfiles({ storage: corrupt })).toEqual([])
    expect(corrupt.getItem(PROFILES_STORAGE_KEY)).toBeNull() // 已清除

    const mixed = memoryStorage({
      [PROFILES_STORAGE_KEY]: JSON.stringify([base(), { name: '残缺' }]),
    })
    const kept = listProfiles({ storage: mixed })
    expect(kept).toHaveLength(1)
    expect(kept[0]?.id).toBe('p1')
  })
})

describe('validateProfile / createProfile', () => {
  it('validateProfile：逐必填缺失报项；prefix/pathStyle/id/createdAt 类型错报项；多余未知键不报（向前兼容）', () => {
    expect(validateProfile({})).toEqual([
      '缺 name', '缺 endpoint', '缺 region', '缺 bucket', '缺 accessKeyId', '缺 secretAccessKey',
    ])
    expect(validateProfile(base({ prefix: 3 } as unknown as Partial<S3Profile>))).toEqual(['prefix 须为字符串'])
    expect(validateProfile(base({ pathStyle: 'yes' } as unknown as Partial<S3Profile>))).toEqual(['pathStyle 须为布尔'])
    expect(validateProfile(base({ extra: '未知键放行' } as unknown as Partial<S3Profile>))).toEqual([])
  })

  it('createProfile：填 id/createdAt、字段去空白、空 prefix 省略、pathStyle 仅 true 落字段', () => {
    const p = createProfile({
      name: '  本地  ',
      endpoint: ' https://minio.example.com ',
      region: ' us-east-1 ',
      bucket: ' files ',
      accessKeyId: ' AKIA ',
      secretAccessKey: 'shhh',
      prefix: '  ',
      pathStyle: false,
    })
    expect(p.id).toBeTruthy()
    expect(p.createdAt).toBeGreaterThan(0)
    expect(p.name).toBe('本地')
    expect(p.endpoint).toBe('https://minio.example.com')
    expect(p.prefix).toBeUndefined()
    expect(p.pathStyle).toBeUndefined()

    const withPrefix = createProfile({
      name: 'x', endpoint: 'https://a.com', region: 'r', bucket: 'b',
      accessKeyId: 'ak', secretAccessKey: 'sk', prefix: 'docs/', pathStyle: true,
    })
    expect(withPrefix.prefix).toBe('docs/')
    expect(withPrefix.pathStyle).toBe(true)
  })
})

describe('连接配置构造（buildWorkspaceConfig / resolveTtlSeconds）', () => {
  it('形状：v:1/mode:workspace/backend 映射 + credentials 换名（secretAccessKey→accessKeySecret）+ 允许域=本页 origin', () => {
    const cfg = buildWorkspaceConfig(
      base({ prefix: 'docs/', pathStyle: true }),
      { origin: 'https://app.example.com', ttlMinutes: 30 },
    )
    expect(cfg.v).toBe(1)
    expect(cfg.mode).toBe('workspace')
    expect(cfg.backend.endpoint).toBe('https://minio.example.com')
    expect(cfg.backend.region).toBe('us-east-1')
    expect(cfg.backend.bucket).toBe('files')
    expect(cfg.backend.prefix).toBe('docs/')
    expect(cfg.backend.ttlSeconds).toBe(1800)
    expect(cfg.backend.credentials).toEqual({
      accessKeyId: 'AKIA1234',
      accessKeySecret: 'shhh',
      sessionToken: LOCAL_SESSION_TOKEN,
    })
    expect(cfg.security.allowedOrigins).toEqual(['https://app.example.com'])
    expect((cfg.backend as unknown as Record<string, unknown>).pathStyle).toBe(true)
  })

  it('prefix 空缺 → 垫片 LOCAL_ROOT_PREFIX；pathStyle 未开 → 不携带该键', () => {
    const cfg = buildWorkspaceConfig(base(), { origin: 'https://app.example.com' })
    expect(cfg.backend.prefix).toBe(LOCAL_ROOT_PREFIX)
    expect((cfg.backend as unknown as Record<string, unknown>).pathStyle).toBeUndefined()
  })

  it('ttl 分钟换算：默认档=DEFAULT_TTL_MINUTES（截到硬帽）；正常档分钟×60；0/负数钳到 1 分钟', () => {
    expect(resolveTtlSeconds(undefined)).toBe(TTL_HARD_CAP_SEC) // 3600 分钟 → 截断 86400
    expect(resolveTtlSeconds(DEFAULT_TTL_MINUTES)).toBe(TTL_HARD_CAP_SEC)
    expect(resolveTtlSeconds(30)).toBe(1800)
    expect(resolveTtlSeconds(0)).toBe(60)
    expect(resolveTtlSeconds(-5)).toBe(60)
    expect(resolveTtlSeconds(100_000)).toBe(TTL_HARD_CAP_SEC)
    expect(buildWorkspaceConfig(base({ prefix: 'd/' }), { origin: 'https://a.com' }).backend.ttlSeconds).toBe(TTL_HARD_CAP_SEC)
  })

  it('金样例：产物拼 #config= 片段可被既有 parseAppConfig 消费（reload 恢复链前提）', () => {
    const cfg = buildWorkspaceConfig(base({ prefix: 'docs/' }), { origin: 'https://app.example.com', ttlMinutes: 60 })
    const raw = '#config=' + encodeURIComponent(JSON.stringify(cfg))
    const parsed = parseAppConfig(raw)
    expect(parsed.mode).toBe('workspace')
    const ws = parsed as WorkspaceConfig
    expect(ws.backend.ttlSeconds).toBe(3600)
    expect(ws.backend.credentials.accessKeyId).toBe('AKIA1234')
  })
})
