import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import pkg from './package.json'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'pinia', 'vue-i18n'],
      dts: 'auto-imports.d.ts',
      eslintrc: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`
      }
    }
  },
  server: {
    port: 9330,
    open: true,
    // 纯前端 0 后端架构 (S3 直连), 默认无代理;
    // iframe 嵌入/OEM 多租户联调时允许生产域名 Host 头穿透
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.lhs11.com'
    ]
  },
  build: {
    // 拆分大依赖到独立 chunk, 避免 500kB 警告
    rollupOptions: {
      output: {
        manualChunks: {
          // Vue 运行时 + 路由 + 状态管理
          'vue-vendor': ['vue', 'vue-router', 'pinia', 'vue-i18n'],
          // UI 库
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
        },
      },
    },
    // 单 chunk 报警阈值 (kB); element-plus 完整包约 1MB, 业务依赖都在此阈值之下
    chunkSizeWarningLimit: 1100,
  }
})
