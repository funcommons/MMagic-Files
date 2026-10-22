/**
 * CodeMirror 6 装配：basicSetup + markdown 语法 + 折行 + Mod-S 保存钩子 + 变更回调。
 * 单文件内联可行（纯 JS 无 worker）；仅亮色主题（宿主暗色联动=后续项，不阻塞交付）。
 */
import { basicSetup, EditorView } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'

export interface EditorHandle {
  getText(): string
  focus(): void
  getScrollTop(): number
  setScrollTop(px: number): void
  /** display 切换/容器尺寸变化后让 CodeMirror 重测几何（防光标/滚动错位） */
  requestMeasure(): void
  dispose(): void
}

export function createEditor(
  container: HTMLElement,
  opts: { text: string; onSave: () => void; onChange: () => void },
): EditorHandle {
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        markdown(),
        // Mod-S 在编辑器内消费掉（窗口级监听兜底编辑器外按键；save 幂等由 render.ts 把守）
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                opts.onSave()
                return true
              },
            },
          ]),
        ),
        EditorView.updateListener.of((vu) => {
          if (vu.docChanged) opts.onChange()
        }),
      ],
    }),
    parent: container,
  })
  return {
    getText: () => view.state.doc.toString(),
    focus: () => view.focus(),
    getScrollTop: () => view.scrollDOM.scrollTop,
    setScrollTop: (px: number) => {
      view.scrollDOM.scrollTop = px
    },
    requestMeasure: () => view.requestMeasure(),
    dispose: () => view.destroy(),
  }
}
