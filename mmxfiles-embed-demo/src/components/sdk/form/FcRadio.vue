<script setup lang="ts">
defineOptions({ name: 'FcRadio' })
/**
 * FcRadio — 圆点单选项 (SDK). 等价 el-radio.
 *
 * 必须放在 FcRadioGroup 内 (通过 inject 拿分组状态).
 * label 走 default slot.
 *
 * 用法:
 *   <FcRadioGroup v-model="v">
 *     <FcRadio value="a">选项A</FcRadio>
 *     <FcRadio value="b" disabled>选项B</FcRadio>
 *   </FcRadioGroup>
 */
import { computed, inject } from 'vue'
import { FC_RADIO_GROUP_KEY, type RadioValue } from './radioContext'

export interface FcRadioProps {
  value: RadioValue
  disabled?: boolean
}

const props = withDefaults(defineProps<FcRadioProps>(), { disabled: false })

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
  <label
    class="fc-radio"
    :class="[`size-${size}`, { 'is-checked': checked, 'is-disabled': isDisabled }]"
  >
    <span
      class="fc-radio__input"
      role="radio"
      :aria-checked="checked"
      tabindex="0"
      @click="onClick"
      @keydown.enter.prevent="onClick"
      @keydown.space.prevent="onClick"
    >
      <span class="fc-radio__dot" />
    </span>
    <span class="fc-radio__label"><slot /></span>
  </label>
</template>

<style scoped lang="scss">
.fc-radio {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 14px;
  color: var(--app-text-primary, #303133);

  &.size-small { font-size: 12px; }
  &.size-large { font-size: 16px; }

  &.is-disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.fc-radio__input {
  --fc-radio-size: 16px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--fc-radio-size);
  height: var(--fc-radio-size);
  border: 1px solid var(--app-separator, #dcdfe6);
  border-radius: 50%;
  background: var(--app-bg-card, #fff);
  transition: border-color 0.2s, background 0.2s;
  outline: none;

  &:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-primary, #409eff) 30%, transparent);
  }
}

.fc-radio.size-small .fc-radio__input { --fc-radio-size: 14px; }
.fc-radio.size-large .fc-radio__input { --fc-radio-size: 18px; }

.fc-radio__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  transform: scale(0);
  transition: transform 0.2s;
}

.fc-radio.is-checked .fc-radio__input {
  border-color: var(--app-primary, #409eff);
  background: var(--app-primary, #409eff);
}

.fc-radio.is-checked .fc-radio__dot {
  transform: scale(1);
}

.fc-radio.is-checked .fc-radio__label {
  color: var(--app-primary, #409eff);
}
</style>
