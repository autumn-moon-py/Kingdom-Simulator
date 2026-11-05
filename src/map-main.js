import { createApp } from 'vue'
import { fetchSave } from './persist.js'
import { applyRemote as applyMapSave } from './mapStore.js'
import { applyRemote as applyKingdomSave } from './kingdomStore.js'
import './style.css'

const UI_KEY = 'kingdom-map-ui-v1'

// 本地偏好优先：只有本地没有记录时才用文件存档兜底，避免旧存档覆盖刚改的选择
function applyUiPrefs(remote) {
  let local = null
  try { local = JSON.parse(localStorage.getItem(UI_KEY) || 'null') } catch (e) { /* 忽略 */ }
  const next = local || remote
  if (!next) return
  // 同时挂到全局，localStorage 不可用时 MapView 仍能读到文件存档里的偏好
  window.__kingdomUiPrefs = next
  try { localStorage.setItem(UI_KEY, JSON.stringify(next)) } catch (e) { /* 忽略 */ }
}

async function boot() {
  // 有文件存档时以文件为准；服务器不可用时继续用 localStorage
  const [map, kingdom, ui] = await Promise.all([
    fetchSave('kingdom-map-v1'),
    fetchSave('kingdom-manage-v1'),
    fetchSave(UI_KEY),
  ])
  // 地图存档带 savedAt：本地较新时不会被旧文件覆盖
  if (map) applyMapSave(map)
  if (kingdom) applyKingdomSave(kingdom)
  applyUiPrefs(ui)
  // 等偏好就位后再加载页面，避免 MapView 先读到空偏好
  const { default: MapPage } = await import('./components/MapPage.vue')
  createApp(MapPage).mount('#app')
}

boot()
