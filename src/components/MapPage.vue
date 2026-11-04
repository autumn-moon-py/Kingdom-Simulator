<script setup>
import { ref, watch } from 'vue'
import MapView from './MapView.vue'
import KingdomView from './KingdomView.vue'

const VIEW_KEY = 'kingdom-tools-view-v1'
function loadView() {
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
</script>

<template>
  <main class="wide">
    <nav class="viewTabs">
      <button class="viewTab" :class="{ on: view === 'map' }" @click="view = 'map'">战役地图</button>
      <button class="viewTab" :class="{ on: view === 'kingdom' }" @click="view = 'kingdom'">王国经营</button>
    </nav>
    <MapView v-if="view === 'map'" />
    <KingdomView v-else />
  </main>
</template>

<style scoped>
.wide { max-width: 1500px; }
.viewTabs { display: flex; gap: 4px; margin: 0 0 18px; border-bottom: 1px solid var(--rule); }
.viewTab {
  appearance: none; margin-bottom: -1px; padding: 9px 14px 8px;
  border: 0; border-bottom: 2px solid transparent; background: transparent;
  color: var(--ink-2); font: inherit; font-size: 13px; letter-spacing: 0.08em; cursor: pointer;
}
.viewTab:hover { color: var(--ochre); }
.viewTab.on { color: var(--ink); border-bottom-color: var(--ochre); font-weight: 600; }
</style>
