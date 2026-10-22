/**
 * esbuild 单文件构建（替代 vite：同入口 vite 产物 3.06MB vs esbuild 1.29MB——styled-components/react
 * 在 rollup 下未按 production 口径收敛，esbuild 直构小 2.3 倍，见方案 §三）。
 * 产物：../../public/plugins/filerobot-image-editor.js（单文件 ESM）。
 * 内核附带的少量编辑器 CSS 由 esbuild 拆出为独立 .css——write:false 内存组装，运行时 <style> 注入，
 * 保住「单文件、零独立 CSS」契约（对齐 univer/markdown-editor 先例）。
 */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const result = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: '../../public/plugins/filerobot-image-editor.js',
  define: {
    process: '{"env":{},"browser":true}',
    'process.env.NODE_ENV': '"production"',
  },
  write: false,
  logLevel: 'info',
})

const js = result.outputFiles.find((f) => f.path.endsWith('.js'))
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))
let code = new TextDecoder().decode(js.contents)
if (css) {
  const cssText = new TextDecoder().decode(css.contents)
  code += `\n;(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(cssText)};document.head.appendChild(s)})();`
}
writeFileSync('../../public/plugins/filerobot-image-editor.js', code)
console.log(`written ${code.length} bytes${css ? ' (css inlined)' : ''}`)
