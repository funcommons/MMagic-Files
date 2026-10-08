import { ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import i18n from '@/locales'
import { dirtyFormRegistry } from '@/router'

/**
 * 表单未保存提示 (#2 表单未保存离开提示).
 *
 * 用法:
 *   const form = reactive({ name: '' })
 *   useDirtyForm(form, () => ({ name: initialName }))   // 第二参返回 "干净" 快照
 *
 * 行为:
 *   1. watch(form) → deep watch, 任何字段变化 → isDirty = true
 *   2. onBeforeRouteLeave 拦截 → 脏则弹窗, 用户选 Discard 才放行
 *   3. markClean() 调用后 → isDirty = false (用于保存成功后)
 *   4. 同时注册 window beforeunload 监听, 关闭 tab 也提示
 *   5. 注册到 dirtyFormRegistry, 全局 beforeEach 兜底 (跨页面)
 */

const t = (key: string) => i18n.global.t(key)

export interface UseDirtyFormReturn {
  isDirty: Ref<boolean>
  markClean(): void
  /** 强制标记为脏 (比如后端返回了 server-side 校验错误想保留输入) */
  markDirty(): void
  /** 主动 reset 回干净态 (丢弃) */
  reset(): void
}

export function useDirtyForm<T extends object>(
  form: T,
  pristineFactory: () => T,
): UseDirtyFormReturn {
  const isDirty = ref(false)
  let pristine: T = clone(pristineFactory())

  function clone(v: T): T {
    return JSON.parse(JSON.stringify(v))
  }

  function reset() {
    Object.assign(form, pristineFactory())
    isDirty.value = false
  }

  function check() {
    isDirty.value = JSON.stringify(form) !== JSON.stringify(pristine)
  }

  const registryHandle = {
    isDirty: () => isDirty.value,
    discard: () => reset(),
  }
  dirtyFormRegistry.register(registryHandle)

  watch(form, () => check(), { deep: true })

  onBeforeRouteLeave(async () => {
    if (!isDirty.value) return true
    try {
      await ElMessageBox.confirm(
        t('ux.dirty-form.message'),
        t('ux.dirty-form.title'),
        {
          confirmButtonText: t('ux.dirty-form.discard'),
          cancelButtonText: t('ux.dirty-form.cancel'),
          type: 'warning',
        },
      )
      return true
    } catch {
      return false
    }
  })

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (isDirty.value) {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', onBeforeUnload)

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    dirtyFormRegistry.unregister(registryHandle)
  })

  return {
    isDirty,
    markClean() {
      pristine = clone(pristineFactory())
      isDirty.value = false
    },
    markDirty() {
      isDirty.value = true
    },
    reset,
  }
}