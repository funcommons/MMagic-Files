/**
 * Tiptap 可视编辑器封装 v2（方案 §二.5 + A/B/C 功能补齐）：
 * - 扩展全集：StarterKit + Underline/Image/Link/Table 系 + Highlight/TextStyle/Color/
 *   TextAlign/TaskList/TaskItem/Subscript/Superscript + 自研 FontSize/FontFamily
 * - 图片管道（方案 §3.2）：粘贴/拖拽 → dataURL 直接内联
 * - 查找替换引擎：跨 text-node 文本索引 + 位置映射（A+B+C C 档）
 * - getHTML() 为三态交接/保存的内容介质（非逐字还原——方案 §二有确认语义）
 */
import { Editor, Extension } from '@tiptap/core'
import { findAllHits, type Hit } from './find'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'

/** 自研：字号（textStyle mark 上的 fontSize 属性——官方无内置，社区标准做法） */
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null as string | null,
            parseHTML: (el) => (el.style.fontSize || null) as string | null,
            renderHTML: (attrs) => (attrs.fontSize ? { style: `font-size:${attrs.fontSize}` } : {}),
          },
        },
      },
    ]
  },
})

/** 自研：字体族（同上） */
const FontFamily = Extension.create({
  name: 'fontFamily',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null as string | null,
            parseHTML: (el) => (el.style.fontFamily?.replace(/["']/g, '') || null) as string | null,
            renderHTML: (attrs) => (attrs.fontFamily ? { style: `font-family:${attrs.fontFamily}` } : {}),
          },
        },
      },
    ]
  },
})

export interface WysiwygHandle {
  getHTML(): string
  focus(): void
  isActive(name: string, attrs?: Record<string, unknown>): boolean
  /** 选区/文档状态变化（工具栏按钮态刷新用）；返回解绑函数 */
  onStateChange(cb: () => void): () => void
  // 行内格式
  toggleBold(): void
  toggleItalic(): void
  toggleUnderline(): void
  toggleStrike(): void
  toggleCode(): void
  toggleHighlight(): void
  unsetHighlight(): void
  setColor(color: string): void
  unsetColor(): void
  setFontSize(px: string): void
  unsetFontSize(): void
  setFontFamily(family: string): void
  unsetFontFamily(): void
  // 段落
  toggleHeading(level: 1 | 2 | 3): void
  toggleBulletList(): void
  toggleOrderedList(): void
  toggleTaskList(): void
  toggleBlockquote(): void
  toggleCodeBlock(): void
  setHorizontalRule(): void
  setTextAlign(align: 'left' | 'center' | 'right' | 'justify'): void
  // 上下标
  toggleSubscript(): void
  toggleSuperscript(): void
  // 历史
  undo(): void
  redo(): void
  // 链接 / 图片 / 表格
  setLink(): void
  unsetLink(): void
  insertImage(): void
  /** 选中图片的宽度（px 或 %；null=未选中图片） */
  getImageWidth(): string | null
  setImageWidth(width: string): void
  /** 清除选中图片宽度（回默认自适应） */
  unsetImageWidth(): void
  insertTable(): void
  tableCommand(cmd: 'addRowAfter' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'mergeCells' | 'splitCell' | 'toggleHeaderRow' | 'deleteTable'): void
  // 查找替换（C 档）
  /** 全量检索：返回命中数并把游标归零 */
  find(query: string): number
  /** 游标跳到下一/上一命中并选中（返回当前序号，-1=无命中） */
  findNext(): number
  findPrev(): number
  /** 替换当前命中（若选区即命中）→ 返回剩余命中数 */
  replace(replacement: string): number
  /** 全部替换 → 返回替换数 */
  replaceAll(replacement: string): number
  /** 命中总数（findbar 计数显示用；只读快照） */
  hitCount(): number
  /** 当前命中序号（0 基；-1=无游标/无命中） */
  hitCursor(): number
  /** 选区文本（链接钮预填） */
  getSelectedText(): string
  dispose(): void
}

/** 文件 → dataURL（粘贴/拖拽图片内联管道） */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'))
    fr.readAsDataURL(file)
  })
}

/** 触发系统选图（工具栏「图片」钮）：隐藏 input，选中即以 dataURL 插入 */
function pickImage(insert: (dataUrl: string) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const f = input.files?.[0]
    if (f) void fileToDataUrl(f).then(insert)
    input.remove()
  })
  document.body.appendChild(input)
  input.click()
}

export function createWysiwyg(
  container: HTMLElement,
  opts: { html: string; onChange: () => void },
): WysiwygHandle {
  const editor = new Editor({
    element: container,
    extensions: [
      StarterKit,
      Underline,
      Image.configure({ inline: true, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Highlight,
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      FontSize,
      FontFamily,
    ],
    content: opts.html,
    editorProps: {
      // 图片内联管道：粘贴/拖拽的图片文件 → dataURL 节点（不产生外链——方案 §3.2）
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        void Promise.all(files.map((f) => fileToDataUrl(f))).then((urls) => {
          const tr = view.state.tr
          urls.forEach((u) => {
            tr.insert(view.state.selection.from, view.state.schema.nodes.image.create({ src: u }))
          })
          view.dispatch(tr)
        })
        return true
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
        void Promise.all(files.map((f) => fileToDataUrl(f))).then((urls) => {
          const tr = view.state.tr
          urls.forEach((u) => {
            tr.insert(pos, view.state.schema.nodes.image.create({ src: u }))
          })
          view.dispatch(tr)
        })
        return true
      },
    },
    onUpdate: () => opts.onChange(),
  })

  // 查找替换游标状态
  let query = ''
  let hits: Hit[] = []
  let cursor = -1

  const handle: WysiwygHandle = {
    getHTML: () => editor.getHTML(),
    focus: () => editor.commands.focus(),
    isActive: (name, attrs) => editor.isActive(name, attrs),
    onStateChange: (cb) => {
      const h = () => cb()
      editor.on('transaction', h)
      return () => editor.off('transaction', h)
    },
    toggleBold: () => editor.chain().focus().toggleBold().run(),
    toggleItalic: () => editor.chain().focus().toggleItalic().run(),
    toggleUnderline: () => editor.chain().focus().toggleUnderline().run(),
    toggleStrike: () => editor.chain().focus().toggleStrike().run(),
    toggleCode: () => editor.chain().focus().toggleCode().run(),
    toggleHighlight: () => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run(),
    unsetHighlight: () => editor.chain().focus().unsetHighlight().run(),
    setColor: (color) => editor.chain().focus().setColor(color).run(),
    unsetColor: () => editor.chain().focus().unsetColor().run(),
    setFontSize: (px) => editor.chain().focus().setMark('textStyle', { fontSize: px }).run(),
    unsetFontSize: () => editor.chain().focus().setMark('textStyle', { fontSize: null }).unsetMark('textStyle').run(),
    setFontFamily: (family) => editor.chain().focus().setMark('textStyle', { fontFamily: family }).run(),
    unsetFontFamily: () => editor.chain().focus().setMark('textStyle', { fontFamily: null }).run(),
    toggleHeading: (level) => {
      editor.chain().focus().toggleHeading({ level }).run()
      editor.view.focus()
    },
    toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
    toggleOrderedList: () => editor.chain().focus().toggleOrderedList().run(),
    toggleTaskList: () => editor.chain().focus().toggleTaskList().run(),
    toggleBlockquote: () => editor.chain().focus().toggleBlockquote().run(),
    toggleCodeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
    setHorizontalRule: () => editor.chain().focus().setHorizontalRule().run(),
    setTextAlign: (align) => editor.chain().focus().setTextAlign(align).run(),
    toggleSubscript: () => editor.chain().focus().toggleSubscript().run(),
    toggleSuperscript: () => editor.chain().focus().toggleSuperscript().run(),
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    setLink: () => {
      const prev = (editor.getAttributes('link').href as string | undefined) ?? ''
      const url = globalThis.prompt('URL', prev)
      if (url === null) return
      if (url === '') {
        editor.chain().focus().unsetLink().run()
        return
      }
      editor.chain().focus().setLink({ href: url }).run()
    },
    unsetLink: () => editor.chain().focus().unsetLink().run(),
    insertImage: () => {
      pickImage((dataUrl) => {
        editor.chain().focus().setImage({ src: dataUrl }).run()
        editor.view.focus()
      })
    },
    getImageWidth: () => {
      if (!editor.isActive('image')) return null
      const attrs = editor.getAttributes('image')
      return (attrs.width as string | undefined) ?? null
    },
    setImageWidth: (width) => {
      editor.chain().focus().updateAttributes('image', { width }).run()
      editor.view.focus()
    },
    unsetImageWidth: () => {
      editor.chain().focus().updateAttributes('image', { width: null }).run()
      editor.view.focus()
    },
    insertTable: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    tableCommand: (cmd) => {
      const chain = editor.chain().focus()
      const table = chain as unknown as Record<string, () => { run: () => void }>
      table[cmd]?.().run()
    },
    find: (q) => {
      query = q
      hits = findAllHits(editor.state, q)
      cursor = hits.length ? 0 : -1
      if (cursor === 0) {
        editor.chain().setTextSelection({ from: hits[0]!.from, to: hits[0]!.to }).scrollIntoView().run()
      }
      return hits.length
    },
    findNext: () => {
      if (hits.length === 0) return -1
      cursor = (cursor + 1) % hits.length
      const h = hits[cursor]!
      editor.chain().setTextSelection({ from: h.from, to: h.to }).scrollIntoView().run()
      return cursor + 1
    },
    findPrev: () => {
      if (hits.length === 0) return -1
      cursor = (cursor - 1 + hits.length) % hits.length
      const h = hits[cursor]!
      editor.chain().setTextSelection({ from: h.from, to: h.to }).scrollIntoView().run()
      return cursor + 1
    },
    replace: (replacement) => {
      const sel = editor.state.selection
      const inHit = hits.some((h) => h.from === sel.from && h.to === sel.to)
      if (!inHit) return hits.length
      editor.chain().insertContent(replacement).run()
      hits = findAllHits(editor.state, query)
      cursor = hits.length ? -1 : -1
      return hits.length
    },
    replaceAll: (replacement) => {
      const all = findAllHits(editor.state, query)
      if (all.length === 0) return 0
      const { tr } = editor.state
      // 从后往前替换：位置不失效
      for (let i = all.length - 1; i >= 0; i--) {
        tr.replaceWith(all[i]!.from, all[i]!.to, editor.schema.text(replacement))
      }
      editor.view.dispatch(tr)
      hits = findAllHits(editor.state, query)
      cursor = hits.length ? 0 : -1
      return all.length
    },
    hitCount: () => hits.length,
    hitCursor: () => cursor,
    getSelectedText: () => {
      const { from, to, empty } = editor.state.selection
      return empty ? '' : editor.state.doc.textBetween(from, to, ' ')
    },
    dispose: () => editor.destroy(),
  }
  return handle
}
