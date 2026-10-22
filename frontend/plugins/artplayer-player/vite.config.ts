import { defineConfig } from 'vite'

// 单文件 ESM（对齐 markdown-editor 先例）：inlineDynamicImports + process 桩；
// artplayer ~150KB min 全内联，目标产物 ≤500KB（方案 §三）
export default defineConfig({
  define: {
    process: '{"env":{},"browser":true,"versions":{},"platform":"browser","stderr":{},"stdout":{}}',
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'artplayer-player.js',
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
