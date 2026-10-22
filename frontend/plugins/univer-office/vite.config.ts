import { defineConfig } from 'vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

// 单文件 ESM 插件：Univer 样式经 JS 注入（blob import 无独立 CSS 通道），
// 全依赖内联（宿主加载器 fetch 字节 → SRI → import(blobUrl)，bare specifier 不可用）
export default defineConfig({
  plugins: [cssInjectedByJs()],
  define: {
    // blob import 无 Node 全局——整个 process 标识符替换为浏览器桩（覆盖 env/versions/nextTick/typeof 等全部形态）
    process: '{"env":{},"browser":true,"versions":{},"platform":"browser","stderr":{},"stdout":{}}',
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'univer-office.js',
    },
    outDir: '../../public/plugins',
    emptyOutDir: false,
    minify: true,
    target: 'es2020',
    chunkSizeWarningLimit: 20000,
    rollupOptions: {
      output: {
        // 宿主加载器 import(blobUrl)：相对 chunk 解析不到 → 必须单文件内联
        inlineDynamicImports: true,
      },
    },
  },
})
