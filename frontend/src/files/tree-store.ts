/**
 * 文件树 store（Wave1-A5 管理面）。契约：S3Client 见 src/sdk/types.ts（A3 实现）。
 * 分层：createFileTree(options) 可独立测试的控制器（不依赖 pinia）；
 *       useFileTreeStore() pinia setup store 薄壳，init(options) 注入依赖后透出控制器。
 * 要点：nodes 懒加载缓存；list 聚合翻页到尽；目录标记对象过滤；目录 rename/remove 平铺
 *       逐对象处理、失败抛 SdkError 携带已完成进度（可续跑）；成功后触发 onFileChanged；
 *       Lane F3 增 applyChange——外部 fileChanged（renderer 保存等）同步缓存的最小维护口。
 */
import { computed, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import type { S3Client, S3ObjectSummary } from '@/sdk/types'

/** DeleteObjects 单批上限（S3/OSS/MinIO 通用），remove/renameDir 按此分批 */
const DELETE_BATCH = 1000

/** 目录桶缓存：一个 prefix 下的直接子目录与文件 */
export interface DirBucket {
  dirs: S3ObjectSummary[]
  files: S3ObjectSummary[]
  loaded: boolean
}

/** fileChanged 事件载荷（映射契约 FileChangedPayload） */
export interface FileChangedEvent {
  key: string
  action: 'put' | 'delete' | 'rename'
  from?: string
}

export interface FileTreeOptions {
  client: S3Client
  rootPrefix?: string // 树根目录域（如 'sessions/abc/'），默认 ''（bucket 根）
  /** 初始目录（ui.initialPath，复审 #7）：相对 rootPrefix 的规范化 prefix；缺省=rootPrefix */
  initialPath?: string
  onFileChanged?: (payload: FileChangedEvent) => void // 动作成功后的变更回调（宿主同步视图用）
}

export interface FileTreeController {
  currentPath: string // 当前所在目录（规范化后的 prefix）
  loading: boolean // 任一 S3 动作在途时为 true（计数器归并，避免并发闪烁）
  error: SdkError | null // 最近一次失败的错误（动作成功后清空）
  readonly nodes: Map<string, DirBucket> // 懒加载缓存（UI 直接 nodes.get(normalizePrefix(p)) 读）
  /** 加载目录并写缓存；已 loaded 默认走缓存，opts.force 强制刷新 */
  loadDir(prefix: string, opts?: { force?: boolean }): Promise<void>
  /** 建目录：put 目录标记 → 刷新父目录 → fileChanged(put)；返回新目录 key */
  mkdir(prefix: string, name: string): Promise<string>
  /** 重命名（文件或目录；目录逐对象 copy 支持续跑）→ 刷新缓存 → fileChanged(rename) */
  rename(from: string, to: string): Promise<void>
  /** 删除（文件 key 或目录 prefix，目录平铺展开）→ 清缓存 → 逐 key fileChanged(delete) */
  remove(keys: string[]): Promise<void>
  /** 应用外部 fileChanged（Lane F3：renderer 保存/宿主侧变更 → 树缓存最小维护，不发网络请求） */
  applyChange(payload: FileChangedEvent): void
}

/** 前缀规范化：非空前补尾 '/'（'' 即 bucket 根） */
export function normalizePrefix(p: string): string {
  if (p === '') return ''
  return p.endsWith('/') ? p : `${p}/`
}

/** key 所属父目录前缀：'a/b.txt'→'a/'，'a/b/'→'a/'，'root.txt'→'' */
function parentPrefix(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key
  const i = trimmed.lastIndexOf('/')
  return i < 0 ? '' : trimmed.slice(0, i + 1)
}

/** SdkError 原样透传；其余包装为 S3_ERROR（契约：S3 面错误统一走 SdkError，不吞） */
function asSdkError(e: unknown): SdkError {
  if (e instanceof SdkError) return e
  const msg = e instanceof Error ? e.message : String(e)
  return new SdkError(ERROR_CODES.S3_ERROR, msg, e)
}

/** 创建文件树控制器（独立可测；不依赖 pinia） */
export function createFileTree(options: FileTreeOptions): FileTreeController {
  const { client } = options
  const nodes = ref(new Map<string, DirBucket>())
  const currentPath = ref(normalizePrefix(options.initialPath ?? options.rootPrefix ?? ''))
  const error = ref<SdkError | null>(null)
  const activeCount = ref(0)
  const loading = computed(() => activeCount.value > 0)
  /** 同 prefix 在途加载去重 */
  const inflight = new Map<string, Promise<void>>()

  const emitChanged = (payload: FileChangedEvent): void => options.onFileChanged?.(payload)

  /** 动作统一包装：loading 计数 + 成功清错误 + 失败记错误态并透传 SdkError */
  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    activeCount.value++
    try {
      const r = await fn()
      error.value = null
      return r
    } catch (e) {
      const err = e instanceof SdkError ? e : asSdkError(e)
      error.value = err
      throw err
    } finally {
      activeCount.value--
    }
  }

  /** 聚合翻页拉取一个目录并写缓存；force 绕过缓存，在途请求复用 */
  async function fetchDir(prefix: string, force: boolean): Promise<void> {
    const cached = nodes.value.get(prefix)
    if (cached?.loaded && !force) return
    const pending = inflight.get(prefix)
    if (pending) return pending
    const task = guarded(async () => {
      const dirs: S3ObjectSummary[] = []
      const files: S3ObjectSummary[] = []
      let token: string | undefined
      do {
        const page = await client.list(prefix, token ? { continuationToken: token } : undefined)
        dirs.push(...page.dirs)
        for (const f of page.files) {
          if (f.key !== prefix) files.push(f) // 目录标记对象不是文件
        }
        token = page.continuationToken
      } while (token)
      nodes.value.set(prefix, { dirs, files, loaded: true }) // 成功才写缓存；失败保留旧值（若有）
    })
    inflight.set(prefix, task)
    try { await task } finally { inflight.delete(prefix) }
  }

  async function loadDir(prefix: string, opts?: { force?: boolean }): Promise<void> {
    const p = normalizePrefix(prefix)
    await fetchDir(p, opts?.force === true)
    currentPath.value = p // 失败抛出时不改 currentPath
  }

  /** 刷新一组 key/prefix 所属的父目录（去重后强制重拉） */
  async function refreshParents(keys: string[]): Promise<void> {
    for (const p of new Set(keys.map(parentPrefix))) await fetchDir(p, true)
  }

  async function mkdir(prefix: string, name: string): Promise<string> {
    if (name === '' || name.includes('/') || name === '.' || name === '..') {
      throw new SdkError(ERROR_CODES.BAD_PARAM, `非法目录名：'${name}'`)
    }
    const parent = normalizePrefix(prefix)
    const key = `${parent}${name}/`
    await guarded(async () => {
      await client.put(key, new Blob([])) // 目录标记：0 字节对象
      await fetchDir(parent, true)
    })
    emitChanged({ key, action: 'put' })
    return key
  }

  async function rename(from: string, to: string): Promise<void> {
    if (from === '' || to === '') throw new SdkError(ERROR_CODES.BAD_PARAM, 'rename 源/目标不能为空')
    if (from === to) throw new SdkError(ERROR_CODES.BAD_PARAM, 'rename 源/目标相同')
    if (from.endsWith('/')) {
      if (!to.endsWith('/')) throw new SdkError(ERROR_CODES.BAD_PARAM, '目录 rename 目标必须以 / 结尾')
      if (to.startsWith(from)) throw new SdkError(ERROR_CODES.BAD_PARAM, '不能把目录移动到自身内部')
      await guarded(() => renameDir(from, to))
    } else {
      await guarded(async () => {
        await client.copy(from, to)
        await client.remove([from])
        await refreshParents([from, to])
      })
    }
    emitChanged({ key: to, action: 'rename', from })
  }

  /** 目录 rename：平铺列举 → 逐对象 copy（记进度，失败可续跑）→ 批量 remove → 缓存失效 */
  async function renameDir(from: string, to: string): Promise<void> {
    const all = await flatList(from)
    const done: string[] = []
    try {
      for (const obj of all) {
        await client.copy(obj.key, to + obj.key.slice(from.length))
        done.push(obj.key)
      }
      for (let i = 0; i < done.length; i += DELETE_BATCH) {
        await client.remove(done.slice(i, i + DELETE_BATCH))
      }
    } catch (e) {
      const err = e instanceof SdkError ? e : asSdkError(e)
      // 续跑信息：已完成对象清单 + 总数；S3 copy 覆盖幂等，重试可从断点继续
      throw new SdkError(err.code, `目录重命名中断：已完成 ${done.length}/${all.length}`, {
        from, to, done, total: all.length, cause: err.detail,
      })
    }
    for (const k of [...nodes.value.keys()]) {
      if (k.startsWith(from) || k.startsWith(to)) nodes.value.delete(k) // 子树缓存失效
    }
    await refreshParents([from, to])
  }

  async function remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await guarded(async () => {
      const victims = new Set<string>()
      const dirPrefixes: string[] = []
      for (const key of keys) {
        if (key === '') throw new SdkError(ERROR_CODES.BAD_PARAM, 'remove 的 key 不能为空')
        if (key.endsWith('/')) {
          dirPrefixes.push(key)
          for (const obj of await flatList(key)) victims.add(obj.key) // 平铺展开（含标记）
        } else {
          victims.add(key)
        }
      }
      const all = [...victims]
      for (let i = 0; i < all.length; i += DELETE_BATCH) {
        await client.remove(all.slice(i, i + DELETE_BATCH))
      }
      for (const k of [...nodes.value.keys()]) {
        if (dirPrefixes.some(d => k.startsWith(d))) nodes.value.delete(k)
      }
      await refreshParents(keys)
    })
    for (const key of keys) emitChanged({ key, action: 'delete' }) // 逐调用 key 上报，子对象不重复刷屏
  }

  /** 平铺列举目录下全部对象（delimiter:''，含目录标记），目录 rename/remove 用 */
  async function flatList(dirPrefix: string): Promise<S3ObjectSummary[]> {
    const out: S3ObjectSummary[] = []
    let token: string | undefined
    do {
      const page = await client.list(
        dirPrefix,
        token ? { delimiter: '', continuationToken: token } : { delimiter: '' },
      )
      out.push(...page.files)
      for (const d of page.dirs) out.push(d) // 防御：平铺模式不应有 CommonPrefixes
      token = page.continuationToken
    } while (token)
    return out
  }

  // ── Lane F3：applyChange（外部 fileChanged → 缓存最小维护） ──

  /** key 末段名称：'a/b.txt'→'b.txt'，'a/c/'→'c' */
  function nameOf(key: string): string {
    const trimmed = key.endsWith('/') ? key.slice(0, -1) : key
    return trimmed.slice(trimmed.lastIndexOf('/') + 1)
  }

  /** 失效某目录前缀下的全部子树缓存（与 renameDir/remove 的失效口径一致） */
  function invalidateUnder(prefix: string): void {
    for (const k of [...nodes.value.keys()]) {
      if (k.startsWith(prefix)) nodes.value.delete(k)
    }
  }

  /** 从已缓存的父目录 bucket 移除条目；父目录未缓存为空操作 */
  function removeFromBucket(key: string): void {
    const bucket = nodes.value.get(parentPrefix(key))
    if (!bucket) return
    const arr = key.endsWith('/') ? bucket.dirs : bucket.files
    const i = arr.findIndex((e) => e.key === key)
    if (i >= 0) arr.splice(i, 1)
  }

  /**
   * 往已缓存的父目录 bucket 插入最小条目（size 未知置 0）；父目录未缓存为空操作。
   * 该 key 已存在时保留原条目：payload 不携 size/lastModified，list 结果才是权威，
   * 覆盖反而引入假数据（size=0 的旧条目也比伪造新值诚实）。
   */
  function upsertToBucket(key: string): void {
    const bucket = nodes.value.get(parentPrefix(key))
    if (!bucket) return
    if (bucket.dirs.some((d) => d.key === key) || bucket.files.some((f) => f.key === key)) return
    const isDir = key.endsWith('/')
    ;(isDir ? bucket.dirs : bucket.files).push({ key, name: nameOf(key), size: 0, isDir })
  }

  /**
   * 应用外部 fileChanged（P0 接线：renderer 保存/宿主侧变更 → 树缓存同步）。
   * 最小化口径（同步、零网络请求；需要权威数据请 loadDir(force)）：
   * - put：目标父目录已缓存 → 无则插入最小条目、有则保留（见 upsertToBucket）；
   * - delete：来源条目移除；来源为目录时子树缓存失效；
   * - rename：来源条目移除（目录含子树失效）→ 目标父目录已缓存则插入目标条目，
   *   目录 rename 额外失效目标子树（防陈旧拷贝）；
   * - 父目录未缓存 → 跳过（懒加载目录打开时自然拉到最新），绝不创建半截 bucket。
   */
  function applyChange(payload: FileChangedEvent): void {
    const { key, action } = payload
    if (action === 'put') {
      upsertToBucket(key)
      return
    }
    if (action === 'delete') {
      removeFromBucket(key)
      if (key.endsWith('/')) invalidateUnder(key)
      return
    }
    // rename（缺 from / from===to 整体忽略）
    const from = payload.from
    if (!from || from === key) return
    removeFromBucket(from)
    if (from.endsWith('/')) invalidateUnder(from)
    upsertToBucket(key)
    if (key.endsWith('/')) invalidateUnder(key)
  }

  // reactive 包装：外部以 ctrl.currentPath / ctrl.nodes 直接读写（ref 自动解包）
  return reactive({
    currentPath, loading, error, nodes,
    loadDir, mkdir, rename, remove, applyChange,
  }) as FileTreeController
}

/**
 * pinia setup store 薄壳：依赖（client/回调）由装配层经 init() 注入
 * （凭证异步就绪后才有 client，不能在 defineStore 闭包里静态注入）
 */
export const useFileTreeStore = defineStore('filesTree', () => {
  const controller = shallowRef<FileTreeController | null>(null)

  /** 注入依赖并创建控制器；可重复调用重建（换 client / 重置会话） */
  function init(options: FileTreeOptions): FileTreeController {
    const ctrl = createFileTree(options)
    controller.value = ctrl
    return ctrl
  }

  return { controller, init }
})
