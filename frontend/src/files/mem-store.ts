/**
 * 内存文件 store——「上传文件·内存中处理」通路（用户口径：不落 S3，凭证零改动）。
 * - 键空间 `mem://<seq>`：独立于 S3 key 域，AppDataSource 以 isMemKey 分流（getObject/putObject
 *   直读写本 store）——所有 Blob-first 渲染器/插件零改动可用；
 * - 生命周期：条目随预览 tab 关闭由 memDelete 释放（Home.vue 关 tab 钩子），会话过期随页面销毁；
 * - opener hook：uploadFiles(memory) 入 store 后经 notifyMemFileAdded 回调宿主 UI 打开预览
 *   （Home.vue 注册 preview.open）——模块级单例，避免 commands→Home 的依赖倒挂。
 */
export const MEM_PREFIX = 'mem://'

export interface MemEntry {
  key: string
  name: string
  mime: string
  size: number
  blob: Blob
}

const store = new Map<string, MemEntry>()
let seq = 0

export function isMemKey(key: string): boolean {
  return key.startsWith(MEM_PREFIX)
}

/** File/Blob → 内存条目；mime 缺省按 File.type 兜底 octet-stream */
export function memPut(file: File | Blob, name?: string): MemEntry {
  seq += 1
  const entry: MemEntry = {
    key: `${MEM_PREFIX}${seq}`,
    name: name ?? (file instanceof File ? file.name : `mem-${seq}`),
    mime: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
  }
  store.set(entry.key, entry)
  return entry
}

export function memGet(key: string): MemEntry | undefined {
  return store.get(key)
}

/** 内存条目就地更新（编辑保存链：persist → DataSource.putObject(memKey) 分流至此） */
export function memUpdate(key: string, blob: Blob, mime?: string): MemEntry {
  const prev = store.get(key)
  if (!prev) throw new Error(`mem key not found: ${key}`)
  const next: MemEntry = { ...prev, blob, size: blob.size, mime: mime ?? prev.mime }
  store.set(key, next)
  return next
}

export function memDelete(key: string): void {
  store.delete(key)
}

/** 全量清空（会话级测试隔离用） */
export function memClear(): void {
  store.clear()
  seq = 0
}

/** 打开提示（uploadFiles payload 透传）：appId=指定应用、appOptions=打开参数（渲染器第 5 参） */
export interface MemOpenHint {
  appId?: string
  appOptions?: Record<string, unknown>
}

type MemOpener = (entry: MemEntry, hint?: MemOpenHint) => void
let opener: MemOpener | null = null

/**
 * opener 未就绪期间的通知暂存。时序坑：ready 在 boot 同步段末尾 emit（早于 app.mount），
 * 宿主收到 ready 即可发 uploadFiles——通知到达时 Home.vue 尚未挂载、opener 还是 null，
 * 直接静默会变成「上传 ✓ 但预览静默不打开」。暂存后注册时按序 flush。
 */
const pendingNotifies: Array<{ entry: MemEntry; hint?: MemOpenHint }> = []

/** 宿主 UI（Home.vue）注册「内存文件→打开预览」回调；重复注册覆盖旧者，并把挂载前积压的通知按序 flush */
export function setMemFileOpener(cb: MemOpener | null): void {
  opener = cb
  if (cb) {
    while (pendingNotifies.length) {
      const p = pendingNotifies.shift()!
      try {
        cb(p.entry, p.hint)
      } catch {
        // 单条 flush 失败不阻断其余积压（文件仍在 store，可稍后手动打开）
      }
    }
  }
}

/** uploadFiles(memory) 落库后回调（opener 未注册=暂存，注册时补打开；文件已在 store 不丢） */
export function notifyMemFileAdded(entry: MemEntry, hint?: MemOpenHint): void {
  if (!opener) {
    pendingNotifies.push({ entry, hint })
    return
  }
  try {
    opener(entry, hint)
  } catch {
    // opener 异常不阻断上传链（文件已在 store，UI 可稍后手动打开）
  }
}
