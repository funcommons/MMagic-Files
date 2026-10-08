/**
 * Excel / TSV 粘贴解析 (#11 Excel粘贴).
 *
 * 把从 Excel / Google Sheet 复制的多行多列 tab 分隔文本, 转成行对象数组.
 *
 * 用法:
 *   const parsed = parseExcelPaste(pastedText, ['name', 'description', 'price'])
 *
 *   parsed.value = [
 *     { name: 'foo', description: 'bar', price: '100' },
 *     { name: 'baz', description: 'qux', price: '200' },
 *   ]
 *
 * 规则:
 *   - 列分隔: tab (Excel/Sheets 默认) 或逗号
 *   - 行分隔: \n 或 \r\n
 *   - 第一行可选: 当作表头时, 列数对齐到 fields.length, 多余忽略, 不足报错
 *   - 没有表头: 按 fields 顺序一一对应
 */

export interface PasteParseOptions {
  /** 是否把第一行当作表头 (用于跳过). 默认 false */
  hasHeader?: boolean
  /** 列分隔, 默认 ['\t', ','] (优先 tab) */
  delimiters?: string[]
}

export interface PasteParseError {
  row: number
  message: string
}

export interface PasteParseResult<T> {
  data: T[]
  errors: PasteParseError[]
}

export function parseExcelPaste<T extends Record<string, string>>(
  raw: string,
  fields: (keyof T)[],
  options: PasteParseOptions = {},
): PasteParseResult<T> {
  const { hasHeader = false, delimiters = ['\t', ','] } = options
  const errors: PasteParseError[] = []
  const data: T[] = []

  const text = (raw ?? '').replace(/\r\n/g, '\n').trim()
  if (!text) {
    return { data, errors: [{ row: 0, message: '粘贴内容为空' }] }
  }

  const lines = text.split('\n')
  let startIdx = 0
  if (hasHeader) startIdx = 1

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    const cells = splitLine(line, delimiters)
    if (cells.length < fields.length) {
      errors.push({ row: i + 1, message: `列数不足, 期望 ${fields.length} 列, 实际 ${cells.length} 列` })
      continue
    }
    const row = {} as T
    fields.forEach((f, idx) => {
      row[f] = (cells[idx] ?? '').trim() as T[keyof T]
    })
    data.push(row)
  }

  return { data, errors }
}

function splitLine(line: string, delimiters: string[]): string[] {
  // 简单 split — 不处理引号转义 (Excel 实际粘贴很少带引号)
  const delim = delimiters[0] ?? '\t'
  return line.split(delim)
}