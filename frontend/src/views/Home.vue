<script setup lang="ts">
/**
 * Home.vue — 工作台根页（Wave2-T2；Lane F3 消费层接线；Lane F5 交互面改版）。
 * !ok → 配置错误卡（保留 M0）；ok+workspace → SessionBanner+Toolbar+TreePanel+UploadPanel
 * （左树右预览，M2 换多 tab）；ok+file → 单文件预览（urlDataSource+registry 按 name 解析默认
 * 应用，F2）；boot 未注入 → M0 hero 兜底。
 * Lane F3：① notifyFileChanged 真接线（renderer 保存 → tree.applyChange + bus 'fileChanged'，
 * 审计 P0）；② features.download 门控；③ bus 'expired' → preview.expire()；④ ui.defaultOpen 挂载后直开。
 * Lane F5（交互模型，对齐手册「双击/回车打开」）：
 *  - 选中不再自动开预览：单击=仅选中（多选由 TreePanel 内聚：ctrl/cmd 切换、shift 范围）；
 *    双击文件/回车/菜单「打开」→ @open → preview.open；「打开方式」→ @open-with → preview.open({appId})；
 *  - 右键菜单动作与 Toolbar 共用操作链（workspace-ops 收口，零复制）；
 *  - 多选：selected 为数组（Toolbar 删除按全集/重命名按首项）；
 *  - 多选打包下载：>1 文件 → zip.ts（store 模式，累计 256MB 上限 toast）→ triggerDownload；
 *  - 拖拽上传：TreePanel @drop-files → trackedEnqueue（任务登记）→ 拒收 toast；
 *  - UploadPanel：上传任务面板（登记在 trackedEnqueue；状态经 queue.status 轮询同步——
 *    bus.emit 仅外发宿主、本地 handler 不触发，故 upload* 事件不能作面板数据源）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { inject } from 'vue'
import { FcButton, FcSectionCard, FcTag, toast } from '@/components/sdk'
import { usePreferenceStore } from '@/store/preference'
import { BOOT_KEY } from '@/boot'
import { setupWorkspace } from '@/files/setup'
import { createPreview } from '@/files/preview'
import { normalizePrefix } from '@/files/tree-store'
import { s3DataSource, urlDataSource } from '@/apps/datasource'
import { UrlSourceProvider } from '@/sdk/url-source'
import { resolveFeatures } from '@/sdk/features'
import { triggerDownload } from '@/utils/download'
import { ZIP_SIZE_LIMIT, zipStore } from '@/files/zip'
import { createWorkspaceOps } from '@/files/ui/workspace-ops'
import SessionBanner from '@/files/ui/SessionBanner.vue'
import { formatRemaining } from '@/files/session-format'
import { EXPIRE_WARN_BEFORE_MS } from '@/sdk/constants'
import Toolbar from '@/files/ui/Toolbar.vue'
import TreePanel from '@/files/ui/TreePanel.vue'
import UploadPanel from '@/files/ui/UploadPanel.vue'
import type { UploadTaskView } from '@/files/ui/UploadPanel.vue'
import type { PreviewHandle } from '@/files/preview'
import type { EnqueueResult } from '@/files/upload-queue'
import type { S3ObjectSummary } from '@/sdk/types'

const { t } = useI18n()
const preference = usePreferenceStore()
const boot = inject(BOOT_KEY)

/** workspace 装配（setup.ts 模块级单例；file 模式在其内部返回 null） */
function resolveWorkspace() {
  if (!boot || !boot.ok || boot.handle.config.mode !== 'workspace') return null
  const stores = setupWorkspace(boot.handle)
  if (!stores) return null
  return {
    stores,
    session: boot.handle.session,
    rootPrefix: boot.handle.config.backend.prefix,
    mode: boot.handle.config.mode,
  }
}
const ws = resolveWorkspace()

/** file 模式单文件配置（F2：接渲染器） */
function resolveFile() {
  if (!boot || !boot.ok || boot.handle.config.mode !== 'file') return null
  return boot.handle.config
}
const fileConfig = resolveFile()

function basenameOf(url: string): string {
  try {
    const path = new URL(url).pathname
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || url
  } catch {
    return url
  }
}
const fileName = fileConfig ? (fileConfig.name ?? basenameOf(fileConfig.source.url)) : ''

/** features 门控（F1）：resolveFeatures(config.features) 传 Toolbar/TreePanel，false 隐藏对应操作入口 */
const features = computed<Record<string, boolean>>(() =>
  boot && boot.ok ? resolveFeatures(boot.handle.config.features) : {},
)
const registry = computed(() => (boot && boot.ok ? boot.handle.registry : null))

/** 选中集（Lane F5 多选数组）：单击=替换、ctrl/cmd=切换、shift=范围（切换逻辑在 TreePanel 内聚） */
const selected = ref<S3ObjectSummary[]>([])
function onSelect(entries: S3ObjectSummary[]): void {
  selected.value = entries
}
/** changed(key)（删除/重命名的旧 key）：从选中集剔除 */
function onChanged(key: string): void {
  selected.value = selected.value.filter((s) => s.key !== key)
}

/** 操作链（mkdir/rename/remove/上传拒收）：Toolbar 与右键菜单共用（workspace-ops 收口） */
const ops = ws ? createWorkspaceOps({ tree: ws.stores.tree, t }) : null

// ── 上传任务面板（Lane F5）：登记（trackedEnqueue）+ bus upload* 事件同步 ──

const uploadTasks = ref<UploadTaskView[]>([])
/** 任务状态轮询器句柄（onBeforeUnmount 用） */
let uploadPoller: ReturnType<typeof setInterval> | null = null
/** 轮询周期：UploadQueue 无进度/状态出站口（bus.emit 仅外发宿主），状态以轮询 status() 同步 */
const UPLOAD_POLL_MS = 250

/** 终态映射：queued/uploading 视为上传中，done/failed/aborted → 面板三态 */
function pollUploadStatuses(): void {
  const queue = ws?.stores.queue
  if (!queue) return
  for (const task of uploadTasks.value) {
    if (task.status !== 'uploading') continue
    const s = queue.status(task.id)
    if (s === 'done') {
      task.status = 'done'
      task.loaded = task.total
    } else if (s === 'failed') {
      task.status = 'failed'
    } else if (s === 'aborted') {
      task.status = 'cancelled'
    }
  }
}

function stopUploadPoller(): void {
  if (uploadPoller !== null) {
    clearInterval(uploadPoller)
    uploadPoller = null
  }
}

/** 全部任务到终态后自停（无上传中任务时空转无意义） */
function ensureUploadPoller(): void {
  if (uploadPoller !== null) return
  uploadPoller = setInterval(() => {
    pollUploadStatuses()
    if (!uploadTasks.value.some((x) => x.status === 'uploading')) stopUploadPoller()
  }, UPLOAD_POLL_MS)
}

/**
 * 带任务登记的 enqueue 包装（Toolbar 上传与树拖拽共用上传口）。
 * UploadQueue 不枚举任务且 hooks 构造期只读——id↔name 映射只能在入队点登记：
 * accepted 按文件序排列，逐个剔除 rejected 命中后对齐取 id。
 */
function trackedEnqueue(files: File[], prefix?: string): EnqueueResult {
  const queue = ws?.stores.queue
  if (!queue || files.length === 0) return { accepted: [], rejected: [] }
  const result = queue.enqueue(files, prefix)
  const rejectedNames = result.rejected.map((r) => r.name)
  let ai = 0
  for (const f of files) {
    const ri = rejectedNames.indexOf(f.name)
    if (ri >= 0) {
      rejectedNames.splice(ri, 1)
      continue
    }
    const id = result.accepted[ai++]?.id
    if (id) uploadTasks.value.push({ id, name: f.name, loaded: 0, total: f.size, status: 'uploading' })
  }
  if (result.accepted.length > 0) ensureUploadPoller()
  return result
}

function onCancelUpload(id: string): void {
  if (!ws) return
  if (ws.stores.queue.abort(id)) {
    const task = uploadTasks.value.find((x) => x.id === id)
    // 直传（put）不可中断：本地先置取消态，终态 uploadFailed(≥4900) 稍后幂等覆盖
    if (task && task.status === 'uploading') task.status = 'cancelled'
  }
}

function onClearUploads(): void {
  uploadTasks.value = uploadTasks.value.filter((x) => x.status === 'uploading')
}

// ── 预览打开链（M2 + F5 @open/@open-with） ──

const previewEl = ref<HTMLElement | null>(null)
let preview: PreviewHandle | null = null
/** bus 'expired' 监听解绑（onBeforeUnmount 用） */
let offExpired: (() => void) | null = null

function onOpen(entry: S3ObjectSummary): void {
  if (preview) void preview.open(entry)
}

function onOpenWith(payload: { entry: S3ObjectSummary; appId: string }): void {
  if (preview) void preview.open(payload.entry, { appId: payload.appId })
}

/** 右键菜单动作 → workspace-ops 收口（与 Toolbar 同链）；结果维护选中集 */
async function onMenuAction(payload: {
  action: 'rename' | 'delete' | 'download' | 'mkdir'
  entry: S3ObjectSummary
}): Promise<void> {
  if (!ops) return
  if (payload.action === 'rename') {
    const r = await ops.renameEntry(payload.entry)
    if (r) onChanged(r.from)
  } else if (payload.action === 'delete') {
    const keys = await ops.removeEntries([payload.entry])
    if (keys) for (const k of keys) onChanged(k)
  } else if (payload.action === 'download') {
    void downloadEntries([payload.entry])
  } else {
    await ops.createDir()
  }
}

/** 拖拽落文件 → 带登记入队 + 拒收 toast（features.upload 门控：false 整链禁用，静默忽略） */
function onDropFiles(payload: { files: File[]; path: string }): void {
  if (!ws || !ops || payload.files.length === 0) return
  if (features.value.upload === false) return
  ops.ingestFiles(trackedEnqueue, payload.files, payload.path)
}

/**
 * 下载执行链（Lane F5 收口）：单文件 client.get → blob → triggerDownload（目录禁用）；
 * 多选（均非目录）→ 预算护栏（累计 256MB）→ 全量取流 → zip.ts store 打包 → triggerDownload。
 * Toolbar 批量下载、右键菜单下载、preview fallback/错误节点下载钮共用。
 */
async function downloadEntries(entries: S3ObjectSummary[]): Promise<void> {
  if (!ws) return
  const files = entries.filter((e) => !e.isDir)
  if (files.length === 0) return
  if (files.length === 1) {
    const entry = files[0]!
    const blob = await ws.stores.client.get(entry.key).then((res) => res.blob())
    triggerDownload(URL.createObjectURL(blob), entry.name)
    return
  }
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > ZIP_SIZE_LIMIT) {
    toast.warning(t('files.msg.zip-too-large', { limit: '256MB' }))
    return
  }
  const items: { name: string; data: Uint8Array }[] = []
  for (const f of files) {
    const buf = await ws.stores.client.get(f.key).then((res) => res.arrayBuffer())
    items.push({ name: f.name, data: new Uint8Array(buf) })
  }
  const zipped = zipStore(items)
  triggerDownload(
    URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' })),
    zipFileName(),
  )
}

function zipFileName(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `files-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`
}

onMounted(() => {
  if (!previewEl.value) return
  const bootHandle = boot && boot.ok ? boot.handle : null
  if (!bootHandle) return
  // Lane F3：会话过期联动——通知式清空预览舞台（workspace 的 SessionBanner 整屏蒙层已自带）
  offExpired = bootHandle.bus.on('expired', () => preview?.expire())
  if (ws) {
    preview = createPreview({
      container: previewEl.value,
      registry: bootHandle.registry,
      datasource: s3DataSource(ws.stores.client),
      t: (key) => t(key),
      theme: {},
      // Lane F3（审计 P0）：renderer 保存 → 树缓存最小维护（applyChange）+ bus 'fileChanged' 外发宿主。
      // 树自身动作（mkdir/rename/remove）的 fileChanged 仍走 setupStores 的 onFileChanged，两链不重复。
      notifyFileChanged: (payload) => {
        ws.stores.tree.applyChange(payload)
        bootHandle.bus.emit('fileChanged', payload)
      },
      ensureApps: bootHandle.ensureApps,
      canDownload: features.value.download !== false,
      onDownload: (entry) => void downloadEntries([entry]),
    })
    // Lane F3：ui.defaultOpen——口径：相对 backend.prefix 的路径，非绝对 bucket key
    // （JSSDK §五 payload 注记①「路径类字段=相对 backend.prefix 的对象键」；手册 §一示例
    // prefix='sessions/…/' + defaultOpen='reports/summary.md'），'/' 即 prefix 根。
    // 挂载后构造伪条目直接走预览打开链（不经树选中）；配置为空/纯 '/' 则跳过。
    if (bootHandle.config.mode === 'workspace') {
      const rel = (bootHandle.config.ui?.defaultOpen ?? '').replace(/^\/+/, '')
      if (rel && preview) {
        const key = `${normalizePrefix(ws.rootPrefix)}${rel}`
        void preview.open({ key, name: rel.slice(rel.lastIndexOf('/') + 1) || rel, size: 0, isDir: false })
      }
    }
    return
  }
  if (fileConfig) {
    // F2 单文件模式：UrlSourceProvider→urlDataSource→复用 createPreview；
    // 伪条目只有 name 有语义（urlDataSource 忽略 key），registry 按扩展名解析默认应用；
    // 可编辑性由 config.save 决定（UrlSourceProvider.put 无 save 段即 4305，编辑链自然被拒）。
    const provider = new UrlSourceProvider({ source: fileConfig.source, save: fileConfig.save })
    preview = createPreview({
      container: previewEl.value,
      registry: bootHandle.registry,
      datasource: urlDataSource(provider),
      t: (key) => t(key),
      theme: {},
      // Lane F3（JSSDK §四）：file 模式 save 回写成功 → fileChanged(put) 外发宿主（无树可维护）。
      notifyFileChanged: (payload) => {
        bootHandle.bus.emit('fileChanged', payload)
      },
      ensureApps: bootHandle.ensureApps,
      canDownload: features.value.download !== false,
    })
    void preview.open({ key: fileName, name: fileName, size: 0, isDir: false })
  }
})
onBeforeUnmount(() => {
  offExpired?.()
  offExpired = null
  stopUploadPoller()
  if (tickTimer !== null) clearInterval(tickTimer)
  preview?.clear()
})

// 换目录后选中项不在视野内：清选（防"看不见的删除"）
watch(
  () => ws?.stores.tree.currentPath,
  () => {
    selected.value = []
  },
)

/** 会话剩余（复审 #10：静态快照 → 1s 心跳实时倒计时；格式化纯函数见 session-format.ts） */
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
})

const remainingMs = computed<number | null>(() => {
  if (!boot || !boot.ok) return null
  void nowTick.value // 建立心跳依赖：每秒重算
  const ms = boot.handle.session.remainingMs()
  return Number.isFinite(ms) ? Math.max(0, ms) : null
})
const sessionInfo = computed(() => {
  const ms = remainingMs.value
  return ms === null ? null : formatRemaining(ms)
})
/** T-5min 预览区顶部提示（手册「编辑器顶部提示」条目；与 SessionBanner 面板横幅并存=手册的两处提示口径） */
const showExpireHint = computed(() => remainingMs.value !== null && remainingMs.value <= EXPIRE_WARN_BEFORE_MS)

function toggleLocale() {
  preference.setLocale(preference.locale === 'zh-CN' ? 'en-US' : 'zh-CN')
}
</script>

<template>
  <div class="home-page" :class="{ 'is-workspace': ws }">
    <!-- ① boot 失败：配置错误卡（保留 M0） -->
    <FcSectionCard v-if="boot && !boot.ok" class="home-hero" padding="lg">
      <h1 class="home-hero__title">{{ t('boot.config-error') }}</h1>
      <p class="home-hero__subtitle">code={{ boot.error.code }} · {{ boot.error.message }}</p>
    </FcSectionCard>

    <!-- ② workspace：会话横幅 + 操作条 + 左树右预览（M2 换多 tab）+ 上传任务面板（F5） -->
    <div v-else-if="ws" class="ws">
      <header class="ws__header">
        <h1 class="ws__title">{{ t('home.title') }}</h1>
        <FcTag>{{ ws.mode }}</FcTag>
        <FcTag v-if="sessionInfo">{{ t('boot.session-remaining') }}: {{ sessionInfo }}</FcTag>
        <span class="ws__spacer" />
        <FcButton variant="text" size="sm" @click="toggleLocale">{{ t('home.toggle-locale') }}</FcButton>
      </header>
      <SessionBanner :session="ws.session" />
      <Toolbar
        :controller="ws.stores.tree"
        :queue="{ enqueue: trackedEnqueue }"
        :selected="selected"
        :features="features"
        @changed="onChanged"
        @download="downloadEntries"
      />
      <!-- 复审 #10：T-5min 顶部细条提示（SessionBanner 面板横幅之外的第二处提示位，手册口径） -->
      <div v-if="showExpireHint" class="ws__expire-hint" data-testid="session-top-warn">
        {{ t('files.session.warn') }}
      </div>
      <div class="ws__body">
        <TreePanel
          class="ws__tree"
          :controller="ws.stores.tree"
          :root-prefix="ws.rootPrefix"
          :selected="selected"
          :features="features"
          :registry="registry"
          @select="onSelect"
          @open="onOpen"
          @open-with="onOpenWith"
          @menu-action="onMenuAction"
          @drop-files="onDropFiles"
        />
        <FcSectionCard class="ws__preview" padding="lg">
          <div ref="previewEl" class="ws__preview-host" />
        </FcSectionCard>
      </div>
      <UploadPanel :tasks="uploadTasks" @cancel="onCancelUpload" @clear="onClearUploads" />
    </div>

    <!-- ③ file：单文件预览（F2：registry 按 name 解析默认应用渲染；头部分名+只读/可编辑标记） -->
    <FcSectionCard v-else-if="fileConfig" class="file-view" padding="lg">
      <header class="file-view__head">
        <h1 class="home-hero__title home-hero__title--file">{{ fileName }}</h1>
        <FcTag>{{ fileConfig.save ? t('files.placeholder.editable') : t('files.placeholder.readonly') }}</FcTag>
      </header>
      <div ref="previewEl" class="ws__preview-host" />
    </FcSectionCard>

    <!-- ④ 兜底：BOOT 未注入（异常装配）保留 M0 hero -->
    <FcSectionCard v-else class="home-hero" padding="lg">
      <h1 class="home-hero__title">{{ t('home.title') }}</h1>
      <p class="home-hero__subtitle">{{ t('home.subtitle') }}</p>
      <FcButton variant="secondary" @click="toggleLocale">{{ t('home.toggle-locale') }}</FcButton>
    </FcSectionCard>
  </div>
</template>

<style lang="scss" scoped>
.home-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;

  &.is-workspace {
    align-items: stretch;
    justify-content: stretch;
    min-height: 0;
  }
}

.home-hero {
  max-width: 560px;
  text-align: center;
}

.home-hero__title {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 700;
  color: var(--app-text-primary);
  word-break: break-all;

  &--file {
    font-size: 22px;
  }
}

.home-hero__subtitle {
  margin: 0 0 20px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--app-text-secondary);
}

.home-hero__session {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin: 0 0 20px;
}

.ws {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.ws__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ws__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--app-text-primary);
}

.ws__spacer {
  flex: 1;
}

.ws__expire-hint {
  padding: 6px 12px;
  border: 1px solid var(--el-color-warning-light-5, #f3d19e);
  border-radius: var(--app-radius-md, 8px);
  background: var(--el-color-warning-light-9, #fdf6ec);
  color: var(--el-color-warning-dark-2, #b88230);
  font-size: 13px;
}

.ws__body {
  display: grid;
  grid-template-columns: minmax(300px, 420px) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  min-height: 0;
}

.ws__tree {
  max-height: 68vh;
  padding: 8px;
  background: var(--app-section-bg);
  border: 1px solid var(--app-section-border-color);
  border-radius: var(--app-section-radius);
}

/* 块级布局：flex 居中会把 .fc-section__body 压到 min-content 宽（Monaco 曾塌陷 5×5 的宽度向根因） */
.ws__preview {
  min-height: 320px;
}

/* F5（优化建议 C1）：预览舞台恒定尺寸——不再随内容/父级 flex 塌陷（曾致 Monaco 5×5px 不可视）。
   min-height 链：stage（渲染器容器）至少撑满舞台，保证 Monaco create 时测量到非零高度。 */
.ws__preview-host {
  position: relative;
  width: 100%;
  height: min(68vh, 720px);
  min-height: 320px;
  overflow: auto;

  :deep(.mmf-preview-stage) {
    min-height: 100%;
  }
}

.file-view {
  width: min(960px, 100%);
}

.file-view__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

@media (max-width: 720px) {
  .ws__body {
    grid-template-columns: 1fr;
  }
}
</style>
