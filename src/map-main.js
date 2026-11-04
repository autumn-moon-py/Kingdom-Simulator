import { createApp } from 'vue'
import MapPage from './components/MapPage.vue'
import { fetchSave } from './persist.js'
import { applyRemote as applyMapSave } from './mapStore.js'
import { applyRemote as applyKingdomSave } from './kingdomStore.js'
import './style.css'

async function boot() {
  // 有文件存档时以文件为准；服务器不可用时继续用 localStorage
  const [map, kingdom] = await Promise.all([
    fetchSave('kingdom-map-v1'),
    fetchSave('kingdom-manage-v1'),
  ])
  if (map) applyMapSave(map)
  if (kingdom) applyKingdomSave(kingdom)
  createApp(MapPage).mount('#app')
}

boot()
