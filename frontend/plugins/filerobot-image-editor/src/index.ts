/**
 * Filerobot 图片编辑器插件（MMagic-Files 动态应用）：png/jpg/jpeg/webp/bmp/gif 编辑增强。
 * 契约：`export activate(sdk, options?)` + sdk.registerApp（options=v1.1 参数通道）。
 * 不抢 image-viewer 默认位（actions:['edit'] 走「打开方式」）。
 * 保存链：编辑器 Save → onSave → 导出 Blob → ctx.putObject + ctx.notify('saved')。
 */
import { normalizeOptions } from './options'
import { renderEditor } from './render'
import { EDITABLE_EXTS } from './types'
import type { EditorOptions, HostSdk } from './types'

let activeOptions: Required<EditorOptions> = normalizeOptions(undefined)

export function activate(sdk: HostSdk, rawOptions?: Record<string, unknown>): void {
  activeOptions = normalizeOptions(rawOptions)
  sdk.registerApp({
    id: 'filerobot-image-editor',
    matcher: { ext: [...EDITABLE_EXTS] },
    label: 'app.filerobot-editor',
    actions: ['edit'],
    version: '1.0.0',
    requiresSdk: 1,
    renderer: (el, file, ctx, savedState) => renderEditor(el, file, ctx, activeOptions, savedState),
  })
}
