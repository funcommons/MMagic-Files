import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // SDK 自测环境:注册空 i18n / pinia / Element Plus / matchMedia(见该文件)
    setupFiles: ['src/components/sdk/__tests__/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})