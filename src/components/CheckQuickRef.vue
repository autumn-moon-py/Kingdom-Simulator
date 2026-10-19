<script setup>
import { ref, computed } from 'vue'
import { state } from '../store.js'
import { mouseDC, luckDie } from '../rules.js'

const props = defineProps({
  dc: { type: [Number, String], default: 0 },
  flat: { type: Boolean, default: false },
  side: { type: String, default: 'right' },
})
const emit = defineEmits(['close'])

const mode = ref(props.flat ? 'flat' : 'normal')
const showTable = ref(false)
const dcInput = ref(String(Number(props.dc) || 14))
const checkDC = computed(() => Number(props.dc) || 0)
const dc = computed(() => {
  const n = Number(dcInput.value)
  return Number.isFinite(n) && n > 0 ? n : 0
})
const preview = computed(() => (
  mode.value === 'normal'
    ? `2d6 DC ${mouseDC(dc.value, state.mouseBase)}`
    : `幸运骰 ${luckDie(dc.value)}-in-6`
))
const current = computed(() => (
  props.flat
    ? `幸运骰 ${luckDie(checkDC.value)}-in-6`
    : `2d6 DC ${mouseDC(checkDC.value, state.mouseBase)}`
))

const rows = [
  { dc: 4, k: 2, luck: 6 },
  { dc: 5, k: 3, luck: 5 },
  { dc: 10, k: 5, luck: 4 },
  { dc: 11, k: 5, luck: 3 },
  { dc: 14, k: 6, luck: 3 },
  { dc: 16, k: 7, luck: 2 },
  { dc: 18, k: 8, luck: 1 },
  { dc: 20, k: 9, luck: 1 },
  { dc: 23, k: 10, luck: 1 },
  { dc: 25, k: 12, luck: 1 },
]
</script>

<template>
  <div class="quickPanel" :class="side" role="dialog" aria-label="鼠鼠检定速查">
    <div class="qpHead">
      <b>鼠鼠速查</b>
      <button class="act qpX" title="关闭" @click="emit('close')">×</button>
    </div>

    <div class="qpCurrent">
      <span class="muted">本次：PF DC {{ checkDC }}</span>
      <b>{{ current }}</b>
    </div>

    <div class="qpRow">
      <label>PF DC</label>
      <input v-model="dcInput" type="number" min="1" style="width: 50px" />
      <span class="qpSeg">
        <button :class="{ on: mode === 'normal' }" @click="mode = 'normal'">普通</button>
        <button :class="{ on: mode === 'flat' }" @click="mode = 'flat'">平值</button>
      </span>
    </div>
    <div class="qpRow qpPreviewRow">
      <span class="muted">换算</span>
      <b class="qpOut">{{ preview }}</b>
      <button class="act qpMore" @click="showTable = !showTable">{{ showTable ? '收起表' : '速查表' }}</button>
    </div>

    <table v-if="showTable" class="qpTable">
      <thead>
        <tr><th>PF DC</th><th>普通 2d6</th><th>平值幸运骰</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.dc">
          <td class="num">{{ r.dc === 25 ? '25+' : r.dc }}</td>
          <td class="num">{{ r.k }}</td>
          <td class="num">{{ r.luck }}-in-6</td>
        </tr>
      </tbody>
    </table>

    <p v-if="showTable" class="qpNote">2d6 + 背景/优势；双 1 大失败、双 6 大成功。建筑与熟练加值由桌上折算。</p>
  </div>
</template>

<style scoped>
.quickPanel {
  position: absolute;
  top: 0;
  z-index: 40;
  width: 228px;
  max-height: calc(100vh - 120px);
  overflow: auto;
  padding: 9px 11px 10px;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-shadow: 0 6px 18px rgba(40, 30, 10, 0.12);
  font-size: 12px;
}
.quickPanel.right { left: calc(100% + 10px); }
.quickPanel.left { right: calc(100% + 10px); }
.qpHead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.qpHead b { font-size: 13px; letter-spacing: 0.04em; }
.qpX { padding: 1px 7px !important; font-size: 13px !important; line-height: 1.3; }
.qpCurrent { display: flex; align-items: baseline; gap: 6px; padding: 6px 8px; margin-bottom: 7px; background: var(--wash-ochre); border-left: 2px solid var(--ochre); }
.qpCurrent b { color: var(--ochre); font-variant-numeric: tabular-nums; }
.qpRow { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.qpRow + .qpRow { border-top: 1px solid var(--rule-soft); margin-top: 3px; padding-top: 6px; }
.qpSeg { display: inline-flex; border: 1px solid var(--rule); border-radius: 3px; overflow: hidden; }
.qpSeg button { appearance: none; border: 0; background: var(--paper-2); color: var(--ink-2); font: inherit; padding: 2px 7px; cursor: pointer; }
.qpSeg button + button { border-left: 1px solid var(--rule); }
.qpSeg button.on { background: var(--wash-ochre); color: var(--ochre); font-weight: 600; }
.qpOut { margin-left: auto; color: var(--ochre); font-variant-numeric: tabular-nums; }
.qpMore { padding: 2px 7px !important; font-size: 11px !important; color: var(--ink-2); }
.qpRow .qpSeg { margin-left: auto; }
.qpTable { width: 100%; margin-top: 7px; border-collapse: collapse; }
.qpTable th { color: var(--ink-2); font-weight: 500; text-align: left; padding: 3px 2px; border-bottom: 1px solid var(--rule); }
.qpTable td { padding: 3px 2px; border-bottom: 1px solid var(--rule-soft); }
.qpTable th:not(:first-child), .qpTable td:not(:first-child) { text-align: right; }
.qpNote { margin: 7px 0 0; color: var(--ink-3); line-height: 1.45; }
@media (max-width: 900px) {
  .quickPanel { position: static; width: 100%; margin-top: 6px; }
}
</style>
