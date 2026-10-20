import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// 三个入口：index.html（操作台）、query.html（独立查询页）、map.html（独立地图页）
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        query: fileURLToPath(new URL('./query.html', import.meta.url)),
        map: fileURLToPath(new URL('./map.html', import.meta.url)),
      },
    },
  },
})
