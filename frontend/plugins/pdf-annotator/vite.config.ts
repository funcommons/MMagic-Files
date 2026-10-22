import { defineConfig } from 'vite'

// 单文件 ESM（对齐 univer-office 先例）：inlineDynamicImports（blob import 无相对 chunk）+
// process 桩（esbuild define 只收无括号字面量）；pdf.js worker 以 ?worker&inline 内联为 Blob
export default defineConfig({
  define: {
    process: '{"env":{},"browser":true,"versions":{},"platform":"browser","stderr":{},"stdout":{}}',
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'pdf-annotator.js',
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
