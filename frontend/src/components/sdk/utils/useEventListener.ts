/**
 * useEventListener — 自动 cleanup 的事件绑定.
 *
 * 解决"addEventListener 写在 onMounted 回调里, removeEventListener 也得在 onUnmounted 解绑"
 * 这一对反模式 — 后者必须在 setup 顶层同步注册, Vue 才能捕获.
 *
 * target 支持 Ref (自动 unref), 也可为 null (no-op).
 */
import { isRef, onBeforeUnmount, unref, type Ref } from 'vue'

type Target = Window | Document | HTMLElement | Element | null
type MaybeRef<T> = T | Ref<T>

type Listener<K extends keyof GlobalEventHandlersEventMap> = (
  ev: GlobalEventHandlersEventMap[K]
) => void

export function useEventListener<K extends keyof GlobalEventHandlersEventMap>(
  target: MaybeRef<Target>,
  event: K,
  handler: Listener<K>,
  options?: AddEventListenerOptions
): void {
  const el = isRef(target) ? unref(target) : target
  if (!el) return
  const native = el as GlobalEventHandlers
  native.addEventListener(event, handler as EventListener, options)
  onBeforeUnmount(() => {
    native.removeEventListener(event, handler as EventListener, options)
  })
}