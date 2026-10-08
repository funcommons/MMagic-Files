<script setup lang="ts">
defineOptions({ name: 'FcRadioButton' })
/**
 * FcRadioButton — 分段按钮单选项 (SDK). 等价 el-radio-button.
 *
 * 必须放在 FcRadioGroup 内. 相邻按钮共用边框, 选中项高亮.
 *
 * 用法:
 *   <FcRadioGroup v-model="range" variant="button">
 *     <FcRadioButton value="7d">7天</FcRadioButton>
 *     <FcRadioButton value="30d">30天</FcRadioButton>
 *   </FcRadioGroup>
 */
import { computed, inject } from 'vue'
import { FC_RADIO_GROUP_KEY, type RadioValue } from './radioContext'

export interface FcRadioButtonProps {
  value: RadioValue
  disabled?: boolean
}

const props = withDefaults(defineProps<FcRadioButtonProps>(), { disabled: false })

const group = inject(FC_RADIO_GROUP_KEY, null)

const checked = computed(() => group?.value.value === props.value)
const isDisabled = computed(() => props.disabled || !!group?.disabled.value)
const size = computed(() => group?.size.value ?? 'default')

function onClick() {
  if (isDisabled.value) return
  group?.pick(props.value)
}
</script>

<template>
  <button
    type="button"
    role="radio"
    :aria-checked="checked"
    :disabled="isDisabled"
    class="fc-radio-button"
    :class="[`size-${size}`, { 'is-checked': checked, 'is-disabled': isDisabled }]"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
.fc-radio-button {
  appearance: none;
  border: none;
  border-left: 1px solid var(--app-separator, #dcdfe6);
  background: var(--app-bg-card, #fff);
  color: var(--app-text-primary, #303133);
  padding: 8px 15px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  outline: none;

  &:first-child { border-left: none; }

  &.size-small { padding: 5px 11px; font-size: 12px; }
  &.size-large { padding: 11px 19px; font-size: 16px; }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--app-primary, #409eff) 30%, transparent);
  }

  &.is-checked {
    background: var(--app-primary, #409eff);
    color: var(--app-on-primary, #fff);
    border-left-color: var(--app-primary, #409eff);
  }

  &.is-disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}
</style>
