/**
 * HTML 编辑器插件（mmagix-files 动态应用）：三态（源码/可视/预览）+ 图片 base64 单体化 +
 * 预览跳转新 tab 代理（方案 v2）。
 * 契约：`export activate(sdk, options?)` + sdk.registerApp（loader.ts 契约 §二；options=v1.1 参数通道）。
 * 不抢内置渲染器默认位：actions=['edit'] 走「打开方式」。
 * 保存链：ctx.putObject + ctx.notify('saved')；保存前强制单体化（漏网外链剥离+警告）。
 */
import { renderEditor, renderTooLargeTip } from './render'
import { isHtmlMode, normalizeOptions } from './options'
import type { HostSdk, HtmlEditorOptions, HtmlMode } from './types'

const MAX_BYTES = 20 * 1024 * 1024 // base64 内联 +33% 体积，放宽于 5MB 预览闸（方案 §3.3）
const LIMIT_TEXT = '20 MB'

/** 激活期参数（同模块可被重复 activate 覆盖——loader 幂等保证实际只一次） */
let activeOptions: HtmlEditorOptions = {}

export function activate(sdk: HostSdk, rawOptions?: Record<string, unknown>): void {
  activeOptions = normalizeOptions(rawOptions)
  sdk.registerApp({
    id: 'html-editor',
    matcher: { ext: ['html', 'htm'] },
    label: 'app.html-editor',
    actions: ['edit'],
    version: '1.0.0',
    requiresSdk: 1,
    maxBytes: MAX_BYTES,
    renderer: async (el, file, ctx, savedState, appOptions) => {
      // 尺寸双闸（防御纵深，md 插件同口径）：file.size 预检 + blob.size 复核
      if (file.size > MAX_BYTES) return renderTooLargeTip(el, ctx, LIMIT_TEXT)
      const blob = await ctx.getObject(file.key)
      if (blob.size > MAX_BYTES) return renderTooLargeTip(el, ctx, LIMIT_TEXT)
      const text = await blob.text()
      // 打开参数（第 5 参透传）：initialMode 覆盖注册期缺省（source | wysiwyg | preview）
      const openOpts = (appOptions ?? {}) as { initialMode?: unknown }
      const merged = isHtmlMode(openOpts.initialMode)
        ? { ...activeOptions, initialMode: openOpts.initialMode as HtmlMode }
        : activeOptions
      return renderEditor(el, file, ctx, merged, text, savedState)
    },
  })
}
