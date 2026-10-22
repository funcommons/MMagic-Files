<script setup lang="ts">
defineOptions({ name: 'FcFormDraftBanner' })
/**
 * FcFormDraftBanner — 草稿恢复提示条 (#10 草稿自动恢复).
 *
 * 配合 useFormDraft 用:
 *   const draft = useFormDraft(form, 'benefit-items:create')
 *   <FcFormDraftBanner :visible="draft.hasDraft" @restore="draft.restore(); draft.discard()" @discard="draft.discard()" />
 *
 * 默认走 sticky 顶部黄条 (z-index 高于内容), 用户点 Restore 把 form 写到草稿状态;
 * 点 Discard 删掉草稿.
 */

import { useI18n } from 'vue-i18n'

interface Props {
  visible: boolean
}
defineProps<Props>()

const emit = defineEmits<{
  restore: []
  discard: []
}>()

const { t } = useI18n()
</script>

<template>
  <transition name="fc-draft-banner">
    <div v-if="visible" class="fc-draft-banner" role="alert">
      <div class="fc-draft-banner__content">
        <i class="ri-file-history-line fc-draft-banner__icon" />
        <span class="fc-draft-banner__text">{{ t('ux.draft.banner-restore') }}</span>
      </div>
      <div class="fc-draft-banner__actions">
        <button type="button" class="fc-draft-banner__btn fc-draft-banner__btn--ghost" @click="emit('discard')">
          {{ t('ux.draft.banner-discard') }}
        </button>
        <button type="button" class="fc-draft-banner__btn fc-draft-banner__btn--primary" @click="emit('restore')">
          {{ t('ux.draft.banner-restore-btn') }}
        </button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fc-draft-banner {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  margin-bottom: 12px;
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid var(--el-color-warning-light-5, #faecd8);
  border-radius: var(--app-radius-md, 8px);
  color: var(--el-text-color-primary, #303133);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}
.fc-draft-banner__content {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.fc-draft-banner__icon {
  font-size: 18px;
  color: var(--el-color-warning, #e6a23c);
  flex-shrink: 0;
}
.fc-draft-banner__text {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fc-draft-banner__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.fc-draft-banner__btn {
  appearance: none;
  border: none;
  padding: 4px 12px;
  border-radius: var(--app-radius-sm, 4px);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.fc-draft-banner__btn--ghost {
  background: transparent;
  color: var(--app-text-secondary);
}
.fc-draft-banner__btn--ghost:hover {
  background: rgba(0, 0, 0, 0.04);
}
.fc-draft-banner__btn--primary {
  background: var(--el-color-warning, #e6a23c);
  color: #fff;
}
.fc-draft-banner__btn--primary:hover {
  opacity: 0.9;
}
.fc-draft-banner-enter-active,
.fc-draft-banner-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fc-draft-banner-enter-from,
.fc-draft-banner-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>