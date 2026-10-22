<script setup lang="ts">
defineOptions({ name: 'FcRadioGroup' })
/**
 * FcRadioGroup — 原生 radio 分组容器 (SDK).
 *
 * 自实现 (不封 el-radio-group), 通过 provide 把 value/size/disabled/pick
 * 注入给子 FcRadio / FcRadioButton, 颜色走品牌 token.
 *
 * 两种子组件:
 *   FcRadio        — 圆点样式 (等价 el-radio)
 *   FcRadioButton  — 分段按钮样式 (等价 el-radio-button)
 *
 * 用法 A (声明式 options):
 *   <FcRadioGroup v-model="v" :options="[{label:'A',value:'a'}]" />
 *   <FcRadioGroup v-model="v" :options="opts" variant="button" />
 *
 * 用法 B (slot 拼子组件):
 *   <FcRadioGroup v-model="v">
 *     <FcRadio value="a">选项A</FcRadio>
 *     <FcRadio value="b">选项B</FcRadio>
 *   </FcRadioGroup>
 */
import { computed, provide } from 'vue'
import { FC_RADIO_GROUP_KEY } from './radioContext'
import type { SelectOption } from './_types'
import FcRadio from './FcRadio.vue'
import FcRadioButton from './FcRadioButton.vue'

type RadioValue = string | number | boolean

export interface FcRadioGroupProps {
  modelValue: RadioValue | undefined
  /** 声明式选项 (不传则用 default slot 拼 FcRadio/FcRadioButton). */
  options?: SelectOption<RadioValue>[]
  /** 声明式渲染样式. 'radio'=圆点, 'button'=分段按钮. 默认 'radio'. */
  variant?: 'radio' | 'button'
  disabled?: boolean
  size?: 'small' | 'default' | 'large'
}

const props = withDefaults(defineProps<FcRadioGroupProps>(), {
  variant: 'radio',
  disabled: false,
  size: 'default',
})

const emit = defineEmits<{
  'update:modelValue': [value: RadioValue]
  change: [value: RadioValue]
}>()

function pick(value: RadioValue) {
  if (props.disabled) return
  emit('update:modelValue', value)
  emit('change', value)
}

provide(FC_RADIO_GROUP_KEY, {
  value: computed(() => props.modelValue),
  size: computed(() => props.size),
  disabled: computed(() => props.disabled),
  pick,
})

const optionsList = computed(() => props.options ?? [])
const OptionComp = computed(() => (props.variant === 'button' ? FcRadioButton : FcRadio))
</script>

<template>
  <div
    class="fc-radio-group"
    :class="[`size-${size}`, { 'is-button': variant === 'button' }]"
    role="radiogroup"
  >
    <template v-if="optionsList.length">
      <component
        :is="OptionComp"
        v-for="opt in optionsList"
        :key="String(opt.value)"
        :value="opt.value"
        :disabled="opt.disabled"
      >{{ opt.label }}</component>
    </template>
    <slot v-else />
  </div>
</template>

<style scoped lang="scss">
.fc-radio-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;

  &.is-button {
    gap: 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--app-separator, #dcdfe6);
  }

  &.size-small { gap: 12px; }
  &.size-large { gap: 20px; }
}
</style>
