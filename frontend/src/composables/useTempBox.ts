/**
 * useTempBox — 图片暂存盒的本地存储 composable.
 *
 * 后端: IndexedDB (DB=`temp-box`, store=`images`, keyPath=`id`)
 * 主键: SHA-256(file 内容) hex 字符串 — 同图去重
 * 容量: 软限 100MB, 超出按 createdAt 升序淘汰最老的
 *
 * API:
 *   addImage(file)    计算 SHA-256 + 读尺寸 + 写 IDB + 触发 evict; 同图去重 (LRU touch)
 *   listImages()      按 createdAt desc 返回 meta 列表 (不含 blob)
 *   getImage(id)      取完整记录 (含 blob) 用于预览/缩略图
 *   deleteImage(id)   删除一条
 *   getStats()        返回 { count, totalSize } 给容量条用
 */

const DB_NAME = 'temp-box'
const DB_VERSION = 1
const STORE_NAME = 'images'
const INDEX_CREATED = 'byCreatedAt'
const MAX_TOTAL = 512 * 1024 * 1024 // 512 MB

export interface TempImageMeta {
  /** SHA-256(file) hex — 主键 */
  id: string
  size: number
  type: string
  name: string
  width: number
  height: number
  /** ms timestamp; addImage 时刷新, 用于 LRU 排序 */
  createdAt: number
}

export interface TempImage extends TempImageMeta {
  blob: Blob
}

// 模块级 DB 连接缓存 (同页面多组件共用一个连接)
let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable (private mode?)'))
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex(INDEX_CREATED, 'createdAt', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'))
    })
  }
  return dbPromise
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'))
  })
}

/** SHA-256(file) → hex string. crypto.subtle 仅在 https/localhost 可用. */
async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 读图片宽高, 失败回退 0×0. */
async function readSize(file: File): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file)
    const w = bitmap.width
    const h = bitmap.height
    bitmap.close?.()
    return { width: w, height: h }
  } catch {
    return { width: 0, height: 0 }
  }
}

/** 总占用字节数 (遍历 store 累加 size). */
async function computeTotalSize(db: IDBDatabase): Promise<number> {
  const store = tx(db, 'readonly')
  const all = await reqToPromise(store.getAll() as IDBRequest<TempImageMeta[]>)
  return (all ?? []).reduce((sum, m) => sum + (m.size ?? 0), 0)
}

/** 超过 MAX_TOTAL 时按 createdAt 升序删最老的, 直到 ≤ MAX_TOTAL. */
async function evictIfNeeded(db: IDBDatabase): Promise<void> {
  let total = await computeTotalSize(db)
  if (total <= MAX_TOTAL) return
  const store = tx(db, 'readonly')
  const idx = store.index(INDEX_CREATED)
  const sorted = await reqToPromise(idx.getAll() as IDBRequest<TempImageMeta[]>)
  // index 已按 createdAt 升序返回; 从头删
  const rwStore = tx(db, 'readwrite')
  for (const meta of sorted) {
    if (total <= MAX_TOTAL) break
    await reqToPromise(rwStore.delete(meta.id))
    total -= meta.size ?? 0
  }
}

export function useTempBox() {
  async function addImage(file: File): Promise<TempImageMeta> {
    const db = await getDB()
    const id = await sha256(file)
    const { width, height } = await readSize(file)
    const now = Date.now()

    // 同图去重: 已存在则只 touch createdAt, 不重写 blob
    const roStore = tx(db, 'readonly')
    const existing = await reqToPromise(roStore.get(id) as IDBRequest<TempImageMeta | undefined>)
    if (existing) {
      const rwStore = tx(db, 'readwrite')
      await reqToPromise(rwStore.put({ ...existing, createdAt: now }))
      return { ...existing, createdAt: now }
    }

    const meta: TempImageMeta = {
      id,
      size: file.size,
      type: file.type,
      name: file.name,
      width,
      height,
      createdAt: now,
    }
    const rwStore = tx(db, 'readwrite')
    await reqToPromise(rwStore.put({ ...meta, blob: file } as TempImage))
    await evictIfNeeded(db)
    return meta
  }

  async function listImages(): Promise<TempImageMeta[]> {
    const db = await getDB()
    const store = tx(db, 'readonly')
    const all = await reqToPromise(store.getAll() as IDBRequest<TempImageMeta[]>)
    return (all ?? [...[] as TempImageMeta[]]).slice().sort((a, b) => b.createdAt - a.createdAt)
  }

  async function getImage(id: string): Promise<TempImage | null> {
    const db = await getDB()
    const store = tx(db, 'readonly')
    const rec = await reqToPromise(store.get(id) as IDBRequest<TempImage | undefined>)
    return rec ?? null
  }

  async function deleteImage(id: string): Promise<void> {
    const db = await getDB()
    const rwStore = tx(db, 'readwrite')
    await reqToPromise(rwStore.delete(id))
  }

  async function getStats(): Promise<{ count: number; totalSize: number }> {
    const db = await getDB()
    const store = tx(db, 'readonly')
    const all = await reqToPromise(store.getAll() as IDBRequest<TempImageMeta[]>)
    const list = all ?? []
    return {
      count: list.length,
      totalSize: list.reduce((sum, m) => sum + (m.size ?? 0), 0),
    }
  }

  return { addImage, listImages, getImage, deleteImage, getStats }
}

/** 字节数格式化: 1234567 → "1.18 MB". 给 UI 用. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * 把任意来源 (File / Blob / URL / dataURL) 存入暂存盒.
 * - File: 直传
 * - Blob: 包成 File (用 name 或 fallback)
 * - string (http(s) URL / dataURL): fetch + blob → File
 *
 * 返回存入的 meta. 调用方根据返回判断是否新存 (对比 before/after stats).
 */
export async function saveToTempBox(source: File | Blob | string, name?: string): Promise<TempImageMeta> {
  let file: File
  if (typeof source === 'string') {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
    const blob = await res.blob()
    const ext = blob.type.split('/')[1] || 'bin'
    file = new File([blob], name || `image.${ext}`, { type: blob.type || 'image/png' })
  } else if (source instanceof File) {
    file = source
  } else {
    // Blob
    const ext = source.type.split('/')[1] || 'bin'
    file = new File([source], name || `image.${ext}`, { type: source.type || 'image/png' })
  }
  const box = useTempBox()
  return box.addImage(file)
}
