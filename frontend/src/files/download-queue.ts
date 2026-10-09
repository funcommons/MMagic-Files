/**
 * 下载队列（Lane G1 传输任务中心下载侧）。deps 只依赖 client.get（S3Client 的 get 切片）。
 * 语义：enqueue(keys) 每任务顺序 get → blob → triggerDownload（文件名取 key 尾段）；
 *  - 并发=1（诚实口径）：浏览器多下载并发会被下载 UI 合并/拦截，且 blob URL 的 revoke 时机
 *    不可控（触发即交浏览器，无法感知保存完成）——故全部任务串行、任务内逐文件顺序触发。
 *  - 任务状态 active|done|failed|cancelled；排队等待中的任务同显 active（串行链未到达）。
 *  - cancel(id)：active（含等待中）→ cancelled。fetch 本体无中断通道（S3Client.get 无
 *    signal），在途文件的取流会自然完成，但触发保存前复核取消——已取流未触发的文件直接丢弃。
 *  - retry(id)：failed/cancelled → active 重新挂串行链，从第一个未完成文件继续（已完成文件
 *    不重复触发保存；done 游标即断点）。
 *  - 任务列表为 reactive 数组（供传输面板直读渲染）；终态保留，clearTerminal() 清除非 active 项。
 */
import { reactive } from 'vue'
import { triggerDownload } from '@/utils/download'
import type { S3Client } from '@/sdk/types'

export type DownloadStatus = 'active' | 'done' | 'failed' | 'cancelled'

export interface DownloadTask {
  id: string
  /** 展示名（首键尾段；多键任务即首个文件名） */
  name: string
  /** bucket 全键清单（任务内逐键下载） */
  keys: string[]
  /** 已触发浏览器保存的文件数（=retry 断点游标） */
  done: number
  total: number
  status: DownloadStatus
  error?: string
}

export interface DownloadQueueDeps {
  client: Pick<S3Client, 'get'>
}

export class DownloadQueue {
  private readonly client: DownloadQueueDeps['client']
  /** 任务列表（reactive，供面板渲染）；终态保留直至 clearTerminal */
  readonly tasks = reactive<DownloadTask[]>([])
  /** 串行链尾：并发=1（见文件头注），新任务挂链顺序执行 */
  private chain: Promise<void> = Promise.resolve()

  constructor(deps: DownloadQueueDeps) {
    this.client = deps.client
  }

  /** 入队（顺序执行），返回任务 id；keys 为空返回 null（不建任务） */
  enqueue(keys: string[]): string | null {
    if (keys.length === 0) return null
    const task: DownloadTask = {
      id: genId(),
      name: basenameOf(keys[0]!),
      keys: [...keys],
      done: 0,
      total: keys.length,
      status: 'active',
    }
    this.tasks.push(task)
    this.link(() => this.run(task))
    return task.id
  }

  /** 取消：active（含串行链等待中）→ cancelled；终态/未知 id 返回 false（幂等） */
  cancel(id: string): boolean {
    const task = this.find(id)
    if (!task || task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') return false
    task.status = 'cancelled'
    return true
  }

  /** 重试：failed/cancelled → 重新挂串行链，从断点（done 游标）继续；其余返回 false（幂等） */
  retry(id: string): boolean {
    const task = this.find(id)
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) return false
    task.error = undefined
    task.status = 'active'
    this.link(() => this.run(task))
    return true
  }

  /** 挂串行链尾（run 不 expect 抛错；catch 兜底防链断裂） */
  private link(step: () => Promise<void>): void {
    this.chain = this.chain.then(step).catch(() => { /* run 内部已兜底 */ })
  }

  /** 清除终态记录（active/等待中任务保留） */
  clearTerminal(): void {
    const keep = this.tasks.filter((t) => t.status === 'active')
    this.tasks.splice(0, this.tasks.length, ...keep)
  }

  /** 单任务执行：从 done 游标逐键 get→blob→triggerDownload；取消/失败即止（取消不覆盖终态） */
  private async run(task: DownloadTask): Promise<void> {
    for (let i = task.done; i < task.keys.length; i++) {
      if (task.status !== 'active') return // 已被取消（含取流途中取消）
      const key = task.keys[i]!
      try {
        const res = await this.client.get(key)
        const blob = await res.blob()
        if (task.status !== 'active') return // 取流完成但已取消：丢弃，不触发保存
        triggerDownload(URL.createObjectURL(blob), basenameOf(key))
        task.done += 1
      } catch (e) {
        if (task.status !== 'active') return
        task.status = 'failed'
        task.error = e instanceof Error ? e.message : String(e)
        return
      }
    }
    if (task.status === 'active') task.status = 'done'
  }

  private find(id: string): DownloadTask | undefined {
    return this.tasks.find((t) => t.id === id)
  }
}

function basenameOf(key: string): string {
  return key.slice(key.replace(/\/$/, '').lastIndexOf('/') + 1) || key
}

/** 任务 id：jsdom 无 crypto.randomUUID，用单调计数 + 随机段兜底保证唯一 */
let idSeq = 0
function genId(): string {
  idSeq += 1
  return `dl-${Date.now().toString(36)}-${idSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
