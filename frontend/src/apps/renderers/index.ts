/**
 * 渲染器总表——code → renderer（registerBuiltins 的 renderers 注入源）
 * 契约正本：《documents/第一期文件类型支持计划.md》§一应用清单
 * R5（docx/xlsx）落地后补两行；image-painter（Canvas 画板）M2+ 排期。
 */
import type { AppDefinition } from '../../sdk/types'
import { markdownRenderer } from './markdown'
import { videoRenderer, audioRenderer } from './media'
import { pdfRenderer } from './pdf'
import { csvTableRenderer } from './csv'
import { imageViewRenderer } from './image'
import { heicViewerRenderer } from './heic'
import { codeEditorRenderer } from './code'
import { docxRenderer } from './docx'
import { xlsxRenderer } from './xlsx'
import { imagePainterRenderer } from './painter'

export const RENDERERS: Partial<Record<string, AppDefinition['renderer']>> = {
  'markdown-renderer': markdownRenderer,
  'image-viewer': imageViewRenderer,
  'video-player': videoRenderer,
  'audio-player': audioRenderer,
  'pdf-viewer': pdfRenderer,
  'code-editor': codeEditorRenderer,
  'csv-table': csvTableRenderer,
  'docx-viewer': docxRenderer,
  'xlsx-viewer': xlsxRenderer,
  'image-painter': imagePainterRenderer,
  'heic-viewer': heicViewerRenderer, // Lane F6
}
