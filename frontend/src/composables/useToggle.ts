import { ref } from 'vue'

/**
 * useToggle — toggle 状态对象, 带便捷 setter.
 *
 * 用法:
 *   const visible = useToggle()
 *   v-model:open="visible.value"      // .value 是 Ref<boolean>
 *   @click="visible.setTrue()"
 *
 * 与 R2 一致: 返回 { value, set, toggle, setTrue, setFalse } 对象.
 * value 是 Ref<boolean>, 在 template 中 Vue 自动 unwrap, 但 v-model 双向
 * 绑定时仍需显式 .value (避免写回整个对象).
 */
export function useToggle(initial = false) {
  const value = ref(initial)
  function set(v: boolean) { value.value = v }
  function toggle() { value.value = !value.value }
  function setTrue() { value.value = true }
  function setFalse() { value.value = false }
  return { value, set, toggle, setTrue, setFalse }
}
