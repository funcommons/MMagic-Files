/** xlsx/xls ↔ Univer Sheets 快照桥（SheetJS CE 读两者/写 xlsx；样式保真留给 Pro exchange，本桥保值与公式） */
import * as XLSX from 'xlsx'

export interface CellsSnapshot {
  [row: number]: { [col: number]: { v?: string | number | boolean; f?: string } }
}

export function xlsxToWorkbookSnapshot(buf: ArrayBuffer): Record<string, unknown> {
  const wb = XLSX.read(buf, { type: 'array' })
  const names = wb.SheetNames
  const sheets: Record<string, unknown> = {}
  names.forEach((name, i) => {
    const ws = wb.Sheets[name]
    const cellData: CellsSnapshot = {}
    if (ws && ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref'])
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })]
          if (!cell) continue
          const entry: { v?: string | number | boolean; f?: string } = {}
          if (cell.f) entry.f = `=${cell.f}`
          if (cell.v !== undefined) entry.v = cell.v as string | number | boolean
          if (entry.v !== undefined || entry.f !== undefined) {
            cellData[r] ??= {}
            cellData[r][c] = entry
          }
        }
      }
    }
    sheets[`sheet-${i}`] = {
      id: `sheet-${i}`,
      name,
      rowCount: 500,
      columnCount: 60,
      cellData,
    }
  })
  return {
    id: `univer-wb-${Date.now()}`,
    appVersion: '1.0.0',
    sheetOrder: names.map((_, i) => `sheet-${i}`),
    styles: {},
    sheets,
  }
}

/** Univer 快照 → xlsx 字节（.xls 输入也升级为 xlsx 导出——BIFF 写不保真，且内容无损） */
export function workbookSnapshotToXlsxBlob(snapshot: Record<string, unknown>): Blob {
  const out = XLSX.utils.book_new()
  const sheets = (snapshot.sheets ?? {}) as Record<
    string,
    { name?: string; cellData?: CellsSnapshot }
  >
  const order = (snapshot.sheetOrder as string[] | undefined) ?? Object.keys(sheets)
  order.forEach((sid) => {
    const sheet = sheets[sid]
    const ws: XLSX.WorkSheet = {}
    let maxR = 0
    let maxC = 0
    for (const [rStr, row] of Object.entries(sheet?.cellData ?? {})) {
      const r = Number(rStr)
      for (const [cStr, cell] of Object.entries(row)) {
        const c = Number(cStr)
        const addr = XLSX.utils.encode_cell({ r, c })
        if (cell.f) {
          // SheetJS 公式形态：{f: 'SUM(A1)'}（不带 =），值可缺省由 Excel 端重算
          ws[addr] = { t: 'n', f: cell.f.replace(/^=/, ''), v: typeof cell.v === 'number' ? cell.v : 0 }
        } else {
          const v = cell.v
          ws[addr] = { t: typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's', v } as XLSX.CellObject
        }
        if (r > maxR) maxR = r
        if (c > maxC) maxC = c
      }
    }
    ws['!ref'] = maxR === 0 && maxC === 0 ? 'A1' : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
    XLSX.utils.book_append_sheet(out, ws, (sheet?.name ?? sid).slice(0, 31))
  })
  const buf = XLSX.write(out, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
