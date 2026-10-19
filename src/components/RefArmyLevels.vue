<script setup>
// 基础军队按等级：纯查阅表，从「军团 → 等级表」移出
import { state } from '../store.js'
import armiesByLevel from '../data/armiesByLevel.json'
</script>

<template>
  <div class="panel">
    <details class="more">
      <summary>基础军队按等级（1–20 级对照表）</summary>
      <p class="muted" style="margin: 8px 0 0">王国升级时每支军队也升一级，按此表提升数值；最大战术数提高后，新战术要靠「训练军队」活动学习。高亮行是王国当前等级。</p>
      <table style="margin-top: 8px">
        <thead><tr><th>等级</th><th>侦察</th><th>标准DC</th><th>AC</th><th>高豁免</th><th>低豁免</th><th>攻击</th><th>最大战术</th></tr></thead>
        <tbody>
          <tr v-for="r in armiesByLevel" :key="r.level" :class="{ cur: r.level === state.level }">
            <td class="num">{{ r.level }}</td>
            <td class="num">{{ r.scout }}</td>
            <td class="num">{{ r.standardDC }}</td>
            <td class="num">{{ r.ac }}</td>
            <td class="num">{{ r.highSave }}</td>
            <td class="num">{{ r.lowSave }}</td>
            <td class="num">{{ r.attack }}</td>
            <td class="num">{{ r.maxTactics }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>

<style scoped>
tr.cur td { background: var(--cover-old); }
</style>
