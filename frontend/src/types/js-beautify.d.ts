/** js-beautify 最小类型声明（仅本仓库用到的 html/css/js 入口） */
declare module 'js-beautify' {
  interface BeautifyOptions {
    indent_size?: number
    indent_char?: string
    wrap_line_length?: number
    [key: string]: unknown
  }
  export function html(source: string, options?: BeautifyOptions): string
  export function css(source: string, options?: BeautifyOptions): string
  export function js(source: string, options?: BeautifyOptions): string
}
