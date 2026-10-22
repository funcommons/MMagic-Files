/**
 * 上传队列（Wave1-A5 管理面；Lane G1 暂停/恢复/重试 + 冲突确认）。契约：S3Client/types.ts；
 * onProgress/onDone/onFailed 由装配层映射 uploadProgress/uploadDone/uploadFailed 事件。
 * 要点：enqueue 同步校验分类（ext→size）不抛批错误；≤阈值直传，超出 multipart（分片并发≤2，
 *       complete 按 partNumber 升序）；abort 排队即弃、分片中立即 abortMultipart、统一取消码。
 *
 * Lane G1 诚实口径（暂停/恢复/重试语义，实现与注释一致，无夸大）：
 *  - multipart 项 pause(id)：不再调度后续分片；当前在途分片落定后进入 paused 终态前状态
 *    （保留 uploadId 与已完成分片 etag，服务端分片不清理）。resume(id) 续传：uploadPart 按
 *    partNumber 幂等，已落定分片直接跳过不重传，只补传缺失分片后 complete。
 *  - 直传（单 PUT）项：S3Client.put 无中断通道（无 AbortSignal 参数），"暂停"对在途直传项
 *    不产生暂停效果——put 落定即 done（文件已在服务端，不能谎报暂停）。pause 仅对排队中项
 *    即时生效；分片中项按上述分片口径生效。
 *  - retry(id)（仅 failed 项）：失败时不再 abort 清理服务端分片（Lane G1 语义修订），uploadId
 *    与已完成分片保留在任务上，retry 复用 uploadId 续传（只补缺失分片）；直传项失败=整重传
 *    （无 uploadId 可复用）。注意：失败任务的分片残留将保留至 retry 消化；若任务被 abort 则
 *    立即 abortMultipart 清理； neither 时残留交由 S3 存储桶生命周期规则兜底（诚实注记）。
 *  - pauseAll/resumeAll：队列级便捷方法，逐项调 pause/resume（幂等）。
 *  - enqueue 可选 opts.onConflict：提供时入队前 client.head 并发探测（≤8 路）重名，命中回调
 *    裁决（'overwrite'=照传覆盖 / 'skip'=该文件进 rejected{reason:'conflict'}；回调抛错=整批
 *    取消，调用方收到 reject——Home 以 4901 语义承载）。缺省不探测直传（现行为不变，JSSDK
 *    uploadFiles 命令路径不传 onConflict，行为零变化）。
 */
import { ERROR_CODES, SdkError } from '@/sdk/errorCodes'
import type { S3Client } from '@/sdk/types'

const MB = 1024 * 1024
/** 单文件内分片并行度（2 路足够打满带宽又不挤占多文件并发） */
const PART_CONCURRENCY = 2
/** 冲突探测并发上限（head 轻请求，8 路足够又不挤占） */
const PROBE_CONCURRENCY = 8

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

/** 冲突裁决结果：'overwrite'=照常上传（S3 put 天然覆盖）；'skip'=跳过该批重名文件 */
export type ConflictVerdict = 'overwrite' | 'skip'

export interface EnqueueOptions {
  /** 重名裁决回调（可缺省）：命中重名时以重名文件名列表调用；抛错=整批取消（调用方 reject） */
  onConflict?: (names: string[]) => Promise<ConflictVerdict>
}

export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'done' | 'failed' | 'aborted'

/** 拒收原因：ext/size（契约 §五）+ conflict（Lane G1 新增，仅显式 onConflict 路径产生） */
export type UploadRejectReason = 'ext' | 'size' | 'conflict'

/** JSSDK 兼容回包（commands.ts finishEnqueue 消费）：reason 限契约两值（形状向后兼容，不得放宽） */
export interface EnqueueResult {
  accepted: { id: string }[]
  rejected: { name: string; reason: Exclude<UploadRejectReason, 'conflict'>; code?: number }[]
}

/**
 * 冲突路径回包（onConflict 异步重载）：rejected reason 扩展 'conflict'——该联合类型仅存在于
 * upload-queue 内部与 UI 直连路径；JSSDK uploadFiles 命令不传 onConflict，回包仍为
 * EnqueueResult（契约形状零变化，commands.ts 只读不受影响）。
 */
export interface ConflictEnqueueResult {
  accepted: { id: string }[]
  rejected: { name: string; reason: UploadRejectReason; code?: number }[]
}

/**
 * 用户取消专码。契约 §七未定义"取消"错误码，预留 4901；
 * 装配层映射 uploadFailed 时按 code>=4900 识别为用户主动取消。
 */
export const UPLOAD_ABORTED_CODE = 4901

/**
 * 冲突拒收码（占位）：契约 §七未定义"重名冲突"错误码，按任务书口径暂借 4005（BAD_PARAM）
 * 占位，仅供 UI 侧识别；JSSDK reply 的 rejected 仅由 commands.ts 从 ext/size 映射 4304/4302，
 * conflict 只出现在显式传入 onConflict 的 UI 直连路径，不进 JSSDK 回包（reason 联合类型为本
 * 模块内部扩展，commands.ts 只读不受影响）。
 */
export const UPLOAD_CONFLICT_CODE = ERROR_CODES.BAD_PARAM

interface Task {
  id: string
  file: File
  key: string
  status: UploadStatus
  aborted: boolean
  /** 暂停标记：pump 不调度；分片泵停止派发新分片，在途落定后 run 以 paused 落定 */
  paused: boolean
  uploadId?: string // multipart 进行中的 uploadId（undefined = 非分片或已收尾/已被 abort 清理）
  errMsg?: string // 最近一次失败原因（errorOf 供面板展示；重试成功不清除也无碍——status 已非 failed）
  /** 已落定分片 etag（partNumber 升序提交）；pause/失败后保留供 resume/retry 续传 */
  parts?: Map<number, string>
  /** 是否还在 pending 池（resume 时避免重复入池） */
  inPending: boolean
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

  /**
   * 冲突探测路径：opts.onConflict 提供时为异步（head 探测 + 回调裁决后落池），resolve 完整回包。
   * （重载在前：vi.mocked 等工具类型取末个重载推断，保证同步契约路径的既有 mock 用法不破。）
   */
  enqueue(files: File[], prefix: string | undefined, opts: EnqueueOptions): Promise<ConflictEnqueueResult>
  /** 校验分类并入池开跑：同步返回受理/拒绝结果（对齐 UploadFilesReply），不抛批错误 */
  enqueue(files: File[], prefix?: string): EnqueueResult
  enqueue(files: File[], prefix = '', opts?: EnqueueOptions): EnqueueResult | Promise<ConflictEnqueueResult> {
    if (opts?.onConflict) return this.enqueueWithConflict(files, prefix, opts.onConflict)
    const { accepted, rejected } = this.classify(files, normalizePrefix(prefix))
    this.admit(accepted)
    // 同步路径只产生 ext/size（conflict 仅 onConflict 异步路径产生），收窄断言安全
    return { accepted: accepted.map(a => ({ id: a.task.id })), rejected: rejected as EnqueueResult['rejected'] }
  }

  /** 同步分类：ext/size 拒收 + 受理候选（不入池；入池统一走 admit） */
  private classify(files: File[], base: string): {
    accepted: { task: Task }[]
    rejected: ConflictEnqueueResult['rejected']
  } {
    const accepted: { task: Task }[] = []
    const rejected: { name: string; reason: UploadRejectReason; code?: number }[] = []
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
      accepted.push({ task: this.newTask(f, base + f.name) })
    }
    return { accepted, rejected }
  }

  /** 异步入队：分类 → head 重名探测（并发≤8，探测失败按不存在处理） → 回调裁决 → 落池 */
  private async enqueueWithConflict(
    files: File[],
    prefix: string,
    onConflict: (names: string[]) => Promise<ConflictVerdict>,
  ): Promise<ConflictEnqueueResult> {
    const base = normalizePrefix(prefix)
    const { accepted, rejected } = this.classify(files, base)
    const hits = await this.probeExisting(accepted.map(a => a.task.key))
    if (hits.size > 0) {
      // 回调抛错（Home 的"取消整批"）→ 直接向上抛：调用方 reject（4901 语义），本批一个不入池
      const verdict = await onConflict([...hits].map(key => key.slice(base.length)))
      if (verdict === 'skip') {
        const kept: { task: Task }[] = []
        for (const a of accepted) {
          if (hits.has(a.task.key)) rejected.push({ name: a.task.file.name, reason: 'conflict', code: UPLOAD_CONFLICT_CODE })
          else kept.push(a)
        }
        accepted.length = 0
        accepted.push(...kept)
      }
      // 'overwrite'：全部照传（S3 put 同 key 天然覆盖）
    }
    this.admit(accepted)
    return { accepted: accepted.map(a => ({ id: a.task.id })), rejected }
  }

  /** 并发≤8 探测重名 key 集合；单 key 探测异常按"不存在"处理（不阻断上传主链路） */
  private async probeExisting(keys: string[]): Promise<Set<string>> {
    const hits = new Set<string>()
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < keys.length) {
        const key = keys[cursor++]!
        try {
          if ((await this.client.head(key)).exists) hits.add(key)
        } catch {
          // 探测失败不阻断：head 非 2xx（权限/网络抖动）时按不存在直传，行为回退到无探测
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, keys.length) }, worker))
    return hits
  }

  private newTask(file: File, key: string): Task {
    return { id: genId(), file, key, status: 'queued', aborted: false, paused: false, inPending: false }
  }

  /** 落池开跑（同步/异步路径共用） */
  private admit(accepted: { task: Task }[]): void {
    for (const { task } of accepted) {
      this.tasks.set(task.id, task)
      task.inPending = true
      this.pending.push(task)
    }
    this.pump()
  }

  /**
   * 取消任务：排队/暂停中直接取消并回调 onFailed（multipart 残留一并 abortMultipart 清理）；
   * 上传中 multipart 立即 abortMultipart（直传 put 无 signal，完成后于 run 内丢弃）。
   * 已终态/未知 id 返回 false（幂等）。
   */
  abort(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || isTerminal(task.status)) return false
    task.aborted = true
    if (task.status === 'queued' || task.status === 'paused') {
      task.status = 'aborted' // 留在队列里由 pump 跳过，避免 splice
      this.cleanupMultipart(task) // paused 的 multipart 项可能持有 uploadId，一并清理
      this.hooks.onFailed?.(id, this.abortedError(id))
      return true
    }
    this.cleanupMultipart(task)
    return true
  }

  /**
   * 暂停单项：queued 立即落 paused；uploading 的 multipart 停止调度新分片、在途落定后落
   * paused（保留 uploadId/分片）；直传在途项标记后照常落定（put 无中断通道，诚实口径见
   * 文件头注）。已暂停/终态/未知 id 返回 false（幂等）。
   */
  pause(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || isTerminal(task.status) || task.paused) return false
    task.paused = true
    if (task.status === 'queued') task.status = 'paused'
    // uploading：分片泵观察到 paused 后停止派发，在途清零由 run 落 paused；直传落定即 done
    return true
  }

  /** 恢复单项：paused → queued 重新入池（multipart 续传：已落定分片按 partNumber 跳过） */
  resume(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || task.status !== 'paused') return false
    task.paused = false
    task.status = 'queued'
    if (!task.inPending) {
      task.inPending = true
      this.pending.push(task)
    }
    this.pump()
    return true
  }

  /**
   * 重试失败项：failed → queued 重新入池。multipart 项复用 uploadId + 已完成分片续传（只补
   * 缺失分片）；直传项无 uploadId 可复用=整重传。aborted（服务端 uploadId 已销毁）不支持
   * retry——如需重传请重新入队。非 failed/未知 id 返回 false（幂等）。
   */
  retry(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || task.status !== 'failed') return false
    task.paused = false
    task.status = 'queued'
    task.inPending = true
    this.pending.push(task)
    this.pump()
    return true
  }

  /** 队列级暂停：所有 queued/uploading（非终态、未暂停）项逐项 pause（幂等） */
  pauseAll(): void {
    for (const task of this.tasks.values()) this.pause(task.id)
  }

  /** 队列级恢复：所有 paused 项逐项 resume（幂等） */
  resumeAll(): void {
    for (const task of this.tasks.values()) this.resume(task.id)
  }

  status(id: string): UploadStatus | undefined {
    return this.tasks.get(id)?.status
  }

  /** 失败原因（failed 项；取消项也有——UPLOAD_ABORTED 语义）：面板失败行展示用 */
  errorOf(id: string): string | undefined {
    return this.tasks.get(id)?.errMsg
  }

  /** multipart 服务端残留清理（仅 abort 语义调用；业务失败保留供 retry 续传，见文件头注） */
  private cleanupMultipart(task: Task): void {
    const uploadId = task.uploadId
    if (!uploadId) return
    task.uploadId = undefined
    task.parts = undefined
    void this.client.abortMultipart(task.key, uploadId).catch(() => { /* 尽力清理 */ })
  }

  /** 并发池：开满 concurrency，任务终态/暂停落定后回填 */
  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const task = this.pending.shift()
      if (!task) continue
      task.inPending = false
      if (task.aborted || task.paused) continue // 排队中被取消/暂停的任务直接跳过
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
        // 直传无进度回调，起止各报一次；put 无中断通道——pause 只能标记，落定即 done（不谎报暂停）
        this.hooks.onProgress?.(id, 0, file.size)
        await this.client.put(key, file, contentType)
        if (task.aborted) throw this.abortedError(id) // put 不可中断，结束后丢弃
        this.hooks.onProgress?.(id, file.size, file.size)
      } else {
        await this.runMultipart(task, contentType)
        if (task.paused && !task.aborted) {
          task.status = 'paused' // 在途分片已清零的暂停落定：非终态，等 resume 重入
          return
        }
      }
      task.status = 'done'
      this.hooks.onDone?.(id, key)
    } catch (e) {
      if (task.paused && !task.aborted) {
        // 暂停期间在途分片失败也落 paused（非失败终态）：失败分片无 etag 记录，resume 自动补传
        task.status = 'paused'
        return
      }
      task.status = task.aborted ? 'aborted' : 'failed'
      // 取消语义优先：底层噪音（NoSuchUpload 等）不掩盖 UPLOAD_ABORTED
      const err = task.aborted ? this.abortedError(id) : asSdkError(e)
      task.errMsg = `(${err.code}) ${err.message}`
      if (task.aborted) this.cleanupMultipart(task) // 用户取消：服务端分片残留立即清理
      // 业务失败：uploadId/parts 保留（不 abort），retry(id) 复用续传——残留口径见文件头注
      this.hooks.onFailed?.(id, err)
    }
  }

  /** multipart：create（续传时复用 task.uploadId）→ 分片并发≤2 → complete（partNumber 升序提交） */
  private async runMultipart(task: Task, contentType: string): Promise<void> {
    const { id, file, key } = task
    const total = file.size
    const partCount = Math.max(1, Math.ceil(total / this.partSize))
    if (!task.uploadId) {
      const { uploadId } = await this.client.createMultipart(key, contentType)
      task.uploadId = uploadId
      task.parts = new Map()
    }
    const uploadId = task.uploadId
    const etagByPart = (task.parts ??= new Map())
    if (task.aborted) throw this.abortedError(id)

    // 进度按已落定分片重算（续传/重试入口：进度从断点继续而非归零）
    let loaded = 0
    for (const n of etagByPart.keys()) loaded += partBytes(n, this.partSize, total)
    let nextPart = 1
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let inFlight = 0
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }
      const fail = (e: unknown): void => settle(() => reject(e))
      const finish = (): void =>
        settle(() => {
          if (task.aborted) reject(this.abortedError(id))
          else resolve()
        })
      const settleIfIdle = (): void => {
        if (settled || inFlight > 0) return
        finish()
      }
      const pump = (): void => {
        // paused/aborted 停止派发新分片（诚实口径：当前分片落定后停止调度后续分片）
        while (!settled && !task.paused && !task.aborted && inFlight < PART_CONCURRENCY && nextPart <= partCount) {
          const n = nextPart++
          if (etagByPart.has(n)) continue // 续传：已落定分片按 partNumber 跳过（uploadPart 幂等，无需重传）
          inFlight++
          this.uploadOne(task, uploadId, n).then(
            part => {
              inFlight--
              if (settled) return // 已失败/取消/暂停落定：迟到分片只丢弃
              etagByPart.set(part.partNumber, part.etag)
              loaded += part.bytes
              this.hooks.onProgress?.(id, loaded, total) // 每片必调，节流归调用侧
              settleIfIdle() // 暂停时不再续派：等在途清零即落定
              pump()
            },
            e => { inFlight--; fail(e) },
          )
        }
        settleIfIdle() // 终止路径：全部落定（完成/暂停清零）
      }
      pump()
    })

    if (task.paused && !task.aborted) return // run 落 paused，不 complete
    if (task.aborted) throw this.abortedError(id)
    const parts = [...etagByPart.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([partNumber, etag]) => ({ partNumber, etag }))
    await this.client.completeMultipart(key, uploadId, parts)
    task.uploadId = undefined
    task.parts = undefined
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

/** 第 n 片字节长度（末片截断） */
function partBytes(partNumber: number, partSize: number, total: number): number {
  const start = (partNumber - 1) * partSize
  return Math.min(start + partSize, total) - start
}

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
