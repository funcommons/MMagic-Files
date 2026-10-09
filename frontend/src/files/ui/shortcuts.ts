/**
 * 键盘流纯工具（Lane H-2）：组合键匹配 + 输入焦点判定。
 * 职责边界：本文件只出可独立单测的纯函数，不持任何组件状态——
 * TreePanel 列表 keydown 等调用方在组件内接线，判定逻辑全部收口在此。
 */

/** 组合键描述：key 必填（大小写不敏感）；修饰键缺省=未声明 */
export interface Hotkey {
  key: string
  alt?: boolean
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

/**
 * 组合键匹配（严格口径，防与浏览器/宿主快捷键抢道）：
 * - key 大小写不敏感（shift 按下时 e.key 恒为大写字母，'a' 声明可命中 'A'）；
 * - 声明的修饰键必须按下：ctrl=true 按 ctrl **或** meta 命中（平台无关——macOS 上
 *   Command 是 Ctrl 的事实等位，与多选修饰键 ctrlKey||metaKey 既有口径一致）；
 * - 未声明的修饰键必须未按下（{key:'ArrowUp',alt:true} 在多按了 shift 时不命中；
 *   meta 未声明时单独按下也不命中，除非它正作为已声明 ctrl 的平台等位）。
 */
export function matchesHotkey(e: KeyboardEvent, hotkey: Hotkey): boolean {
  if (e.key.toLowerCase() !== hotkey.key.toLowerCase()) return false
  const wantCtrl = hotkey.ctrl === true
  const wantMeta = hotkey.meta === true
  if (hotkey.alt === true ? !e.altKey : e.altKey) return false
  if (hotkey.shift === true ? !e.shiftKey : e.shiftKey) return false
  // ctrl 位：声明时 ctrl/meta 皆可命中；未声明时 ctrl 必须未按下（meta 单独按下归 meta 位管）
  if (wantCtrl ? !(e.ctrlKey || e.metaKey) : e.ctrlKey) return false
  // meta 位：声明时必须按下；未声明时必须未按下——ctrl 已声明则放行（meta 已作为其平台等位被吸收）
  if (wantMeta ? !e.metaKey : e.metaKey && !wantCtrl) return false
  return true
}

/**
 * 输入焦点判定：事件目标处于文本输入态（input/textarea/contenteditable）时返回 true。
 * 全局/容器级快捷键在此类焦点上必须让路（防打字误触）——通用件，供 keydown 入口统一前置守卫。
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target
  if (!(el instanceof HTMLElement)) return false
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true
  if (el.isContentEditable) return true
  // 回退：jsdom 未实现 isContentEditable（恒 undefined）——按 HTML 口径读属性
  //（'' / 'true' / 'plaintext-only' 均为可编辑态，仅 'false' 除外）
  const attr = el.getAttribute('contenteditable')
  return attr !== null && attr.toLowerCase() !== 'false'
}
