<script setup>
import { ref, computed } from 'vue'
import { state, buildingAutoEffects, questReady, questTriggerText, questRewardText, setQuest, publishQuest, applyQuestReward, toggleDip, QUEST_STATES } from '../store.js'
import buildings from '../data/buildings.json'
import events from '../data/events.json'
import quests from '../data/quests.json'
import groups from '../data/groups.json'

const kind = ref('building')
const q = ref('')

const buildingList = computed(() => match(buildings, ['名称', '特质', '物品加值', '效果', '花费']))
const eventList = computed(() => match(events, ['名称', '特质', '事件', '王国技能']))

// 任务的触发判定、触发/奖励文案、状态与外交操作都放在 store.js（与主页面共用）
const questList = computed(() => {
  const k = q.value.trim()
  if (!k) return quests
  return quests.filter((t) => [t.name, t.source, t.task, t.done, questRewardText(t), questTriggerText(t)].join(' ').includes(k))
})

function match(arr, keys) {
  const k = q.value.trim()
  if (!k) return arr
  return arr.filter((x) => keys.map((key) => x[key] || '').join(' ').includes(k))
}

function buildingEffect(b) {
  const parts = []
  if (b['物品加值']) parts.push('物品加值：' + b['物品加值'])
  if (b['祸患']) parts.push('祸患：' + b['祸患'])
  const auto = buildingAutoEffects(b['效果']).map((e) => e.label)
  if (auto.length) parts.push('自动结算：' + auto.join('，'))
  if (b['效果']) parts.push(b['效果'])
  return parts.join('；')
}
</script>

<template>
  <div class="panel">
    <h2>图鉴</h2>
    <nav class="tabs">
      <button :class="{ active: kind === 'building' }" @click="kind = 'building'">建筑</button>
      <button :class="{ active: kind === 'event' }" @click="kind = 'event'">王国事件</button>
      <button :class="{ active: kind === 'quest' }" @click="kind = 'quest'">王国任务</button>
      <button :class="{ active: kind === 'dip' }" @click="kind = 'dip'">外交关系</button>
    </nav>
    <div class="row" style="margin-top: 12px" v-if="kind !== 'dip'">
      <input v-model="q" placeholder="搜索名称或正文" style="flex: 1; min-width: 200px" />
    </div>
  </div>

  <div class="panel" v-if="kind === 'building'">
    <table>
      <thead>
        <tr><th style="width: 130px">建筑</th><th style="width: 52px">等级</th><th style="width: 52px">地块</th><th style="width: 380px">花费</th><th>效果</th></tr>
      </thead>
      <tbody>
        <tr v-for="b in buildingList" :key="b.名称">
          <td><b>{{ b.名称 }}</b></td>
          <td>{{ b.等级 }}</td>
          <td>{{ b.地块 }}</td>
          <td>{{ b.花费 }}</td>
          <td>
            <details class="more"><summary>效果</summary><div class="prose" style="margin-top: 4px">{{ buildingEffect(b) }}</div></details>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="muted" v-if="!buildingList.length">没有匹配的建筑。</p>
  </div>

  <div class="panel" v-else-if="kind === 'event'">
    <div v-for="e in eventList" :key="e.名称">
      <details class="more">
        <summary>{{ e.名称 }}<span class="muted">　调整值 {{ e.调整值 }}{{ e.特质 ? ' · ' + e.特质 : '' }}</span></summary>
        <p style="margin: 6px 0 0">{{ e.事件 }}</p>
        <p class="muted" style="margin: 4px 0 0" v-if="e['王国技能']">{{ e['王国技能'] }}</p>
      </details>
    </div>
    <p class="muted" v-if="!eventList.length">没有匹配的事件。</p>
  </div>

  <div class="panel" v-else-if="kind === 'quest'">
    <p class="muted">任务按触发条件自动检测：条件达成且尚未开始时，会在顶部提示「新王国任务可发布」，并在此页标出「可发布」。状态记录在本机。</p>
    <div v-for="t in questList" :key="t.name" style="margin-bottom: 18px">
      <p style="margin-bottom: 4px">
        <b>{{ t.name }}</b>
        <span class="tag">{{ state.questStatus[t.name] || '未开始' }}</span>
        <span class="tag" v-if="questReady(t) && (state.questStatus[t.name] || '未开始') === '未开始'" style="color: var(--warn)">可发布</span>
      </p>
      <p class="muted prose" style="margin: 0 0 4px">触发：{{ questTriggerText(t) }}</p>
      <p class="muted prose" style="margin: 0 0 4px">来源：{{ t.source }}</p>
      <p class="prose" style="margin: 0 0 4px">任务：{{ t.task }}</p>
      <p class="prose" style="margin: 0 0 4px">完成：{{ t.done }}</p>
      <p class="muted prose" style="margin: 0 0 6px">奖励：{{ questRewardText(t) }}</p>
      <div class="row">
        <select :value="state.questStatus[t.name] || '未开始'" @change="setQuest(t.name, $event.target.value)" style="min-width: 110px">
          <option v-for="s in QUEST_STATES" :key="s">{{ s }}</option>
        </select>
        <button class="act" v-if="questReady(t) && (state.questStatus[t.name] || '未开始') === '未开始'" @click="publishQuest(t.name)">发布任务</button>
        <button class="act" v-if="(state.questStatus[t.name] || '未开始') === '已完成' && !state.questAwarded[t.name]" @click="applyQuestReward(t)">应用奖励</button>
        <span class="tag" v-if="state.questAwarded[t.name]">奖励已应用</span>
      </div>
    </div>
    <p class="muted" v-if="!questList.length">没有匹配的任务。</p>
  </div>

  <div class="panel" v-else>
    <p class="muted">
      与一个群体建立外交关系后，才能使用订立贸易协定与请求外援；特种军队也必须先与该群体建交，再用治国检定征募，每个群体只能征募一支。
    </p>
    <table>
      <thead><tr><th style="width: 190px">群体</th><th style="width: 150px">性质</th><th style="width: 110px">已建交</th><th style="width: 170px">可征募的特种军队</th><th>备注</th></tr></thead>
      <tbody>
        <tr v-for="g in groups" :key="g.name">
          <td>{{ g.name }}</td>
          <td class="muted">{{ g.kind }}</td>
          <td>
            <label class="check">
              <input type="checkbox" :checked="!!state.diplomacy[g.name]" @change="toggleDip(g.name)" />
              <span>{{ state.diplomacy[g.name] ? '已建交' : '未建交' }}</span>
            </label>
          </td>
          <td class="muted">{{ g.army || '—' }}</td>
          <td class="muted">{{ g.note }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 20px; margin-bottom: 4px; }
.tabs button { appearance: none; border: 0; background: transparent; padding: 0 0 8px; font: inherit; font-size: 14px; color: var(--ink-2); cursor: pointer; border-bottom: 2px solid transparent; }
.tabs button.active { color: var(--ink); font-weight: 600; border-bottom-color: var(--ochre); }
</style>
