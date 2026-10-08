import { ref, type Ref } from 'vue'

/**
 * 撤销/重做栈 (#15 撤销/重做).
 *
 * 用法:
 *   const items = ref<Item[]>([])
 *   const undo = useUndoStack(items, { max: 50 })
 *
 *   undo.commit()        // 在每次"有意义"的状态变更后调用, 推一个快照
 *   undo.undo()          // 回到上一个快照
 *   undo.redo()          // 重做
 */

export interface UndoStackOptions {
  max?: number
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface UndoStackReturn<_T> {
  commit(): void
  undo(): void
  redo(): void
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  clear(): void
}

export function useUndoStack<T>(
  source: Ref<T[]>,
  options: UndoStackOptions = {},
): UndoStackReturn<T> {
  const { max = 50 } = options
  // 用 unknown[][] 存, push/pop 时强转; 避免 Vue Ref<T[]> vs T[] 的 UnwrapRefSimple 类型冲突
  const past = ref<unknown[][]>([])
  const future = ref<unknown[][]>([])
  const canUndo = ref(false)
  const canRedo = ref(false)

  function snapshot(): unknown[] {
    return JSON.parse(JSON.stringify(source.value))
  }

  function refreshFlags() {
    canUndo.value = past.value.length > 0
    canRedo.value = future.value.length > 0
  }

  function commit() {
    past.value.push(snapshot())
    if (past.value.length > max) past.value.shift()
    future.value = []
    refreshFlags()
  }

  function undo() {
    if (past.value.length === 0) return
    future.value.push(snapshot())
    const next = past.value.pop() as T[] | undefined
    if (next) source.value = next
    refreshFlags()
  }

  function redo() {
    if (future.value.length === 0) return
    past.value.push(snapshot())
    const next = future.value.pop() as T[] | undefined
    if (next) source.value = next
    refreshFlags()
  }

  function clear() {
    past.value = []
    future.value = []
    refreshFlags()
  }

  refreshFlags()
  return { commit, undo, redo, canUndo, canRedo, clear }
}