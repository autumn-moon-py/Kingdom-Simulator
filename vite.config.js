import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// 两个入口：index.html（操作台）与 query.html（独立查询页）
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        query: fileURLToPath(new URL('./query.html', import.meta.url)),
      },
    },
  },
})
