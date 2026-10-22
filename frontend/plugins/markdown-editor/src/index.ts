/**
 * Markdown 编辑器插件（MMagic-Files 动态应用）：md/markdown 编辑 × 内置 mermaid × 三形态。
 * 契约：`export activate(sdk, options?)` + sdk.registerApp（loader.ts 契约 §二；options=v1.1 参数通道）。
 * 不抢内置 markdown-renderer 的默认 view 位：actions=['edit'] 走「打开方式」。
 * 保存链与内置应用同口径：ctx.putObject + ctx.notify('saved')（Ctrl+S / 工具栏钮）。
 */
import { isMdMode, normalizeOptions } from './options'
import { renderEditor, renderTooLargeTip } from './render'
import type { HostSdk, MdEditorOptions } from './types'

const MAX_BYTES = 20 * 1024 * 1024 // 编辑场景放宽于 5MB 预览闸（方案 §3.4）
const LIMIT_TEXT = '20 MB'

/** 激活期参数（同模块可被重复 activate 覆盖——loader 幂等保证实际只一次） */
let activeOptions: MdEditorOptions = {}

export function activate(sdk: HostSdk, rawOptions?: Record<string, unknown>): void {
  activeOptions = normalizeOptions(rawOptions)
  sdk.registerApp({
    id: 'markdown-editor',
    matcher: { ext: ['md', 'markdown'] },
    label: 'app.markdown-editor',
    actions: ['edit'],
    version: '1.0.0',
    requiresSdk: 1,
    maxBytes: MAX_BYTES,
    // 渲染失败（getObject/读文本异常）向上抛，openFile 链路统一兜底（对齐内置渲染器口径）
    renderer: async (el, file, ctx, savedState, appOptions) => {
      // 尺寸双闸（防御纵深）：file.size 预检可零成本拦截；blob.size 复核兜住 size 缺失/0 被闸旁路的入口
      if (file.size > MAX_BYTES) return renderTooLargeTip(el, ctx, LIMIT_TEXT)
      const blob = await ctx.getObject(file.key)
      if (blob.size > MAX_BYTES) return renderTooLargeTip(el, ctx, LIMIT_TEXT)
      const text = await blob.text()
      // 打开参数（第 5 参，内存文件独立区/宿主 open 链透传）：initialMode 覆盖注册期缺省（不落用户记忆）
      const openOpts = (appOptions ?? {}) as { initialMode?: unknown }
      const merged = isMdMode(openOpts.initialMode)
        ? { ...activeOptions, initialMode: openOpts.initialMode as MdEditorOptions['initialMode'] }
        : activeOptions
      return renderEditor(el, file, ctx, merged, text, savedState)
    },
  })
}
