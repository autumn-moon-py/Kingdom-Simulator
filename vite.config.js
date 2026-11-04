import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { feishuSync } from './scripts/feishu-sync.js'

// 单页应用：index.html 就是地图
export default defineConfig({
  base: './',
  plugins: [vue(), feishuSync()],
  server: { host: true },
})
