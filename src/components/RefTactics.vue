<script setup>
// 战术与动作：纯查阅内容，从操作界面移出（见「军团 → 战争遭遇」里按需展开的按钮）
import tacticsData from '../data/tactics.json'

const actions = tacticsData.actions || []
const tactics = tacticsData.tactics || []
</script>

<template>
  <div class="panel">
    <h2>战术战争动作</h2>
    <p class="muted">交战中每支军队可用的动作；每个动作消耗若干次「战争动作」。</p>
    <div v-for="a in actions" :key="a.name">
      <details class="more">
        <summary>{{ a.name }}<span class="tag" style="margin-left: 8px" v-if="a.type">{{ a.type }}</span></summary>
        <p class="prose" style="margin: 6px 0 0">{{ a.effect }}</p>
      </details>
    </div>
  </div>

  <div class="panel">
    <h2>军队战术</h2>
    <p class="muted">军队在组建或「训练军队」时学习；每条战术标出对应等级。</p>
    <div v-for="t in tactics" :key="t.name">
      <details class="more">
        <summary>{{ t.name }}<span class="tag" style="margin-left: 8px">{{ t.requirement }}</span></summary>
        <p class="prose" style="margin: 6px 0 0">{{ t.effect }}</p>
      </details>
    </div>
  </div>
</template>
