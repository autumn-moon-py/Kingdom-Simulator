<script setup>
// 军队装备条目：纯查阅内容，从「军团 → 军队装备」移出（那一页只保留实际的装备/转移操作）
import armyGear from '../data/armyGear.json'
</script>

<template>
  <div class="panel">
    <h2>军队装备</h2>
    <p class="muted">通过「装备军队」活动获取；用同类装备替换旧装备时，旧装备的 RP 花费可从新装备花费中扣除。装备等级不得超过军队等级。</p>
    <div v-for="g in armyGear" :key="g.name" style="margin-bottom: 16px">
      <p style="margin-bottom: 2px">
        <b>{{ g.name }}</b>
        <span class="tag">{{ g.price }}</span>
        <span class="muted" v-if="g.level">物品 {{ g.level }}</span>
        <span class="muted">{{ g.traits }}</span>
      </p>
      <p class="prose" style="margin-bottom: 4px">{{ g.text }}</p>
      <p class="muted" v-for="t in g.types" :key="t.name" style="margin-bottom: 2px">{{ t.name }}（{{ t.level }} 级，{{ t.price }}）：{{ t.effect }}</p>
    </div>
  </div>
</template>
