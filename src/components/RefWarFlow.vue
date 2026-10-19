<script setup>
// 战争流程关键规则：纯查阅内容，从「战争遭遇」页面移出
import warflow from '../data/warflow.json'

// 摘要标题按 warflow.notes 的顺序给出；条目变多时新增的会退回「取前 14 字」
const LABELS = [
  '战争遭遇的结构', '战场位置', '地形特征', '打击规则', '远程打击', '溃败阈值',
  '动摇', '疲惫', '状态达到 4 即解散', '撤退', '溃败状态', '防御工事',
  '进攻奇策 · 六角格探索', '战斗中的玩家角色', '判定胜利', '判定失败', '经验奖励',
]
const labelOf = (text, i) => LABELS[i] || (text.slice(0, 14) + '…')
</script>

<template>
  <div class="panel">
    <h2>战争关键规则</h2>
    <details class="more" v-for="(n, i) in warflow.notes" :key="i">
      <summary>{{ labelOf(n, i) }}</summary>
      <p class="muted prose" style="margin: 6px 0 0">{{ n }}</p>
    </details>
  </div>
</template>
