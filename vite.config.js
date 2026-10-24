import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 单页应用：index.html 就是地图
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: { host: true },
})
