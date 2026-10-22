/**
 * CodeMirror 6 源码编辑器封装（md 插件 editor.ts 同口径：basicSetup + Mod-S 钩子 + 变更回调），
 * 语法换 html 高亮。
 */
import { basicSetup, EditorView } from 'codemirror'
import { html } from '@codemirror/lang-html'
import { EditorState, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'

export interface SourceHandle {
  getText(): string
  /** 三态交接：可视编辑态的 HTML 写回源码视图（整文档重排后或片段） */
  setText(text: string): void
  focus(): void
  dispose(): void
}

export function createSourceEditor(
  container: HTMLElement,
  opts: { text: string; onSave: () => void; onChange: () => void },
): SourceHandle {
  const view = new EditorView({
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        html({ autoCloseTags: true }),
        // Mod-S 编辑器内消费掉（窗口级监听兜底编辑器外按键；save 幂等由 render.ts 把守）
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
    setText: (text) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
    },
    focus: () => view.focus(),
    dispose: () => view.destroy(),
  }
}
