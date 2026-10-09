/**
 * heic2any 0.0.4 环境声明——包自带 dist/heic2any.d.ts 引用了未随包发布的
 * './gifshot' './libheif' 声明文件（TS2307），ambient 声明整体接管该模块类型。
 * 仅收录渲染器实际触达面（blob/toType/quality；multiple/gif 路径未用，从简）。
 */
declare module 'heic2any' {
  interface Heic2AnyOptions {
    /** 输入 HEIC/HEIF 字节流 */
    blob: Blob
    /** 输出 mime（'image/jpeg' | 'image/png' | 'image/gif'） */
    toType?: string
    /** 输出质量 0-1（jpeg/png 有效） */
    quality?: number
    /** true → 多帧输出 Blob[]（渲染器未用） */
    multiple?: true
    /** gif 帧间隔（渲染器未用） */
    gifInterval?: number
  }
  function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>
  export default heic2any
}
