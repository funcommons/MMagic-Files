/**
 * 上传队列（Wave1-A5 管理面）。契约：S3Client/types.ts；onProgress/onDone/onFailed 由装配层
 * 映射 uploadProgress/uploadDone/uploadFailed 事件。
 * 要点：enqueue 同步校验分类（ext→size）不抛批错误；≤阈值直传，超出 multipart（分片并发≤2，
 *       complete 按 partNumber 升序）；abort 排队即弃、分片中立即 abortMultipart、统一取消码。
 */
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import type { S3Client } from '@/sdk/types'

const MB = 1024 * 1024
/** 单文件内分片并行度（2 路足够打满带宽又不挤占多文件并发） */
const PART_CONCURRENCY = 2

export interface UploadParams {
  uploadMaxBytes?: number // 单文件大小上限（字节），超出拒收
  uploadConcurrency?: number // 同时上传文件数，默认 3
  denyExts?: string[] // 扩展名黑名单（归一化：忽略大小写与前导点）
  partSize?: number // 分片大小（字节），默认 8MB
  multipartThreshold?: number // 分片阈值（字节），≤ 该值直传，默认 16MB
}

export interface UploadHooks {
  onProgress?(id: string, loaded: number, total: number): void // 分片累计、每片必调；节流归调用侧
  onDone?(id: string, key: string): void
  onFailed?(id: string, err: unknown): void
}

export interface UploadQueueOptions {
  client: S3Client
  params?: UploadParams
  hooks?: UploadHooks
}

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'aborted'

export interface EnqueueResult {
  accepted: { id: string }[]
  rejected: { name: string; reason: 'ext' | 'size' }[]
}

/**
 * 用户取消专码。契约 §七未定义"取消"错误码，预留 4901；
 * 装配层映射 uploadFailed 时按 code>=4900 识别为用户主动取消。
 */
export const UPLOAD_ABORTED_CODE = 4901

interface Task {
  id: string
  file: File
  key: string
  status: UploadStatus
  aborted: boolean
  uploadId?: string // multipart 进行中的 uploadId（undefined = 非分片或已收尾）
}

export class UploadQueue {
  private readonly client: S3Client
  private readonly hooks: UploadHooks
  private readonly concurrency: number
  private readonly maxBytes: number | undefined
  private readonly partSize: number
  private readonly threshold: number
  private readonly denyExts: ReadonlySet<string>
  private readonly tasks = new Map<string, Task>()
  private readonly pending: Task[] = []
  private active = 0

  constructor(options: UploadQueueOptions) {
    this.client = options.client
    this.hooks = options.hooks ?? {}
    const p = options.params ?? {}
    this.concurrency = Math.max(1, p.uploadConcurrency ?? 3)
    this.maxBytes = p.uploadMaxBytes
    this.partSize = Math.max(1, p.partSize ?? 8 * MB)
    this.threshold = Math.max(0, p.multipartThreshold ?? 16 * MB)
    this.denyExts = new Set((p.denyExts ?? []).map(normalizeExt).filter(ext => ext !== ''))
  }

  /** 校验分类并入池开跑：同步返回受理/拒绝结果（对齐 UploadFilesReply），不抛批错误 */
  enqueue(files: File[], prefix = ''): EnqueueResult {
    const accepted: { id: string }[] = []
    const rejected: { name: string; reason: 'ext' | 'size' }[] = []
    const base = normalizePrefix(prefix)
    for (const f of files) {
      const ext = extOf(f.name)
      if (ext !== '' && this.denyExts.has(ext)) {
        rejected.push({ name: f.name, reason: 'ext' })
        continue
      }
      if (this.maxBytes !== undefined && f.size > this.maxBytes) {
        rejected.push({ name: f.name, reason: 'size' })
        continue
      }
      const task: Task = { id: genId(), file: f, key: base + f.name, status: 'queued', aborted: false }
      this.tasks.set(task.id, task)
      this.pending.push(task)
      accepted.push({ id: task.id })
    }
    this.pump()
    return { accepted, rejected }
  }

  /**
   * 取消任务：排队中直接取消并回调 onFailed；上传中 multipart 立即 abortMultipart（直传
   * put 无 signal，完成后于 run 内丢弃）。已终态/未知 id 返回 false（幂等）。
   */
  abort(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || isTerminal(task.status)) return false
    task.aborted = true
    if (task.status === 'queued') {
      task.status = 'aborted' // 留在队列里由 pump 跳过，避免 splice
      this.hooks.onFailed?.(id, this.abortedError(id))
      return true
    }
    const uploadId = task.uploadId
    if (uploadId) {
      task.uploadId = undefined // 先清标记，run 的兜底清理不会再 abort 一次
      void this.client.abortMultipart(task.key, uploadId).catch(() => { /* 尽力清理 */ })
    }
    return true
  }

  status(id: string): UploadStatus | undefined {
    return this.tasks.get(id)?.status
  }
  /** 并发池：开满 concurrency，任务终态后回填 */
  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()
      if (!task || task.aborted) continue // 排队中被取消的任务直接丢弃
      this.active++
      task.status = 'uploading'
      void this.run(task).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async run(task: Task): Promise<void> {
    const { id, file, key } = task
    const contentType = file.type || 'application/octet-stream'
    try {
      if (task.aborted) throw this.abortedError(id)
      if (file.size <= this.threshold) {
        this.hooks.onProgress?.(id, 0, file.size) // 直传无进度回调，起止各报一次
        await this.client.put(key, file, contentType)
        if (task.aborted) throw this.abortedError(id) // put 不可中断，结束后丢弃
        this.hooks.onProgress?.(id, file.size, file.size)
      } else {
        await this.runMultipart(task, contentType)
      }
      task.status = 'done'
      this.hooks.onDone?.(id, key)
    } catch (e) {
      task.status = task.aborted ? 'aborted' : 'failed'
      // 取消语义优先：底层噪音（NoSuchUpload 等）不掩盖 UPLOAD_ABORTED
      const err = task.aborted ? this.abortedError(id) : asSdkError(e)
      const uploadId = task.uploadId
      if (uploadId) {
        task.uploadId = undefined
        try {
          await this.client.abortMultipart(key, uploadId) // 兜底清理服务端分片残留
        } catch { /* 清理失败不掩盖原错误 */ }
      }
      this.hooks.onFailed?.(id, err)
    }
  }

  /** multipart：create → 分片并发≤2 → complete（partNumber 升序提交） */
  private async runMultipart(task: Task, contentType: string): Promise<void> {
    const { id, file, key } = task
    const total = file.size
    const partCount = Math.max(1, Math.ceil(total / this.partSize))
    const { uploadId } = await this.client.createMultipart(key, contentType)
    task.uploadId = uploadId
    if (task.aborted) throw this.abortedError(id)

    const etagByPart = new Map<number, string>()
    let loaded = 0
    let nextPart = 1
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let inFlight = 0
      const fail = (e: unknown) => {
        if (!settled) { settled = true; reject(e) }
      }
      const maybeFinish = () => {
        if (settled || inFlight > 0) return
        settled = true
        if (task.aborted) reject(this.abortedError(id))
        else resolve()
      }
      const pump = () => {
        while (!settled && inFlight < PART_CONCURRENCY && nextPart <= partCount && !task.aborted) {
          const n = nextPart++
          inFlight++
          this.uploadOne(task, uploadId, n).then(
            part => {
              inFlight--
              if (settled) return // 已失败/取消：迟到分片只丢弃
              etagByPart.set(part.partNumber, part.etag)
              loaded += part.bytes
              this.hooks.onProgress?.(id, loaded, total) // 每片必调，节流归调用侧
              maybeFinish()
              pump()
            },
            e => { inFlight--; fail(e) },
          )
        }
        maybeFinish() // 终止路径：aborted 且在途清零
      }
      pump()
    })

    if (task.aborted) throw this.abortedError(id)
    const parts = [...etagByPart.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partNumber, etag]) => ({ partNumber, etag }))
    await this.client.completeMultipart(key, uploadId, parts)
    task.uploadId = undefined
  }

  /** 上传单个分片：返回 partNumber/etag/字节长度，供进度累计与提交排序 */
  private async uploadOne(task: Task, uploadId: string, partNumber: number) {
    const start = (partNumber - 1) * this.partSize
    const end = Math.min(start + this.partSize, task.file.size)
    const { etag } = await this.client.uploadPart(task.key, uploadId, partNumber, task.file.slice(start, end))
    return { partNumber, etag, bytes: end - start }
  }

  private abortedError(id: string): SdkError {
    return new SdkError(UPLOAD_ABORTED_CODE, '上传已取消', { id })
  }
}

const isTerminal = (s: UploadStatus): boolean => s === 'done' || s === 'failed' || s === 'aborted'

/** 扩展名归一化：去前导点 + 小写（'.EXE'/'exe'/'ExE' 等价） */
function normalizeExt(ext: string): string {
  return ext.trim().replace(/^\.+/, '').toLowerCase()
}

/** 取文件扩展名（小写）；无扩展名或 '.hidden' 形态返回 ''（不参与黑名单判定） */
function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 前缀规范化：非空前补尾 '/'（'' 即 bucket 根） */
function normalizePrefix(p: string): string {
  if (p === '') return ''
  return p.endsWith('/') ? p : `${p}/`
}

/** SdkError 原样透传；其余包装为 S3_ERROR */
function asSdkError(e: unknown): SdkError {
  if (e instanceof SdkError) return e
  const msg = e instanceof Error ? e.message : String(e)
  return new SdkError(ERROR_CODES.S3_ERROR, msg === '' ? '上传失败' : msg, e)
}

/** 任务 id：jsdom 无 crypto.randomUUID，用单调计数 + 随机段兜底保证唯一 */
let idSeq = 0
function genId(): string {
  idSeq += 1
  return `up-${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
