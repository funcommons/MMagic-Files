/**
 * 默认对象仓种子——覆盖第一期的文件类型矩阵（md/png/csv/txt/docx/xlsx/mp4 + 未知类型）。
 * key 域 = sessions/test/（= config.backend.prefix）。
 */
import {
  DATA_CSV,
  INVALID_DOCX,
  NOTES_TXT,
  README_MD,
  TINY_PNG_BASE64,
  minimalMp4,
} from './s3-mock'
import { MOCK_PREFIX } from './config'
import type { S3MockOptions } from './s3-mock'

const P = MOCK_PREFIX

export const README_KEY = `${P}README.md`
export const NOTES_KEY = `${P}notes.txt`
export const DATA_CSV_KEY = `${P}data.csv`
export const LOGO_KEY = `${P}logo.png`
export const REPORT_DOCX_KEY = `${P}report.docx`
export const TABLE_XLSX_KEY = `${P}table.xlsx`
export const DEMO_MP4_KEY = `${P}demo.mp4`
export const GUIDE_KEY = `${P}docs/guide.md`
export const PHOTO_KEY = `${P}docs/img/photo.png`
export const BROKEN_KEY = `${P}broken/ok.txt`
export const BLOB_XYZ_KEY = `${P}blob.xyz`
export const PAGED_A = `${P}paged/a.md`
export const PAGED_B = `${P}paged/b.md`
export const PAGED_C = `${P}paged/c.md`

/** 默认种子（xlsx 真实 zip 由 line9 自行生成并覆盖 table.xlsx） */
export function defaultSeed(): NonNullable<S3MockOptions['seed']> {
  return {
    [README_KEY]: { bytes: README_MD, contentType: 'text/markdown' },
    [NOTES_KEY]: { bytes: NOTES_TXT, contentType: 'text/plain' },
    [DATA_CSV_KEY]: { bytes: DATA_CSV, contentType: 'text/csv' },
    [LOGO_KEY]: { bytes: Buffer.from(TINY_PNG_BASE64, 'base64'), contentType: 'image/png' },
    [REPORT_DOCX_KEY]: { bytes: INVALID_DOCX, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    [TABLE_XLSX_KEY]: { bytes: Buffer.from('placeholder-replaced-by-line9', 'utf8'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    [DEMO_MP4_KEY]: { bytes: minimalMp4(), contentType: 'video/mp4' },
    [GUIDE_KEY]: { bytes: '# 子目录文档\n\ndocs/guide.md 内容\n', contentType: 'text/markdown' },
    [PHOTO_KEY]: { bytes: Buffer.from(TINY_PNG_BASE64, 'base64'), contentType: 'image/png' },
    [BROKEN_KEY]: { bytes: 'ok after retry\n', contentType: 'text/plain' },
    [BLOB_XYZ_KEY]: { bytes: 'unknown binary payload', contentType: 'application/octet-stream' },
    [PAGED_A]: { bytes: '# a\n', contentType: 'text/markdown' },
    [PAGED_B]: { bytes: '# b\n', contentType: 'text/markdown' },
    [PAGED_C]: { bytes: '# c\n', contentType: 'text/markdown' },
  }
}
