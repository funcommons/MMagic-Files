import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * useOutsideClickClose — 点击 .control-group 外的位置时关闭菜单.
 *
 * 3 个 create 页 (image/image2/video) 各自有 activeMenu ref + handleClickOutside 闭包.
 * 它们逻辑完全一致 (target.closest('.control-group') 排除内部点击, 否则清空 activeMenu).
 * 抽到 composable 统一管理 ref + add/removeEventListener, 避免 3 份复制.
 *
 * 返回 Ref + 几个方法, template 里直接用 activeMenu (Vue 自动 unwrap).
 *
 * 用法:
 *   const activeMenu = useOutsideClickClose<'model' | 'config'>()
 *   @click="activeMenu = 'model'"            // 直接赋值
 *   @click="activeMenu = activeMenu === 'model' ? null : 'model'"  // toggle
 *   activeMenu === null                       // 关闭状态
 */
export function useOutsideClickClose<T extends string = string>() {
  const value = ref<T | null>(null) as Ref<T | null>

  function set(v: T | null) {
    value.value = v
  }

  function toggle(v: T) {
    value.value = value.value === v ? null : v
  }

  function close() {
    value.value = null
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (!target.closest('.control-group')) {
      value.value = null
    }
  }

  onMounted(() => {
    document.addEventListener('click', handleClickOutside)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside)
  })

  return Object.assign(value, { set, toggle, close })
}