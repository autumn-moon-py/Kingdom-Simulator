<script setup>
import { ref, computed, watch } from 'vue'
import MapView from './MapView.vue'
import KingdomView from './KingdomView.vue'

const VIEW_KEY = 'kingdom-tools-view-v1'
// 启动视图：VITE_DEFAULT_VIEW 优先，其次上次选择，最后地图
const ENV_VIEW = ['map', 'kingdom'].includes(import.meta.env.VITE_DEFAULT_VIEW)
  ? import.meta.env.VITE_DEFAULT_VIEW
  : ''
function loadView() {
  if (ENV_VIEW) return ENV_VIEW
  if (typeof localStorage === 'undefined') return 'map'
  try {
    return localStorage.getItem(VIEW_KEY) === 'kingdom' ? 'kingdom' : 'map'
  } catch (e) {
    return 'map'
  }
}

const view = ref(loadView())
watch(view, (value) => {
  try { localStorage.setItem(VIEW_KEY, value) } catch (e) { /* 忽略 */ }
})

// 两页都缓存：切回来时选中格、搜索、图幅和列区域设置都还在
const pages = { map: MapView, kingdom: KingdomView }
const page = computed(() => pages[view.value])
</script>

<template>
  <main class="wide" :class="'view-' + view">
    <nav class="viewTabs">
      <button class="viewTab" :class="{ on: view === 'map' }" @click="view = 'map'">战役地图</button>
      <button class="viewTab" :class="{ on: view === 'kingdom' }" @click="view = 'kingdom'">王国经营</button>
    </nav>
    <KeepAlive>
      <component :is="page" />
    </KeepAlive>
  </main>
</template>

<style scoped>
.wide { max-width: 1500px; padding-left: 92px; }
.wide.view-map { padding-top: 0; }
.wide.view-kingdom { padding-right: 60px; }
.viewTabs {
  position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 40;
  display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 16px 10px;
  border-bottom: 0; border-right: 1px solid var(--rule); background: var(--paper);
}
.viewTab {
  appearance: none; margin-bottom: 0; padding: 18px 10px;
  border: 0; border-left: 2px solid transparent; background: transparent;
  color: var(--ink-2); font: inherit; font-size: 15px; letter-spacing: 0.2em;
  line-height: 1; writing-mode: vertical-rl; cursor: pointer;
}
.viewTab:hover { color: var(--ochre); }
.viewTab.on { color: var(--ink); border-left-color: var(--ochre); font-weight: 600; }
@media (max-width: 760px) {
  .wide { padding-left: 64px; }
  .wide.view-kingdom { padding-right: 24px; }
  .viewTabs { padding: 12px 6px; }
  .viewTab { padding: 14px 7px; font-size: 13px; letter-spacing: 0.16em; }
}
</style>
