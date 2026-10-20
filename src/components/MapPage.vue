<script setup>
import MapView from './MapView.vue'
</script>

<template>
  <header class="mapHead">
    <a class="back" href="./index.html">← 返回</a>
    <span class="title">地图</span>
  </header>
  <main class="wide">
    <MapView />
  </main>
</template>

<style scoped>
.mapHead { display: flex; align-items: center; gap: 14px; padding: 10px 24px; }
.back { color: var(--ink-2); text-decoration: none; font-size: 14px; letter-spacing: 0.02em; }
.back:hover { color: var(--ochre); }
.title { font-size: 13px; color: var(--ink-2); letter-spacing: 0.12em; }
.wide { max-width: 1500px; }
</style>
