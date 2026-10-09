/**
 * 多选打包下载（Lane F5）——fflate store 模式打包。
 * store（level=0）：大文件零压缩 CPU 尖峰（防工作台卡死），体积换流畅；
 * 预算护栏：ZIP_SIZE_LIMIT=256MB，累计超限由调用方 toast 拦截（Home.downloadEntries），
 * 本模块只做纯打包（同步、无 IO，便于单测字节断言）。
 */
import { zipSync } from 'fflate'

/** 打包预算上限（选中文件 size 累计）；超出不打包，toast 提示 */
export const ZIP_SIZE_LIMIT = 256 * 1024 * 1024

export interface ZipEntry {
  /** 包内路径（同目录选中集天然唯一，重名由调用方保证不传） */
  name: string
  data: Uint8Array
}

/** 打包为 zip（store 模式 level=0）。同步返回完整字节（预算已在上层把关） */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const input: Record<string, [Uint8Array, { level: 0 }]> = {}
  for (const e of entries) input[e.name] = [e.data, { level: 0 }]
  return zipSync(input)
}
