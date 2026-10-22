/**
 * 参数归一化与形态解析（纯逻辑，无 DOM 强依赖——单测口径）。
 * 形态解析优先级（方案 §二）：initialMode（宿主硬指定）→ 用户上次选择（本地存储）
 * → defaultMode（宿主兜底）→ 'split'（出厂默认）。非法值一律丢弃走下一级，不抛错。
 */
import type { MdEditorOptions, MdMode } from './types'

export const MD_MODES: readonly MdMode[] = ['source', 'preview', 'split']
/** 出厂默认：双窗（左源码右预览） */
export const DEFAULT_MODE: MdMode = 'split'
/** 用户上次形态的本地存储键（浏览器级，跨 tab 共享） */
export const MODE_STORAGE_KEY = 'mm-md-mode'

export function isMdMode(v: unknown): v is MdMode {
  return typeof v === 'string' && (MD_MODES as readonly string[]).includes(v)
}

/** unknown → 合法参数：只取合法字段，非法丢弃（参数坏不击穿渲染链） */
export function normalizeOptions(raw: unknown): MdEditorOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: MdEditorOptions = {}
  if (isMdMode(o.initialMode)) out.initialMode = o.initialMode
  if (isMdMode(o.defaultMode)) out.defaultMode = o.defaultMode
  return out
}

/** 读用户上次形态；存储不可用（隐私模式/禁用）或值非法 → null */
export function readStoredMode(storage?: Pick<Storage, 'getItem'> | null): MdMode | null {
  try {
    const v = (storage ?? globalThis.localStorage)?.getItem(MODE_STORAGE_KEY) ?? null
    return isMdMode(v) ? v : null
  } catch {
    return null
  }
}

/** 写用户上次形态；存储不可用静默（形态切换本身不因持久化失败而失败） */
export function writeStoredMode(mode: MdMode, storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    ;(storage ?? globalThis.localStorage)?.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // 静默
  }
}

/** 打开时形态解析：initialMode > stored > defaultMode > DEFAULT_MODE */
export function resolveInitialMode(opts: MdEditorOptions, stored: MdMode | null): MdMode {
  return opts.initialMode ?? stored ?? opts.defaultMode ?? DEFAULT_MODE
}
