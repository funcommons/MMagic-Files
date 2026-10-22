/** docx ↔ Univer Docs 快照桥（mammoth 读 docx→HTML→段落模型；docx 库写回。
 *  保真口径：段落/加粗/斜体/标题层级（导出为加粗段落）；表格/图片/复杂样式不在 MVP 桥内） */
import * as docxLib from 'docx'

export interface DocRun {
  text: string
  bold?: boolean
  italic?: boolean
  heading?: number // 0=正文 1..6
}

export interface DocSnapshot {
  id: string
  paragraphs: DocRun[][]
}

/** mammoth 输出 HTML → 段落模型（浏览器 DOMParser） */
export async function docxToDocSnapshot(buf: ArrayBuffer): Promise<DocSnapshot> {
  const mammoth = (await import('mammoth')) as unknown as {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
  }
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf })
  const dom = new DOMParser().parseFromString(html, 'text/html')
  const paragraphs: DocRun[][] = []
  const walk = (el: Element, inherited: Partial<DocRun>) => {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? ''
        if (text) paragraphs.length === 0 ? paragraphs.push([{ text, ...inherited }]) : paragraphs.at(-1)!.push({ text, ...inherited })
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const e = node as Element
      const tag = e.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        const runs: DocRun[] = [{ text: e.textContent ?? '', bold: true, heading: Number(tag[1]) }]
        paragraphs.push(runs)
        continue
      }
      if (tag === 'p' || tag === 'li') {
        paragraphs.push([])
        walk(e, inherited)
        continue
      }
      if (tag === 'br') {
        paragraphs.push([])
        continue
      }
      const style: Partial<DocRun> = {
        ...inherited,
        bold: tag === 'b' || tag === 'strong' || inherited.bold,
        italic: tag === 'i' || tag === 'em' || inherited.italic,
      }
      walk(e, style)
    }
  }
  const body = dom.body
  paragraphs.push([])
  walk(body, {})
  return { id: `univer-doc-${Date.now()}`, paragraphs: paragraphs.filter((p) => p.length > 0 || true) }
}

/** 段落模型 → Univer Docs 快照（\r 分段；textRuns 偏移按 dataStream 全局计）。
 *  结构红线（缺失=渲染引擎静默白屏）：dataStream 必须以 \r\n 结尾、段落须带 paragraphId/paragraphStyle、
 *  末尾必须有 sectionBreaks 指向终 \n（分节符驱动分页，无节=无页=不绘制） */
export function docSnapshotToUniver(doc: DocSnapshot): Record<string, unknown> {
  let stream = ''
  const textRuns: Array<{ st: number; ed: number; sd: string; ts: Record<string, unknown> }> = []
  const paragraphs: Array<{ startIndex: number; paragraphId: string; paragraphStyle: Record<string, never> }> = []
  let paraSeq = 0
  for (const para of doc.paragraphs) {
    paragraphs.push({ startIndex: Math.max(0, stream.length - 1), paragraphId: `para-${doc.id}-${++paraSeq}`, paragraphStyle: {} })
    for (const run of para) {
      const st = stream.length
      stream += run.text
      if (st !== stream.length) {
        const ts: Record<string, unknown> = {}
        if (run.bold) ts.bold = true
        if (run.italic) ts.italic = true
        if (run.heading) ts.fontSize = Math.max(12, 24 - run.heading * 2)
        textRuns.push({ st, ed: stream.length, sd: run.text, ts })
      }
    }
    stream += '\r'
  }
  if (!stream.endsWith('\r')) stream += '\r'
  stream += '\n' // 终止分节标记
  return {
    id: doc.id,
    documentStyle: {
      // 595pt 会对画布产生 ~0.5px 幻影水平溢出（布局居中用未缩放宽、绘制用缩放宽）→ 幽灵滚动条；
      // 594pt 恰好收进右缘，水平条消失（竖向仍真溢出、竖条保留）
      pageSize: { width: 594, height: 792 },
      marginTop: 50,
      marginBottom: 50,
      marginLeft: 50,
      marginRight: 50,
      // 场景灰底（WPS/Word 观感）：白纸浮于灰底之上，纸界清晰，四周不再是无边界的白
      renderConfig: { zeroWidthParagraphBreak: 0, vertexAngle: 0, centerAngle: 0, background: { rgb: '#ccc' } },
    },
    body: {
      dataStream: stream,
      textRuns,
      paragraphs,
      sectionBreaks: [{ sectionId: `sec-${doc.id}`, startIndex: stream.length - 1 }],
    },
  }
}

/** Univer Docs 快照（body.dataStream + textRuns）→ docx 字节（Packer.toBlob 异步——必须 await，否则签名错位 400）。
 *  内容以 dataStream 为唯一事实源：textRuns 只覆盖有格式区间，未格式化文本（如新键入）活在 runs 的 st/ed 空洞里，
 *  按 runs 取内容会丢字——runs 仅作样式注解，空洞区间用默认样式 */
export async function univerDocToDocxBlob(body: { dataStream?: string; textRuns?: Array<{ st: number; ed: number; sd?: string; ts?: Record<string, unknown> }> }, name: string): Promise<Blob> {
  const stream = (body.dataStream ?? '').replace(/\r?\n$/, '') // 去掉终止分节 \n，避免导出多出空段
  const runs = (body.textRuns ?? []).slice().sort((a, b) => a.st - b.st)
  const lines = stream.split('\r')
  const children: docxLib.Paragraph[] = []
  let cursor = 0
  for (const line of lines) {
    const lineStart = cursor
    const lineEnd = cursor + line.length
    // 行内切分点：行界 + 与行相交的 run 边界
    const bounds = new Set<number>([lineStart, lineEnd])
    for (const run of runs) {
      if (run.ed > lineStart && run.st < lineEnd) {
        bounds.add(Math.min(Math.max(run.st, lineStart), lineEnd))
        bounds.add(Math.min(Math.max(run.ed, lineStart), lineEnd))
      }
    }
    const points = [...bounds].sort((a, b) => a - b)
    const paraRuns: docxLib.TextRun[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      if (b <= a) continue
      const seg = stream.slice(a, b)
      if (!seg) continue
      const hit = runs.find((r) => r.st <= a && b <= r.ed)
      const ts = hit?.ts ?? {}
      const size = typeof ts.fontSize === 'number' ? ts.fontSize * 2 : undefined // pt → half-points
      paraRuns.push(new docxLib.TextRun({ text: seg, bold: Boolean(ts.bold), italics: Boolean(ts.italic ?? ts.italics), ...(size ? { size } : {}) }))
    }
    children.push(new docxLib.Paragraph({ children: paraRuns.length > 0 ? paraRuns : [new docxLib.TextRun({ text: line })] }))
    cursor = lineEnd + 1 // \r
  }
  const doc = new docxLib.Document({
    creator: 'mmagix-files Univer 插件',
    title: name.replace(/\.[^.]+$/, ''),
    sections: [{ children: children.length > 0 ? children : [new docxLib.Paragraph({})] }],
  })
  return docxLib.Packer.toBlob(doc)
}
