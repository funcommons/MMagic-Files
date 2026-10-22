<script setup lang="ts">
// 协议日志面板（EmbedPlay / FilePlay 共用；形态 copy 自 opencut-embed-demo 日志区）
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { LogEntry } from "@/composables/useMmxFilesClient";

const props = defineProps<{ logs: LogEntry[]; title?: string }>();

const { t } = useI18n();
const titleText = computed(() => props.title ?? t("demo.log.title"));
</script>

<template>
  <div class="log-panel">
    <h3 class="section-title">{{ titleText }}</h3>
    <div class="logs">
      <div v-if="logs.length === 0" class="empty">{{ t("demo.log.empty") }}</div>
      <div
        v-for="(entry, i) in logs"
        :key="i"
        class="log-line"
        :class="{ bad: !entry.ok }"
      >
        <span class="time">{{ entry.time }}</span>
        {{ entry.text }}
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.log-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.logs {
  flex: 1;
  min-height: 96px;
  max-height: 220px;
  overflow: auto;
  background: var(--app-bg-muted);
  border: 1px solid var(--app-separator);
  border-radius: var(--app-radius-button);
  padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.6;

  .empty {
    color: var(--app-text-tertiary);
  }
  .log-line {
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--app-text-secondary);
    .time {
      color: var(--app-text-tertiary);
      margin-right: 6px;
    }
    &.bad {
      color: var(--el-color-danger);
    }
  }
}
</style>
