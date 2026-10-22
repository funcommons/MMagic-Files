import { defineConfig } from 'vite'

// 单文件 ESM（对齐 html-editor 口径）：inlineDynamicImports（pptx-preview 内部依赖 echarts/jszip
// 全量内联成单体）+ process 桩；产物 ~1.5MB 级，懒加载（装载插件时才拉取）。
export default defineConfig({
  define: {
    process: '{"env":{},"browser":true,"versions":{},"platform":"browser","stderr":{},"stdout":{}}',
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'pptx-viewer.js',
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
