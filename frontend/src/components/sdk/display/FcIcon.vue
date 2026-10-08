<script setup lang="ts">
defineOptions({ name: 'FcIcon', inheritAttrs: false })
/**
 * FcIcon — 统一图标壳 (SDK). 替代 el-icon.
 *
 * 支持两种来源:
 *   A. remix-icon class:  <FcIcon name="ri-search-line" />
 *   B. slot 包 SVG 组件 (兼容旧 el-icon 用法):
 *      <FcIcon :size="20"><Plus /></FcIcon>
 *
 * size 统一控制字号 (em 缩放 SVG), color 走 currentColor.
 *
 * 用法:
 *   <FcIcon name="ri-add-line" :size="18" />
 *   <FcIcon :size="32" color="var(--app-primary)"><MagicStick /></FcIcon>
 */
import { computed } from 'vue'

export interface FcIconProps {
  /** remix-icon class 名 (如 'ri-search-line'). 不传则用 default slot. */
  name?: string
  /** 图标尺寸 (number=px, string=CSS). 默认继承字号. */
  size?: number | string
  /** 颜色. 默认 currentColor. */
  color?: string
  /** 是否旋转 (loading 场景). */
  spin?: boolean
}

const props = defineProps<FcIconProps>()

const sizeValue = computed(() =>
  props.size == null ? undefined : typeof props.size === 'number' ? `${props.size}px` : props.size,
)
</script>

<template>
  <i
    v-if="name"
    :class="[name, { 'fc-icon--spin': spin }]"
    class="fc-icon"
    :style="{ fontSize: sizeValue, color }"
    v-bind="$attrs"
  />
  <span
    v-else
    class="fc-icon fc-icon--svg"
    :class="{ 'fc-icon--spin': spin }"
    :style="{ fontSize: sizeValue, color }"
    v-bind="$attrs"
  >
    <slot />
  </span>
</template>

<style scoped lang="scss">
.fc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  vertical-align: middle;
}

.fc-icon--svg :deep(svg) {
  width: 1em;
  height: 1em;
}

.fc-icon--spin {
  animation: fc-icon-spin 1s linear infinite;
}

@keyframes fc-icon-spin {
  to { transform: rotate(360deg); }
}
</style>
