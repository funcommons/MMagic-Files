import { defineConfig } from 'vite'

// 单文件 ESM（对齐 pdf-annotator/univer-office 先例）：inlineDynamicImports（blob import 无相对 chunk）+
// process 桩（esbuild define 只收无括号字面量）；依赖全部内联（mermaid/codemirror 无 worker 需求）
export default defineConfig({
  define: {
    process: '{"env":{},"browser":true,"versions":{},"platform":"browser","stderr":{},"stdout":{}}',
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'markdown-editor.js',
    },
    outDir: '../../public/plugins',
    emptyOutDir: false,
    minify: true,
    target: 'es2020',
    chunkSizeWarningLimit: 20000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
