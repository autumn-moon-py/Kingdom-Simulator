<script setup>
// 独立查询页（query.html）：承载全部「查阅型」内容，主界面只留操作。
// 与主页面共用 store.js 的同一份 localStorage；store.js 内注册了 storage 监听做跨页同步。
import { ref } from 'vue'
import Compendium from './Compendium.vue'
import Reference from './Reference.vue'
import RefTactics from './RefTactics.vue'
import RefWarFlow from './RefWarFlow.vue'
import RefGear from './RefGear.vue'
import RefArmyLevels from './RefArmyLevels.vue'
import PageToc from './PageToc.vue'

const SECTIONS = [
  { key: 'compendium', label: '图鉴' },
  { key: 'reference', label: '规则参考' },
  { key: 'tactics', label: '战术与动作' },
  { key: 'warflow', label: '战争关键规则' },
  { key: 'gear', label: '军队装备' },
  { key: 'levels', label: '军队等级表' },
]
const sec = ref('compendium')
</script>

<template>
  <header>
    <h1>查询 · 拥王者 王国模拟器</h1>
    <nav>
      <button v-for="s in SECTIONS" :key="s.key" :class="{ active: sec === s.key }" @click="sec = s.key">{{ s.label }}</button>
      <a class="back" href="./index.html">← 返回模拟器</a>
    </nav>
  </header>
  <main>
    <Compendium v-if="sec === 'compendium'" />
    <Reference v-else-if="sec === 'reference'" />
    <RefTactics v-else-if="sec === 'tactics'" />
    <RefWarFlow v-else-if="sec === 'warflow'" />
    <RefGear v-else-if="sec === 'gear'" />
    <RefArmyLevels v-else />
  </main>
  <PageToc :enabled="sec === 'reference'" />
</template>

<style scoped>
.back {
  margin-left: auto;
  padding-bottom: 10px;
  font-size: 14px;
  color: var(--ink-2);
  text-decoration: none;
}
.back:hover { color: var(--ochre); }
</style>
