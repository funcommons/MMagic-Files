/**
 * PPTX 预览插件（mmagix-files 动态应用）：pptx-preview 纯前端渲染（中上保真）。
 * 契约：`export activate(sdk, options?)` + sdk.registerApp（loader.ts 契约 §二；html-editor 同口径）。
 * 定位（2026-10-21 决策）：pptx 是办公三件套唯一真缺口（docx/xlsx 内置+univer 已覆盖）——
 * 独立单职责插件（不做大杂烩 office-preview：4/6 类型重复建设 + 旧 doc/ppt 二进制纯前端无解）。
 * 授权红线：pptx-preview npm 包免费自用商用，但**源码闭源**——仅依赖 dist 产物（版本锁定 1.0.7），
 * 不修改不重分发其源码；单体构建将其内联进本插件产物。
 * 高保真路线 B（LibreOffice 转 PDF → 复用 pdf-viewer）留作部署形态允许时的升级项。
 */
import { renderPptx, renderTip } from './render'
import type { HostCtx, HostSdk } from './types'

const MAX_BYTES = 30 * 1024 * 1024 // pptx 常见几 MB~几十 MB；jszip 解压内存膨胀约 3-5 倍，30MB 封顶
const LIMIT_TEXT = '30 MB'

/** pptx-preview 无类型声明（闭源 dist）——模块形状桩（types.ts 的 PptxPreviewInit 对形） */
declare module 'pptx-preview' {
  export function init(container: HTMLElement, opts: { width: number; height: number }): {
    preview(data: ArrayBuffer): unknown
  }
}

export function activate(sdk: HostSdk): void {
  sdk.registerApp({
    id: 'pptx-viewer',
    matcher: { ext: ['pptx'] },
    label: 'app.pptx-viewer',
    actions: ['preview'],
    version: '1.0.0',
    requiresSdk: 1,
    maxBytes: MAX_BYTES,
    renderer: async (el, file, ctx) => {
      // 尺寸双闸（html-editor 同口径）：file.size 预检 + blob.size 复核
      if (file.size > MAX_BYTES) return renderTip(el, ctx as HostCtx, 'app.pptx-too-large', { limit: LIMIT_TEXT })
      const blob = await ctx.getObject(file.key)
      if (blob.size > MAX_BYTES) return renderTip(el, ctx as HostCtx, 'app.pptx-too-large', { limit: LIMIT_TEXT })
      const buffer = await blob.arrayBuffer()
      return renderPptx(el, ctx as HostCtx, buffer, () => {
        renderTip(el, ctx as HostCtx, 'app.pptx-parse-failed')
      })
    },
  })
}
