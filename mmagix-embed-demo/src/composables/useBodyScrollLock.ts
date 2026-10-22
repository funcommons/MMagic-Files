import { watch, onBeforeUnmount, type Ref } from 'vue'

let lockCount = 0
let savedOverflow = ''
let savedPaddingRight = ''

function getScrollbarWidth(): number {
  return window.innerWidth - document.documentElement.clientWidth
}

function lock() {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow
    savedPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = getScrollbarWidth()
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }
    document.body.style.overflow = 'hidden'
  }
  lockCount++
}

function unlock() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow
    document.body.style.paddingRight = savedPaddingRight
  }
}

/**
 * 当依赖 Ref 为 true 时锁定 body 滚动 (含触摸滑动),
 * 多组件叠加使用引用计数, 不会提前解锁.
 *
 * el-dialog / el-drawer 已内置 lock-scroll, 此 composable 主要给 el-popover 等非模态弹层使用.
 */
export function useBodyScrollLock(active: Ref<boolean>) {
  watch(active, (v) => {
    if (v) lock()
    else unlock()
  }, { immediate: true })

  onBeforeUnmount(() => {
    if (active.value) unlock()
  })
}
