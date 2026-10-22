import type { ComputedRef, InjectionKey } from 'vue'

export type RadioValue = string | number | boolean

export interface RadioGroupContext {
  value: ComputedRef<RadioValue | undefined>
  size: ComputedRef<'small' | 'default' | 'large'>
  disabled: ComputedRef<boolean>
  pick: (value: RadioValue) => void
}

export const FC_RADIO_GROUP_KEY: InjectionKey<RadioGroupContext> = Symbol('fc-radio-group')
