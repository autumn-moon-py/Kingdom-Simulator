<script setup>
import { ref, computed } from 'vue'
import { state, questsReady, publishQuest } from './store.js'
import { hintText } from './hintBus.js'
import KingdomSheet from './components/KingdomSheet.vue'
import Founder from './components/Founder.vue'
import TurnWizard from './components/TurnWizard.vue'
import Towns from './components/Towns.vue'
import WarTab from './components/WarTab.vue'
import MapView from './components/MapView.vue'
import PageToc from './components/PageToc.vue'

const tab = ref(state.founded ? 'sheet' : 'found')   // 王国尚未建立时先落到「建国」

// 王国任务自动触发：判定逻辑在 store.js（与查询页共用），此处只在顶部提示「可发布」
const readyQuests = computed(() => questsReady())
function ackQuest(name) {
  state.questAcked = state.questAcked || {}
  state.questAcked[name] = true
}
</script>

<template>
  <header>
    <h1>拥王者 · 王国模拟器</h1>
    <nav>
      <button :class="{ active: tab === 'sheet' }" @click="tab = 'sheet'">王国卡</button>
      <button :class="{ active: tab === 'found' }" @click="tab = 'found'">建国</button>
      <button :class="{ active: tab === 'turn' }" @click="tab = 'turn'">回合</button>
      <button :class="{ active: tab === 'towns' }" @click="tab = 'towns'">聚落</button>
      <button :class="{ active: tab === 'war' }" @click="tab = 'war'">军团</button>
      <button :class="{ active: tab === 'map' }" @click="tab = 'map'">地图</button>
      <a class="query" href="./query.html" target="_blank" rel="noopener">查询</a>
      <span class="ruleset" title="PF2e：桌上掷 d20 并录入；鼠鼠：桌上掷 2d6/3d6，界面只录结果档">
        <button :class="{ active: state.ruleset !== 'mouse' }" @click="state.ruleset = 'pf2e'">PF2e</button>
        <button :class="{ active: state.ruleset === 'mouse' }" @click="state.ruleset = 'mouse'">鼠鼠</button>
        <label v-if="state.ruleset === 'mouse'">基准
          <input type="number" v-model.number="state.mouseBase" title="检定转换的基准加值，默认 0" />
        </label>
      </span>
    </nav>
  </header>
  <main>
    <div v-if="!state.founded && tab !== 'found'" class="founding">
      <p><b>王国尚未建立</b><span class="muted">　先按王国规则的 9 步建立王国，回合流程才会正确运转。</span>
        <button class="act" @click="tab = 'found'">去建国</button>
      </p>
    </div>
    <div v-if="readyQuests.length" class="questAlert">
      <p class="qt">新王国任务可发布</p>
      <p v-for="q in readyQuests" :key="q.name" class="qi">
        <b>{{ q.name }}</b><span class="muted">　{{ q.source }}</span>
        <button class="act" @click="publishQuest(q.name)">发布任务</button>
        <button class="act" @click="ackQuest(q.name)">知道了</button>
      </p>
    </div>
    <KingdomSheet v-if="tab === 'sheet'" />
    <Founder v-else-if="tab === 'found'" @go="tab = $event" />
    <TurnWizard v-else-if="tab === 'turn'" />
    <Towns v-else-if="tab === 'towns'" />
    <WarTab v-else-if="tab === 'war'" />
    <MapView v-else />
  </main>
  <PageToc :enabled="['sheet', 'turn', 'towns', 'war'].includes(tab)" />
  <div v-if="hintText" class="hintbar" role="tooltip">
    <span>{{ hintText }}</span>
    <button class="act x" @click="hintText = ''">知道了</button>
  </div>
</template>

<style scoped>
.founding { background: var(--wash-ochre); border: 1px solid var(--ochre-soft); border-radius: 3px; padding: 8px 14px; margin-bottom: 14px; font-size: 14px; }
.founding p { margin: 0; }
.query { margin-left: auto; padding-bottom: 10px; font-size: 14px; letter-spacing: 0.02em; color: var(--ink-2); text-decoration: none; }
.query:hover { color: var(--ochre); }
.ruleset { display: flex; align-items: center; gap: 4px; padding-bottom: 8px; font-size: 13px; }
.ruleset button { appearance: none; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink-2); border-radius: 3px; padding: 3px 8px; font: inherit; cursor: pointer; }
.ruleset button.active { border-color: var(--ochre); background: var(--wash-ochre); color: var(--ochre); font-weight: 600; }
.ruleset label { display: flex; align-items: center; gap: 4px; color: var(--ink-2); font-size: 12px; }
.ruleset input { width: 52px; }
.questAlert { border: 1px solid var(--ochre); background: var(--wash-ochre); border-radius: 3px; padding: 12px 14px; margin-bottom: 16px; }
.questAlert .qt { margin: 0 0 8px; font-weight: 600; }
.qi { margin: 0 0 6px; font-size: 13px; }
/* 横幅里的两个按钮原来只靠空格分开（实测 0px 相接） */
.qi .act { margin-left: 8px; }
</style>
