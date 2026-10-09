<script setup lang="ts">
defineOptions({ name: 'ShareDialog' })
/**
 * ShareDialog — 预签名分享链接生成器（Lane H-2）。
 *
 * 数据流：client 可选能力 getPresignedUrl / presignPutUrl（SigV4 查询串预签名，
 * 纯本地签名零网络）；缺任一能力 → 禁用态（有效期与生成钮不可用，仅标题+条目可见）。
 *
 * 交互口径：
 *  - 有效期三档 1h / 24h（=1d）/ 7d（AWS 预签名硬上限恰为 7 天，顶格）；
 *  - 生成 → GET/PUT 两行只读输入 + 复制钮（clipboard.writeText 优先，失败降级
 *    document.execCommand('copy')——该 API 已废弃，仅作非安全上下文/旧内核兜底）；
 *  - 目录条目不给分享（前缀分享列 P2）→ 禁用态；
 *  - 换有效期/换条目 → 清空已生成链接（防误分享旧口径链接）。
 *
 * UI 口径：v-model:open 与 SearchDialog 同款——open prop 必须显式缺省 true
 * （Boolean 型 prop 缺省会被 Vue 铸成 false，「缺省即开」不成立）。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FcButton, FcDialog, toast } from '@/components/sdk'
import type { S3Client, S3ObjectSummary } from '@/sdk/types'

const props = withDefaults(
  defineProps<{
    client: S3Client
    /** 分享目标（null=无目标：空壳禁用态，仅标题可见） */
    entry?: S3ObjectSummary | null
    /** 弹窗显隐（v-model:open）；显式缺省 true（Boolean 缺省坑，见文件头注） */
    open?: boolean
  }>(),
  { entry: null, open: true },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const { t } = useI18n()

// ── 能力/条目门控 ──

const hasPresign = computed(
  () => typeof props.client.getPresignedUrl === 'function' && typeof props.client.presignPutUrl === 'function',
)
/** 可分享 = 客户端有双预签名能力 + 目标为文件（目录→前缀分享列 P2，简化不给分享） */
const canShare = computed(() => hasPresign.value && props.entry !== null && !props.entry.isDir)

// ── 有效期 ──

interface ExpiryOption {
  sec: number
  label: string
}
const EXPIRY_OPTIONS: ExpiryOption[] = [
  { sec: 3600, label: t('share.expiry-h', { n: 1 }) },
  { sec: 86_400, label: t('share.expiry-d', { n: 1 }) },
  { sec: 604_800, label: t('share.expiry-d', { n: 7 }) },
]
const expirySec = ref(EXPIRY_OPTIONS[0]!.sec)

// ── 生成 ──

const getUrl = ref('')
const putUrl = ref('')

function generate(): void {
  const entry = props.entry
  if (!canShare.value || !entry) return
  // 查询串 SigV4 纯本地签名（零网络）；有效期上限钳制在 client 侧（对齐会话 TTL 语义）
  getUrl.value = props.client.getPresignedUrl!(entry.key, expirySec.value)
  putUrl.value = props.client.presignPutUrl!(entry.key, expirySec.value)
}

/** 换有效期 → 已生成链接口径已变，清空防误分享 */
watch(expirySec, () => {
  getUrl.value = ''
  putUrl.value = ''
})
/** 换条目 → 清空（防上个文件的链接串显） */
watch(
  () => props.entry?.key,
  () => {
    getUrl.value = ''
    putUrl.value = ''
  },
)

// ── 复制（clipboard API 优先，失败/缺失降级 execCommand） ──

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限拒绝 / 非安全上下文异常 → 走降级
  }
  // 降级：document.execCommand('copy') 已废弃，但在无 Clipboard API 的环境仍是唯一可用面
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

async function onCopy(text: string): Promise<void> {
  if (await copyText(text)) toast.success(t('share.copied'))
  // 复制失败（无剪贴板能力且降级失败）静默：词典无失败文案键，不生造
}

function onVisibleChange(visible: boolean): void {
  emit('update:open', visible)
}
</script>

<template>
  <FcDialog
    dialog-class="share-dialog"
    :open="open"
    :title="t('share.title')"
    :width="640"
    @update:open="onVisibleChange"
  >
    <div v-if="entry" class="share-dialog__body" data-testid="share-dialog">
      <p class="share-dialog__entry">
        <i :class="entry.isDir ? 'ri-folder-line' : 'ri-file-line'" class="share-dialog__entry-icon" />
        <span class="share-dialog__entry-name" :title="entry.key">{{ entry.name }}</span>
      </p>

      <div class="share-dialog__expiry">
        <span class="share-dialog__label">{{ t('share.expiry') }}</span>
        <label v-for="opt in EXPIRY_OPTIONS" :key="opt.sec" class="share-dialog__opt">
          <input
            v-model="expirySec"
            type="radio"
            name="share-expiry"
            :value="opt.sec"
            :disabled="!canShare"
          >
          {{ opt.label }}
        </label>
      </div>

      <div class="share-dialog__actions">
        <FcButton
          variant="primary"
          size="sm"
          :disabled="!canShare"
          data-testid="share-generate"
          @click="generate"
        >
          {{ t('share.generate') }}
        </FcButton>
      </div>

      <div v-if="getUrl" class="share-dialog__row">
        <span class="share-dialog__label share-dialog__label--url">{{ t('share.get-url') }}</span>
        <input
          class="share-dialog__url"
          type="text"
          readonly
          :value="getUrl"
          data-testid="share-get-url"
        >
        <FcButton variant="secondary" size="sm" data-testid="share-copy-get" @click="onCopy(getUrl)">
          {{ t('share.copy') }}
        </FcButton>
      </div>
      <div v-if="putUrl" class="share-dialog__row">
        <span class="share-dialog__label share-dialog__label--url">{{ t('share.put-url') }}</span>
        <input
          class="share-dialog__url"
          type="text"
          readonly
          :value="putUrl"
          data-testid="share-put-url"
        >
        <FcButton variant="secondary" size="sm" data-testid="share-copy-put" @click="onCopy(putUrl)">
          {{ t('share.copy') }}
        </FcButton>
      </div>
    </div>
  </FcDialog>
</template>

<style lang="scss" scoped>
/* el-dialog teleport 到 body 后 scoped 对弹窗外壳失效，但默认槽内容在本组件作用域编译，样式可用 */
.share-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--app-text-secondary);
}

.share-dialog__entry {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: var(--app-text-primary);
}

.share-dialog__entry-icon {
  font-size: 16px;
  color: var(--app-text-tertiary);
}

.share-dialog__entry-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}

.share-dialog__label {
  font-size: 12px;
  color: var(--app-text-tertiary);
  white-space: nowrap;
}

.share-dialog__expiry {
  display: flex;
  align-items: center;
  gap: 12px;
}

.share-dialog__opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;

  input:disabled {
    cursor: not-allowed;
  }
}

.share-dialog__actions {
  display: flex;
}

.share-dialog__row {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.share-dialog__url {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--app-section-border-color, var(--el-border-color));
  border-radius: var(--app-radius-sm, 6px);
  background: var(--app-bg-muted, rgba(0, 0, 0, 0.02));
  color: var(--app-text-secondary);
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  &:focus {
    outline: none;
    border-color: var(--el-color-primary);
  }
}
</style>
