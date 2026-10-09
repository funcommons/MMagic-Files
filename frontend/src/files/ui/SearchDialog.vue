<script setup lang="ts">
defineOptions({ name: 'SearchDialog' })
/**
 * SearchDialog — 全局搜索弹窗（P0 Lane G2 组件级交付；Toolbar/Home 集成由主线收口）。
 *
 * 数据流：SearchIndex（../search-index）持有元数据索引；store 缺省 IndexedDB
 * （无 idb 环境自动降级内存），storeFactory 可注入（测试/宿主定制）。
 *
 * 交互：
 *  - 搜索框实时过滤（含匹配；支持 * ? 通配）+ 大小区间/类型下拉，条件变化即重查；
 *  - 扫描钮：scan(rootPrefix, client) 平铺聚合入库，进行中禁用重复触发并显示进度条数；
 *    完成 toast（search.scan-done 带 n）、失败 toast（错误消息原文，词典无失败键）；
 *  - 结果行（上限 200，索引侧已截断，虚拟滚动不强制）：名/大小/修改时间/路径；
 *    打开=emit('open',{key})（Home 接 preview.open）、定位目录=emit('locate',{key})；
 *    双击行=打开（对齐 TreePanel「双击打开」口径）；
 *  - 空态 FcEmpty（search.empty）；索引提示 search.index-hint + 已索引条数。
 *
 * UI 口径：列表行布局/字号沿 TreePanel（克制的自绘行，不上 el-table——200 行封顶无需虚拟化）；
 * 大小/类型过滤用原生控件（下拉/数字输入），避免 el-select popper 在测试环境的 teleport 复杂度。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton, FcDialog, FcEmpty, toast } from '@/components/sdk'
import { SearchIndex, createIdbMetaStore } from '../search-index'
import type { MetaRow, MetaStore, SearchType } from '../search-index'
import { normalizePrefix } from '../tree-store'
import type { S3Client } from '@/sdk/types'

const props = withDefaults(
  defineProps<{
    client: S3Client
    /** 扫描根域（scan 起点；结果路径列相对它显示） */
    rootPrefix: string
    /** 可注入 store 工厂（测试用）；缺省 IndexedDB（无 idb 环境自动降级内存） */
    storeFactory?: () => MetaStore
    /** 弹窗显隐（v-model:open）；缺省 true——父层可 v-if 挂载，关闭经 update:open 收口。
     * 注意必须显式 default true：Boolean 型 prop 缺省会被 Vue 铸成 false，`open !== false`
     * 的"缺省即开"写法在类型声明下不成立。 */
    open?: boolean
  }>(),
  { storeFactory: undefined, open: true },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  /** 打开文件（Home 接 preview.open） */
  open: [payload: { key: string }]
  /** 定位所在目录（Home 接 loadDir(parentPrefix(key))） */
  locate: [payload: { key: string }]
}>()

const { t } = useI18n()

const index = new SearchIndex(props.storeFactory ? props.storeFactory() : createIdbMetaStore())

// ── 查询条件 ──

const query = ref('')
// v-model 对 input[type=number] 会把值铸成 number（Vue vModelText 的 looseToNumber），故收 string | number
const sizeMinRaw = ref<string | number>('')
const sizeMaxRaw = ref<string | number>('')
const typeSel = ref<SearchType | ''>('')
const TYPES: SearchType[] = ['image', 'video', 'audio', 'doc', 'other']

function parseSize(raw: string | number): number | undefined {
  const trimmed = String(raw).trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const sizeMin = computed(() => parseSize(sizeMinRaw.value))
const sizeMax = computed(() => parseSize(sizeMaxRaw.value))

// ── 结果态 ──

const rows = ref<MetaRow[]>([])
const searched = ref(false)
const indexedCount = ref(0)
let searchSeq = 0

async function runSearch(): Promise<void> {
  const seq = ++searchSeq
  const hits = await index.search({
    glob: query.value,
    sizeMin: sizeMin.value,
    sizeMax: sizeMax.value,
    type: typeSel.value === '' ? undefined : typeSel.value,
  })
  if (seq !== searchSeq) return // 过期响应丢弃（快速改条件时防旧结果回写）
  rows.value = hits
  searched.value = true
}

watch([query, sizeMin, sizeMax, typeSel], () => {
  void runSearch()
})

onMounted(async () => {
  const s = await index.stats()
  indexedCount.value = s.count
  if (s.count > 0) await runSearch() // 已有索引：挂载即出最近结果
})

// ── 扫描 ──

const scanning = ref(false)
const progress = ref(0)

async function startScan(): Promise<void> {
  if (scanning.value) return // 双保险：按钮 disabled 之外的重复触发兜底
  scanning.value = true
  progress.value = 0
  try {
    const r = await index.scan(props.rootPrefix, props.client, {
      onProgress: (n) => { progress.value = n },
    })
    indexedCount.value = r.count
    toast.success(t('search.scan-done', { n: r.count }))
    await runSearch()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    scanning.value = false
  }
}

// ── 展示辅助 ──

/** 与 TreePanel 同口径的人读字节 */
const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB']
function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  let v = size
  let i = -1
  do {
    v /= 1024
    i += 1
  } while (v >= 1024 && i < SIZE_UNITS.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${SIZE_UNITS[i] ?? 'KB'}`
}

function formatTime(lastModified?: number): string {
  return lastModified === undefined ? '—' : new Date(lastModified).toLocaleString()
}

const rootPrefix = computed(() => normalizePrefix(props.rootPrefix))

/** 路径列：相对扫描根域的目录部分（根级显示 —）；title 带完整 key */
function relDir(key: string): string {
  const rel = key.startsWith(rootPrefix.value) ? key.slice(rootPrefix.value.length) : key
  const i = rel.lastIndexOf('/')
  return i <= 0 ? '—' : rel.slice(0, i + 1)
}

function onVisibleChange(visible: boolean): void {
  emit('update:open', visible)
}
</script>

<template>
  <FcDialog
    dialog-class="search-dialog"
    :open="open"
    :title="t('search.title')"
    :width="760"
    @update:open="onVisibleChange"
  >
    <div class="search-dialog__bar">
      <el-input
        v-model="query"
        class="fc-input search-dialog__query"
        :placeholder="t('search.placeholder')"
        clearable
        data-testid="query"
      />
      <FcButton
        variant="secondary"
        size="sm"
        :disabled="scanning"
        data-testid="scan"
        @click="startScan"
      >
        {{ scanning ? t('search.scanning') : t('search.scan') }}
      </FcButton>
      <span
        v-if="scanning"
        class="search-dialog__progress"
        data-testid="scan-progress"
      >{{ progress }}</span>
    </div>

    <div class="search-dialog__filters">
      <input
        v-model="sizeMinRaw"
        class="search-dialog__num"
        type="number"
        min="0"
        :placeholder="t('search.size-min')"
        :aria-label="t('search.size-min')"
        data-testid="size-min"
      />
      <input
        v-model="sizeMaxRaw"
        class="search-dialog__num"
        type="number"
        min="0"
        :placeholder="t('search.size-max')"
        :aria-label="t('search.size-max')"
        data-testid="size-max"
      />
      <select
        v-model="typeSel"
        class="search-dialog__type"
        :aria-label="t('search.type')"
        data-testid="type"
      >
        <option value="">—</option>
        <option v-for="tp in TYPES" :key="tp" :value="tp">{{ tp }}</option>
      </select>
    </div>

    <p class="search-dialog__hint">
      <span data-testid="index-hint">{{ t('search.index-hint') }}</span>
      <span v-if="indexedCount > 0" class="search-dialog__count" data-testid="index-count">{{ indexedCount }}</span>
    </p>

    <FcEmpty
      v-if="searched && rows.length === 0"
      data-testid="empty"
      type="empty"
      :title="t('search.empty')"
    />
    <ul v-else-if="rows.length > 0" class="search-dialog__list" data-testid="result-list">
      <li
        v-for="r in rows"
        :key="r.key"
        class="search-dialog__row"
        data-testid="result-row"
        @dblclick="emit('open', { key: r.key })"
      >
        <i class="ri-file-line search-dialog__icon" />
        <span class="search-dialog__name" :title="r.key">{{ r.name }}</span>
        <span class="search-dialog__size">{{ formatSize(r.size) }}</span>
        <span class="search-dialog__time">{{ formatTime(r.lastModified) }}</span>
        <span class="search-dialog__path" :title="r.key">{{ relDir(r.key) }}</span>
        <span class="search-dialog__actions">
          <FcButton variant="text" size="sm" data-testid="row-open" @click="emit('open', { key: r.key })">
            {{ t('search.open') }}
          </FcButton>
          <FcButton variant="text" size="sm" data-testid="row-locate" @click="emit('locate', { key: r.key })">
            {{ t('search.locate') }}
          </FcButton>
        </span>
      </li>
    </ul>
  </FcDialog>
</template>

<style lang="scss" scoped>
.search-dialog__bar {
  display: flex;
  align-items: center;
  gap: 8px;

  .search-dialog__query {
    flex: 1;
  }
}

.search-dialog__progress {
  min-width: 3em;
  font-size: 12px;
  color: var(--app-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.search-dialog__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.search-dialog__num {
  width: 120px;
  padding: 4px 8px;
  border: 1px solid var(--app-section-border-color, var(--el-border-color));
  border-radius: var(--app-radius-sm, 6px);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
}

.search-dialog__type {
  padding: 4px 8px;
  border: 1px solid var(--app-section-border-color, var(--el-border-color));
  border-radius: var(--app-radius-sm, 6px);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
}

.search-dialog__hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 4px;
  font-size: 12px;
  color: var(--app-text-tertiary);
}

.search-dialog__count {
  font-variant-numeric: tabular-nums;
}

.search-dialog__list {
  flex: 1;
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow: auto;
  max-height: 50vh;
}

.search-dialog__row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 72px 150px minmax(0, 110px) auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--app-radius-md, 8px);
  font-size: 13px;
  cursor: default;

  &:hover {
    background: var(--brand-bg-hover, var(--app-bg-muted, rgba(0, 0, 0, 0.04)));
  }
}

.search-dialog__icon {
  font-size: 16px;
  color: var(--app-text-tertiary);
}

.search-dialog__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--app-text-primary);
}

.search-dialog__size,
.search-dialog__time {
  font-size: 12px;
  color: var(--app-text-tertiary);
  text-align: right;
  white-space: nowrap;
}

.search-dialog__path {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--app-text-tertiary);
  direction: rtl; // 长路径左侧截断，保住末段目录可见
  text-align: left;
}

.search-dialog__actions {
  display: flex;
  gap: 2px;
  white-space: nowrap;
}
</style>
