/**
 * 预览打开链——选中文件 → registry 解析默认应用（或按 appId 指定）→ ctx 装配 → 渲染器执行
 * 契约：《方案设计.md》V1.2 §4.6（AppRegistry/同类型多应用）、《动态插件方案.md》§五（dispose/恢复/beforeDispose）、
 *      《第一期文件类型支持计划.md》缺口 7（渲染失败/超时 10s 错误边界）
 * 生命周期：
 *  - 切换（open）/关闭（close）：先过 beforeDispose gate——false=暂缓本次操作（实例与容器完整保留），
 *    3s 超时强制放行，true/无 beforeDispose=直接放行；放行后 dispose 前 getState 采集 savedState（per-key，容量 32）
 *  - expire：通知式——beforeDispose('expired') fire-and-forget，不等结果立即 dispose 并清容器（契约：expired 只通知不询问）
 *  - clear：强制语义（unmount 用，不走 gate）
 *  - 切回=renderer 重跑，第 4 参回注 savedStates.get(entry.key)（插件未声明 getState 时为 undefined）
 *  - renderer 同步抛/拒绝/10s 超时 → per-tab 错误边界（标题+信息+重试+下载门控）；超时后迟到的结算 dispose 其结果并忽略
 *  - open(entry, { appId })：指定应用走 registry.require（既有 not-found 语义），未命中=错误节点不抛裸异常
 *  - Lane G4 尺寸总闸（open 前置，先于 beforeDispose gate / registry 解析）：
 *      size ≤ CONFIRM(20MB) 直开；CONFIRM < size ≤ REJECT(50MB) 询问宿主 confirmLargeFile
 *      （false/异常=取消本次 open，零半更新；无回调=放行，向后兼容）；size > REJECT 拒绝节点
 *      （不取流不渲染，文案 largefile.rejected + 下载钮 canDownload/onDownload 双门）。
 *    层次：本闸=预览链上游总闸（仅凭列表元数据判定，零取流）；渲染器自有上限=下游兜底
 *      （已取流后的内存防线：code/markdown 5MB、csv 20MB、heic 32MB 拒转——口径独立各管一段；
 *      pdf 渲染器无自带上限，主要依赖本总闸）。size 缺失/0（单文件模式伪条目）跳过本闸。
 */
import { AppRegistry } from '@/apps/registry'
import { createAppCtx } from '@/apps/ctx'
import type { AppDataSource } from '@/apps/datasource'
import type { AppDefinition, AppInstance, S3ObjectSummary } from '@/sdk/types'

/** beforeDispose 询问超时：超时强制放行（契约 §五） */
const BEFORE_DISPOSE_TIMEOUT_MS = 3_000
/** 渲染超时：失败/超时降级错误节点，不崩工作台（缺口 7） */
const RENDER_TIMEOUT_MS = 10_000
/** savedState per-key 容量上限：超出淘汰最旧 */
const SAVED_STATE_LIMIT = 32

/**
 * 大文件分级闸阈值（Lane G4，建议默认值——《第一期文件类型支持计划.md》§三「可配」口径）：
 * CONFIRM 以上询问宿主、REJECT 以上直接拒绝；两者间留给确认 UI 裁决。
 */
export const PREVIEW_CONFIRM_BYTES = 20 * 1024 * 1024
export const PREVIEW_REJECT_BYTES = 50 * 1024 * 1024

/** 阈值展示文案：常量恒为 MB 整数倍，直接除（'20MB'/'50MB'） */
function formatLimit(bytes: number): string {
  return `${bytes / (1024 * 1024)}MB`
}

export interface PreviewOptions {
  container: HTMLElement
  registry: AppRegistry
  datasource: AppDataSource
  /** 宿主词典（i18n）：params 透传做占位插值（vue-i18n 具名插值口径；宿主包装器需把第二参转发给 t） */
  t: (key: string, params?: Record<string, unknown>) => string
  theme: Record<string, string>
  notifyFileChanged: (payload: { key: string; action: 'put' | 'delete' | 'rename'; from?: string }) => void
  /** 下载处理器（fallback/错误节点下载钮用；缺省=提示文案 only） */
  onDownload?: (entry: S3ObjectSummary) => void
  /** lazy 插件触发（registry 未命中时先加载配置插件再重解析一次；契约：lazy 默认开、首匹配才 import） */
  ensureApps?: (entry: { name: string; mime?: string; size?: number }) => Promise<void>
  /** 下载总闸（缺省 true）：false 时 fallback 与错误节点均不出下载钮 */
  canDownload?: boolean
  /**
   * 大文件确认 UI（Lane G4 确认档，CONFIRM < size ≤ REJECT 时询问）：true=继续渲染，false=取消本次 open。
   * 缺省=确认档直接放行——默认策略：宿主未注入确认 UI 时不得把中型文件变成死路（向后兼容：
   * 既有宿主升级 SDK 后行为不变，大文件防护只在其显式接线时收紧）。
   */
  confirmLargeFile?: (entry: S3ObjectSummary, sizeBytes: number) => Promise<boolean>
  /**
   * 打开链接管通知（Lane H1 预览 tab 条所需最小暴露）：open 链过闸并接管容器（含大文件拒绝节点）
   * 时以 entry 通知——「open 链成功」的权威信号；被暂缓/取消/被新链接管的链不触发（零半更新同步）。
   * 渲染随后失败也照常通知（错误节点同样是接管态，tab 重试链自洽）。
   */
  onOpened?: (entry: S3ObjectSummary) => void
}

export interface PreviewOpenOptions {
  /** 指定应用（「打开方式」）：registry.require 按 id 取（既有 not-found 语义），未命中→错误节点，不抛裸异常 */
  appId?: string
}

export interface PreviewHandle {
  /** 打开/切换文件；先过大文件尺寸闸（Lane G4：>REJECT 拒绝节点 / 确认档取消——均状态零变更），
   *  再过 beforeDispose gate 后 dispose 旧实例。registry 无命中→fallback 下载提示；
   *  渲染失败/超时→错误节点。被暂缓（gate=false）时本链不生效（状态零变更） */
  open(entry: S3ObjectSummary, openOpts?: PreviewOpenOptions): Promise<void>
  /** 关闭当前预览（走 gate）；返回是否真的关闭，false=被 beforeDispose 暂缓 */
  close(): Promise<boolean>
  /** 会话过期/销毁：通知式 beforeDispose('expired')（不等结果）后立即 dispose 并清容器 */
  expire(): void
  /** 清空（含当前实例 dispose；强制语义不走 gate，unmount 用） */
  clear(): void
  /** 当前打开的条目（供 UI 高亮/测试） */
  current(): S3ObjectSummary | null
}

/** 渲染结果归一：ok=拿到实例（或无返回）；failed=同步抛/拒绝/超时 */
type RenderOutcome = { status: 'ok'; instance: AppInstance | null } | { status: 'failed'; error: unknown }

export function createPreview(opts: PreviewOptions): PreviewHandle {
  const { container, registry, datasource, t, theme, notifyFileChanged, onDownload, ensureApps, confirmLargeFile, onOpened } =
    opts
  /** 下载门：缺省 true；fallback 与错误节点下载钮共用 */
  const canDownload = opts.canDownload !== false
  let instance: AppInstance | null = null
  let current: S3ObjectSummary | null = null
  /** 生命周期代际：gate/渲染等 await 点之后校验，被新链接管的老链整体退出（防半更新） */
  let seq = 0
  /** per-key savedState：dispose 前 getState 采集；Map 插入序=新鲜度序，超限淘汰最旧 */
  const savedStates = new Map<string, unknown>()

  function captureSavedState(key: string, state: unknown): void {
    // 重写先删再插=刷新新鲜度；超限从最旧端淘汰
    savedStates.delete(key)
    savedStates.set(key, state)
    while (savedStates.size > SAVED_STATE_LIMIT) {
      const oldest = savedStates.keys().next()
      if (oldest.done) break
      savedStates.delete(oldest.value)
    }
  }

  /** 销毁实例：dispose 前 getState 采集（契约「切回=重跑+状态恢复」）；getState/dispose 异常不阻断销毁 */
  function teardown(inst: AppInstance | null, key: string | null): void {
    if (!inst) return
    if (key !== null && typeof inst.getState === 'function') {
      try {
        captureSavedState(key, inst.getState())
      } catch {
        // getState 异常不阻断 dispose
      }
    }
    try {
      inst.dispose()
    } catch {
      // dispose 异常不阻断切换/关闭
    }
  }

  /** beforeDispose gate：false=暂缓；3s 超时/异常=强制放行；true/无 beforeDispose=放行 */
  function askBeforeDispose(inst: AppInstance | null): Promise<boolean> {
    const ask = inst?.beforeDispose
    if (!inst || !ask) return Promise.resolve(true)
    let outcome: boolean | Promise<boolean>
    try {
      outcome = ask.call(inst)
    } catch {
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolveGate) => {
      let settled = false
      const finish = (v: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveGate(v)
      }
      const timer = setTimeout(() => finish(true), BEFORE_DISPOSE_TIMEOUT_MS)
      Promise.resolve(outcome).then(
        (v) => finish(v !== false),
        () => finish(true),
      )
    })
  }

  function errMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    if (err !== null && typeof err === 'object') {
      const m = (err as { message?: unknown }).message
      if (typeof m === 'string') return m
    }
    return err == null ? '' : String(err)
  }

  function appendDownloadButton(wrap: HTMLElement, entry: S3ObjectSummary): void {
    if (!canDownload || !onDownload) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'fc-button'
    btn.textContent = t('files.preview-download')
    btn.addEventListener('click', () => onDownload(entry))
    wrap.appendChild(btn)
  }

  function renderFallback(entry: S3ObjectSummary): void {
    const wrap = document.createElement('div')
    wrap.className = 'mmf-preview-fallback'
    const tip = document.createElement('p')
    tip.textContent = t('files.preview-fallback')
    wrap.appendChild(tip)
    appendDownloadButton(wrap, entry)
    container.appendChild(wrap)
  }

  /** per-tab 错误边界节点：标题+信息+重试（重跑同一 open）+下载（门控） */
  function renderErrorNode(entry: S3ObjectSummary, message: string, openOpts: PreviewOpenOptions): void {
    const wrap = document.createElement('div')
    wrap.className = 'mmf-preview-error'
    const title = document.createElement('p')
    title.className = 'mmf-preview-error__title'
    title.textContent = t('files.preview-error-title')
    wrap.appendChild(title)
    if (message) {
      const info = document.createElement('p')
      info.className = 'mmf-preview-error__message'
      info.textContent = message
      wrap.appendChild(info)
    }
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'fc-button'
    retry.textContent = t('files.preview-error-retry')
    retry.addEventListener('click', () => {
      void open(entry, openOpts)
    })
    wrap.appendChild(retry)
    appendDownloadButton(wrap, entry)
    container.appendChild(wrap)
  }

  /** 大文件拒绝节点（Lane G4 拒绝档）：拒绝文案（带 limit 占位）+ 下载钮（canDownload/onDownload 双门，复用 appendDownloadButton） */
  function renderRejectedNode(entry: S3ObjectSummary): void {
    const wrap = document.createElement('div')
    wrap.className = 'mmf-preview-rejected'
    const tip = document.createElement('p')
    tip.className = 'mmf-preview-rejected__message'
    tip.textContent = t('largefile.rejected', { limit: formatLimit(PREVIEW_REJECT_BYTES) })
    wrap.appendChild(tip)
    appendDownloadButton(wrap, entry)
    container.appendChild(wrap)
  }

  /**
   * 容器接管（open 主链与尺寸闸拒绝档共用）：销毁旧实例（dispose 前 getState 采集）→ 清容器 → current 切换
   * → onOpened 通知（Lane H1：接管即「open 链成功」信号，渲染成败不影响）。
   * 前置条件：调用方已过代际校验（my === seq）与 beforeDispose gate——本函数不做任何询问。
   */
  function takeOver(entry: S3ObjectSummary, prev: AppInstance | null, prevKey: string | null): void {
    instance = null
    teardown(prev, prevKey)
    container.innerHTML = ''
    current = entry
    try {
      onOpened?.(entry)
    } catch {
      // 宿主回调异常不阻断渲染链
    }
  }

  /** 渲染器执行：10s 超时竞速；超时后迟到的结算 dispose 其结果并忽略（防泄漏/后台请求） */
  function runRenderer(
    def: AppDefinition,
    el: HTMLElement,
    file: { key: string; name: string; size: number },
    ctx: Parameters<AppDefinition['renderer']>[2],
    savedState: unknown,
  ): Promise<RenderOutcome> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (o: RenderOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(o)
      }
      const timer = setTimeout(() => {
        finish({ status: 'failed', error: new Error(`渲染超时（${RENDER_TIMEOUT_MS / 1000}s）`) })
      }, RENDER_TIMEOUT_MS)
      const disposeLate = (result: unknown): void => {
        if (result && typeof (result as AppInstance).dispose === 'function') {
          try {
            ;(result as AppInstance).dispose()
          } catch {
            // 迟到结果的销毁异常忽略
          }
        }
      }
      let running: Promise<void | AppInstance>
      try {
        running = Promise.resolve(def.renderer(el, file, ctx, savedState))
      } catch (err) {
        finish({ status: 'failed', error: err })
        return
      }
      running.then(
        (result) => {
          if (settled) {
            disposeLate(result) // 超时后迟到结算：销毁并忽略
            return
          }
          finish({ status: 'ok', instance: result && typeof result === 'object' ? (result as AppInstance) : null })
        },
        (err: unknown) => {
          if (settled) return // 迟到的拒绝：忽略
          finish({ status: 'failed', error: err })
        },
      )
    })
  }

  async function open(entry: S3ObjectSummary, openOpts: PreviewOpenOptions = {}): Promise<void> {
    const my = ++seq
    // ===== Lane G4 尺寸总闸（appId 路径同样生效）=====
    // 闸序决策：先于 beforeDispose gate——「确认了却被旧实例暂缓」是体验割裂（用户为一次注定不生效的
    // open 付出确认成本），故先裁尺寸、后问旧实例；确认档被新链接管时走代际校验整体退出。
    // size 缺失/0（单文件模式伪条目）：无法判定，跳过本闸，下游渲染器自有上限兜底（见文件头层次注）。
    const sizeBytes = entry.size
    if (sizeBytes > 0) {
      if (sizeBytes > PREVIEW_REJECT_BYTES) {
        // 拒绝档：不取流不渲染；容器仍按常规链接管（gate→接管→拒绝节点），下载引导兜底
        const gate = await askBeforeDispose(instance)
        if (my !== seq) return
        if (!gate) return // 暂缓：拒绝节点不出，旧预览完整保留
        takeOver(entry, instance, current?.key ?? null)
        renderRejectedNode(entry)
        return
      }
      if (sizeBytes > PREVIEW_CONFIRM_BYTES && confirmLargeFile) {
        // 确认档：仅宿主注入了确认 UI 才询问；同步抛/拒绝异常一律视为取消（宁可少渲染，不可误渲染）
        let ok = false
        try {
          ok = await confirmLargeFile(entry, sizeBytes)
        } catch {
          ok = false
        }
        if (my !== seq) return // 确认挂起期间被新链/关闭接管：本链整体退出
        if (!ok) return // 取消：保持当前预览不变（复用 beforeDispose 暂缓的「零半更新」纪律）
      }
      // 确认档无回调：直接放行（默认策略与理由见 PreviewOptions.confirmLargeFile 注——宿主未注入
      // 确认 UI 时不得把中型文件变成死路，向后兼容）
    }
    const gate = await askBeforeDispose(instance)
    if (my !== seq) return // 已被更新的 open/close/clear/expire 接管：本链整体退出
    if (!gate) return // 暂缓：保留当前实例与容器内容，本次 open 不生效
    takeOver(entry, instance, current?.key ?? null)
    const fileRef = { name: entry.name, mime: entry.mime, size: entry.size }
    let def: AppDefinition | null = null
    if (openOpts.appId !== undefined) {
      // 指定应用：registry.require 既有 not-found 语义（4102）——未命中降级错误节点，不抛裸异常
      try {
        def = registry.require(openOpts.appId)
      } catch (err) {
        renderErrorNode(entry, errMessage(err), openOpts)
        return
      }
    } else {
      def = registry.resolveDefault(fileRef)
      if (!def && ensureApps) {
        // lazy 插件首命中触发：未命中先尝试加载配置插件，再解析一次
        try {
          await ensureApps(fileRef)
        } catch {
          // 加载失败按未命中处理
        }
        if (my !== seq) return
        def = registry.resolveDefault(fileRef)
      }
    }
    if (!def) {
      renderFallback(entry)
      return
    }
    const ctx = createAppCtx({
      getObject: (key) => datasource.getObject(key),
      putObject: (key, data, contentType) => datasource.putObject(key, data, contentType),
      t,
      theme,
      notifyFileChanged,
      // 媒体直链能力透传（s3=presigned URL / url source=原始 URL；缺省不带，渲染器探测回落 Blob）
      ...(datasource.getMediaUrl ? { getMediaUrl: (key: string) => datasource.getMediaUrl!(key) } : {}),
    })
    const el = document.createElement('div')
    el.className = 'mmf-preview-stage'
    container.appendChild(el)
    const outcome = await runRenderer(
      def,
      el,
      { key: entry.key, name: entry.name, size: entry.size },
      ctx,
      savedStates.get(entry.key),
    )
    if (my !== seq) {
      // 渲染期间被接管：丢弃结果（实例类则销毁），容器归新链所有
      if (outcome.status === 'ok' && outcome.instance) {
        try {
          outcome.instance.dispose()
        } catch {
          // 忽略
        }
      }
      return
    }
    if (outcome.status === 'failed') {
      container.innerHTML = ''
      renderErrorNode(entry, errMessage(outcome.error), openOpts)
      return
    }
    instance = outcome.instance
  }

  return {
    open,
    async close(): Promise<boolean> {
      const my = ++seq
      const inst = instance
      const key = current?.key ?? null
      const gate = await askBeforeDispose(inst)
      if (my !== seq) return true // 已被后续 open/close/clear 接管：未暂缓
      if (!gate) return false // 被暂缓
      instance = null
      current = null
      teardown(inst, key)
      container.innerHTML = ''
      return true
    },
    expire(): void {
      seq++
      const inst = instance
      const key = current?.key ?? null
      instance = null
      current = null
      if (!inst) {
        container.innerHTML = ''
        return
      }
      // 通知式（契约：expired 只通知不询问）——reason 实参对插件可选透传（签名无参，插件可忽略）
      const notify = inst.beforeDispose as unknown as ((reason: 'expired') => unknown) | undefined
      try {
        notify?.('expired')
      } catch {
        // 通知异常不阻断销毁
      }
      teardown(inst, key)
      container.innerHTML = ''
    },
    clear(): void {
      seq++
      const inst = instance
      const key = current?.key ?? null
      instance = null
      current = null
      teardown(inst, key) // 强制语义：不走 gate（unmount 用）
      container.innerHTML = ''
    },
    current: () => current,
  }
}
