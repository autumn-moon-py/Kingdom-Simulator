<script setup>
import { computed, reactive, ref } from 'vue'
import { state, resetKingdom, exportSaveFile, importSaveText } from '../kingdomStore.js'
import { state as mapState } from '../mapStore.js'
import {
  BUILDING_TIERS,
  EFFECT_KINDS,
  SETTLEMENT_TYPES,
  allowedDefs,
  buildBuilding,
  canBuild,
  canFoundSettlement,
  costText,
  countBuildingInstances,
  countEffectUsage,
  defaultBuildingDefs,
  defById,
  defLabel,
  demolishBuilding,
  effectSummary,
  foundSettlement,
  kingdomStats,
  newBuildingDef,
  newEffectDef,
  newSettlementCost,
  settlementStats,
  tierLabel,
  upgradeSettlement,
} from '../kingdom/model.js'

const tab = ref('play')
const message = ref('')
const picks = reactive({})
const fileInput = ref(null)
const pasting = ref(false)
const pasteText = ref('')

const stats = computed(() => kingdomStats(state))
const rows = computed(() => state.settlements.map((s) => ({ s, st: settlementStats(state, s) })))
const newCost = computed(() => newSettlementCost(state))
const foundCheck = computed(() => canFoundSettlement(state))
const recentLog = computed(() => state.log.slice(-12).reverse())
// 只认地图页里已占据的格子；存档里若还留着已取消占据的编号，也保留为可选项并标出
const claimedHexes = computed(() => Object.keys(mapState.hexClaimed || {}).sort())

function hexOptions(current) {
  const list = claimedHexes.value.slice()
  for (const code of current || []) if (!list.includes(code)) list.push(code)
  return list.sort()
}

function hexNote(code) {
  return (mapState.hexNotes || {})[code] || ''
}

function signed(value) {
  const n = Number(value) || 0
  return n >= 0 ? `+${n}` : `${n}`
}

function nameOf(defId) {
  const def = defById(state, defId)
  return def ? defLabel(def) : '未知建筑'
}

function defsFor(settlement) {
  return allowedDefs(state, settlement)
}

function pickOf(settlement) {
  const list = defsFor(settlement)
  const cur = picks[settlement.id]
  return list.some((d) => d.id === cur) ? cur : (list[0] ? list[0].id : '')
}

function setPick(settlement, defId) {
  picks[settlement.id] = defId
}

function selectedDef(settlement) {
  return defById(state, pickOf(settlement))
}

function buildCheck(settlement) {
  const id = pickOf(settlement)
  return id ? canBuild(state, settlement.id, id) : { ok: false, reason: '没有可建建筑' }
}

function build(settlement) {
  const id = pickOf(settlement)
  const result = buildBuilding(state, settlement.id, id)
  message.value = result.ok ? `已建成${nameOf(id)}。` : result.reason
}

function upgrade(settlement) {
  const result = upgradeSettlement(state, settlement.id)
  message.value = result.ok ? `已升级为${SETTLEMENT_TYPES[result.type].label}。` : result.reason
}

function remove(settlement, building) {
  const result = demolishBuilding(state, settlement.id, building.id)
  message.value = result.ok ? '已拆除，槽位空出。' : result.reason
}

function found() {
  const result = foundSettlement(state)
  message.value = result.ok ? `已新建${result.settlement.name}。` : result.reason
}

function addDef() {
  state.buildingDefs.unshift(newBuildingDef())
  message.value = '已新增建筑，展开建筑表后编辑。'
}

function removeDef(def) {
  const used = countBuildingInstances(state, def.id)
  if (used) {
    message.value = '先拆除已建成的该建筑，再删除定义。'
    return
  }
  const i = state.buildingDefs.findIndex((d) => d.id === def.id)
  if (i >= 0) state.buildingDefs.splice(i, 1)
  message.value = `已删除建筑定义：${def.name}。`
}

function addEffect(def) {
  const first = state.effectDefs[0]
  if (!first) {
    message.value = '先在效果类型里建立一个效果。'
    return
  }
  def.effects.push({ type: first.id, value: 0 })
}

function removeEffect(def, index) {
  def.effects.splice(index, 1)
}

function effectKind(effect) {
  const fx = state.effectDefs.find((e) => e.id === effect.type)
  return fx ? fx.kind : 'note'
}

function effectUnit(effect) {
  const fx = state.effectDefs.find((e) => e.id === effect.type)
  return fx ? fx.unit : ''
}

function usedDefText(defId) {
  const n = countBuildingInstances(state, defId)
  return n ? `已有 ${n} 座，拆除后才能删除定义。` : ''
}

function addEffectDef() {
  state.effectDefs.push(newEffectDef())
  message.value = '已新增效果类型，可在建筑效果里选用。'
}

function removeEffectDef(fx) {
  const used = countEffectUsage(state, fx.id)
  if (used) {
    message.value = '该效果仍被建筑使用，先从建筑上移除。'
    return
  }
  const i = state.effectDefs.findIndex((e) => e.id === fx.id)
  if (i >= 0) state.effectDefs.splice(i, 1)
  message.value = `已删除效果类型：${fx.label}。`
}

function effectUsageText(fxId) {
  const n = countEffectUsage(state, fxId)
  return n ? `被 ${n} 条建筑效果使用` : '未使用'
}

function kindHint(kind) {
  const hit = EFFECT_KINDS.find((k) => k.id === kind)
  return hit ? hit.hint : ''
}

function resetBuildings() {
  if (!window.confirm('恢复默认建筑表会覆盖当前所有建筑定义，并移除无法对应的已建建筑。继续？')) return
  const defs = defaultBuildingDefs()
  const known = new Set(defs.map((d) => d.id))
  state.buildingDefs = defs
  for (const settlement of state.settlements) {
    settlement.buildings = settlement.buildings.filter((b) => known.has(b.defId))
  }
  message.value = '已恢复默认建筑表。'
}

function resetGame() {
  if (!window.confirm('重置王国存档会清空当前国库、定居点、自定义建筑与效果。继续？')) return
  resetKingdom()
  for (const key of Object.keys(picks)) delete picks[key]
  message.value = '已重置王国存档。'
}

function exportSave() {
  exportSaveFile()
  message.value = '已导出王国存档。'
}

async function onFile(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  const text = await file.text()
  if (!importSaveText(text)) {
    message.value = '导入失败：文件不是有效的王国存档。'
    return
  }
  for (const key of Object.keys(picks)) delete picks[key]
  message.value = '已导入王国存档。'
}

function togglePaste() {
  pasting.value = !pasting.value
  if (!pasting.value) pasteText.value = ''
}

function importPaste() {
  if (!importSaveText(pasteText.value)) {
    message.value = '导入失败：粘贴内容不是有效的王国存档。'
    return
  }
  for (const key of Object.keys(picks)) delete picks[key]
  pasteText.value = ''
  pasting.value = false
  message.value = '已导入王国存档。'
}
</script>

<template>
  <section class="kingdom">
    <div class="head">
      <div>
        <h1>王国经营</h1>
        <p class="muted">劳力骰数量只作提示，外部掷好后把点数填进来；建筑与定居点建成即生效。</p>
      </div>
      <div class="stats">
        <div class="stat"><span>总人口</span><b>{{ stats.totalPopulation }}</b></div>
        <div class="stat"><span>劳力骰</span><b>{{ stats.laborDice }}d6</b></div>
        <label class="stat edit"><span>劳力点数</span><input type="number" min="0" v-model.number="state.laborPoints" /></label>
        <label class="stat edit"><span>p</span><input type="number" min="0" v-model.number="state.treasury" /></label>
        <label class="stat edit"><span>物资</span><input type="number" min="0" v-model.number="state.materials" /></label>
      </div>
    </div>

    <div v-if="message" class="actions">
      <span class="msg">{{ message }}</span>
    </div>
    <p class="muted summary">
      税收 {{ stats.tax }}p ＋ 建筑 {{ stats.buildingP }}p；建筑物资 {{ signed(stats.materials) }}；劳力加成 {{ signed(stats.laborBonus) }}d6。
    </p>

    <nav class="tabs">
      <button class="tab" :class="{ on: tab === 'play' }" @click="tab = 'play'">经营盘</button>
      <button class="tab" :class="{ on: tab === 'buildings' }" @click="tab = 'buildings'">建筑表</button>
      <button class="tab" :class="{ on: tab === 'effects' }" @click="tab = 'effects'">效果类型</button>
    </nav>

    <div v-if="tab === 'play'" class="play">
      <div class="settleGrid">
        <article v-for="{ s, st } in rows" :key="s.id" class="settle">
          <header class="shead">
            <input v-model="s.name" class="nameInput" aria-label="定居点名称" />
            <input v-model="s.alias" class="aliasInput" placeholder="别名" aria-label="定居点别名" />
            <span class="tag">{{ st.type.label }}</span>
            <span class="slotsNum">{{ st.used }}/{{ st.capacity }} 槽</span>
            <label class="check water"><input type="checkbox" v-model="s.water" /><span>临水</span></label>
          </header>
          <div class="hexRow">
            <span class="muted">地图格</span>
            <label v-for="code in hexOptions(s.hexes)" :key="code" class="check hexCheck" :title="hexNote(code)">
              <input type="checkbox" :value="code" v-model="s.hexes" />
              <span>{{ code }}</span>
            </label>
            <span v-if="!hexOptions(s.hexes).length" class="muted">暂无已占据格</span>
            <span v-if="s.hexes.some((h) => !claimedHexes.includes(h))" class="tag stale">含未占据</span>
          </div>
          <div class="flags">
            <span v-if="st.full && st.type.next" class="flag">槽位已满，可升级</span>
            <span v-if="st.full && st.type.next">
              <button class="mini" @click="upgrade(s)">升级为{{ SETTLEMENT_TYPES[st.type.next].label }}</button>
            </span>
            <span v-if="st.full && !st.type.next" class="flag">已是最高档</span>
            <span v-if="!st.totalCount" class="flag empty">空定居点</span>
          </div>
          <div class="metrics">
            <span>人口 <b>{{ st.population }}</b></span>
            <span>税收 <b>{{ st.tax }}p</b></span>
            <span>建筑产出 <b>{{ st.buildingP }}p</b></span>
            <span>物资 <b>{{ signed(st.materials) }}</b></span>
            <span v-if="st.laborBonus">劳力 <b>{{ signed(st.laborBonus) }}d6</b></span>
          </div>
          <div class="slotBar">
            <span v-for="n in st.capacity" :key="n" class="slot" :class="{ on: n <= st.used }"></span>
            <span v-if="!st.capacity" class="muted">无槽位</span>
          </div>
          <ul class="buildings">
            <li v-for="b in s.buildings" :key="b.id">
              <span class="bname">{{ nameOf(b.defId) }}</span>
              <span class="bdesc">{{ effectSummary(state, defById(state, b.defId)) }}</span>
              <button class="mini" @click="remove(s, b)">拆除</button>
            </li>
            <li v-if="!s.buildings.length" class="muted emptyLine">暂无建筑</li>
          </ul>
          <div class="buildRow">
            <select :value="pickOf(s)" :disabled="!defsFor(s).length" @change="setPick(s, $event.target.value)">
              <option v-for="d in defsFor(s)" :key="d.id" :value="d.id">{{ defLabel(d) }}｜{{ costText(d) }}</option>
            </select>
            <button class="act" :disabled="!buildCheck(s).ok" @click="build(s)">建造</button>
          </div>
          <p v-if="!buildCheck(s).ok" class="hint">{{ buildCheck(s).reason }}</p>
          <p v-else class="hint">
            {{ effectSummary(state, selectedDef(s)) }}；{{ costText(selectedDef(s)) }}，建成即生效。
          </p>
        </article>
      </div>

      <div class="found">
        <div>
          <b>新建定居点</b>
          <p class="muted">费用 {{ newCost.labor }} 劳力 · {{ newCost.p }}p · {{ newCost.materials }} 物资。建成一处 4 槽村庄，立即计入人口与劳力。</p>
        </div>
        <div class="foundAct">
          <button class="act" :disabled="!foundCheck.ok" @click="found">新建村庄</button>
          <span v-if="!foundCheck.ok" class="muted">{{ foundCheck.reason }}</span>
        </div>
      </div>

      <details class="more log">
        <summary>操作记录</summary>
        <ul>
          <li v-for="e in recentLog" :key="e.id">{{ e.text }}</li>
        </ul>
      </details>

      <div class="saveRow">
        <button class="mini" @click="exportSave">导出存档</button>
        <button class="mini" @click="togglePaste">{{ pasting ? '收起粘贴' : '粘贴导入' }}</button>
        <span class="muted">文件：</span>
        <input ref="fileInput" class="fileInput" type="file" accept=".json,application/json" @change="onFile" />
        <button class="mini danger" @click="resetGame">重置王国存档</button>
      </div>
      <div v-if="pasting" class="pasteBox">
        <textarea v-model="pasteText" class="pasteArea" rows="6" placeholder="粘贴王国存档 JSON"></textarea>
        <button class="act" :disabled="!pasteText.trim()" @click="importPaste">导入粘贴内容</button>
      </div>
    </div>

    <div v-if="tab === 'buildings'" class="tableTab">
      <header class="tabHead">
        <div>
          <h2>建筑表</h2>
          <p class="muted">这里改的名称、成本、槽位与效果会即时影响经营盘；已建成的建筑沿用当前定义。</p>
        </div>
        <div class="tabActs">
          <button class="act" @click="addDef">新增建筑</button>
          <button class="act" @click="resetBuildings">恢复默认</button>
        </div>
      </header>
      <div class="defList">
        <details v-for="d in state.buildingDefs" :key="d.id" class="def">
          <summary>
            <span class="sumName">{{ d.name || '未命名建筑' }}</span>
            <span v-if="d.alias" class="sumAlias">（{{ d.alias }}）</span>
            <span class="tag">{{ tierLabel(d.tier) }}</span>
            <span class="sumMeta">{{ d.slots }}槽 · {{ costText(d) }}</span>
            <span class="sumFx">{{ effectSummary(state, d) }}</span>
            <span v-if="d.requiresWater" class="tag">临水</span>
            <span v-if="d.limitPerSettlement" class="tag">限{{ d.limitPerSettlement }}</span>
          </summary>
          <div class="defBody">
            <div class="fields">
              <label class="field">名称<input v-model="d.name" /></label>
              <label class="field">别名<input v-model="d.alias" placeholder="如 住宅、庄园" /></label>
              <label class="field">档位
                <select v-model="d.tier">
                  <option v-for="t in BUILDING_TIERS" :key="t.id" :value="t.id">{{ t.label }}</option>
                </select>
              </label>
              <label class="field">槽位<input type="number" min="1" v-model.number="d.slots" /></label>
              <label class="field">劳力<input type="number" min="0" v-model.number="d.labor" /></label>
              <label class="field">p<input type="number" min="0" v-model.number="d.p" /></label>
              <label class="field">物资<input type="number" min="0" v-model.number="d.materials" /></label>
              <label class="field">每定居点上限（0不限）<input type="number" min="0" v-model.number="d.limitPerSettlement" /></label>
            </div>
            <label class="check"><input type="checkbox" v-model="d.requiresWater" /><span>需要临水</span></label>
            <label class="field full">说明<input v-model="d.description" /></label>
            <div class="fxBlock">
              <div class="fxHead">
                <span>效果</span>
                <button class="mini" @click="addEffect(d)">添加效果</button>
              </div>
              <div v-for="(e, i) in d.effects" :key="i" class="fxRow">
                <select v-model="e.type">
                  <option v-for="fx in state.effectDefs" :key="fx.id" :value="fx.id">{{ fx.label }}</option>
                </select>
                <input type="number" v-model.number="e.value" :disabled="effectKind(e) === 'note'" />
                <span class="unit muted">{{ effectUnit(e) }}</span>
                <button class="mini" @click="removeEffect(d, i)">移除</button>
              </div>
              <p v-if="!d.effects.length" class="muted">无效果</p>
            </div>
            <div class="defFoot">
              <button class="mini danger" :disabled="!!countBuildingInstances(state, d.id)" @click="removeDef(d)">删除建筑</button>
              <span v-if="usedDefText(d.id)" class="muted">{{ usedDefText(d.id) }}</span>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div v-if="tab === 'effects'" class="tableTab">
      <header class="tabHead">
        <div>
          <h2>效果类型</h2>
          <p class="muted">效果类型可自由增删。计算类型决定它如何进入经营盘；说明型效果只作记录。</p>
        </div>
        <div class="tabActs">
          <button class="act" @click="addEffectDef">新增效果类型</button>
        </div>
      </header>
      <div class="fxList">
        <div v-for="fx in state.effectDefs" :key="fx.id" class="fxDef">
          <div class="fields">
            <label class="field">名称<input v-model="fx.label" /></label>
            <label class="field">单位<input v-model="fx.unit" placeholder="如 人、p、颗" /></label>
            <label class="field">计算类型
              <select v-model="fx.kind">
                <option v-for="k in EFFECT_KINDS" :key="k.id" :value="k.id">{{ k.label }}</option>
              </select>
            </label>
          </div>
          <div class="fxDesc">
            <span class="muted">{{ kindHint(fx.kind) }}</span>
            <span class="muted">{{ effectUsageText(fx.id) }}</span>
            <button class="mini danger" :disabled="countEffectUsage(state, fx.id) > 0" @click="removeEffectDef(fx)">删除</button>
          </div>
        </div>
      </div>
      <div class="kindHelp">
        <p v-for="k in EFFECT_KINDS" :key="k.id"><b>{{ k.label }}</b>：{{ k.hint }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.kingdom { max-width: 1180px; margin: 0 auto; }

.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 16px 26px; }
.head h1 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: 0.04em; }
.head p { margin: 4px 0 0; font-size: 12px; }
.stats { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 18px; }
.stat { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--ink-2); }
.stat b { color: var(--ink); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat input { width: 82px; padding: 4px 7px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 16px; }
.msg { color: var(--ochre); font-size: 13px; }
.summary { margin: 8px 0 0; font-size: 12px; }

.tabs { display: flex; gap: 4px; margin: 24px 0 16px; border-bottom: 1px solid var(--rule); }
.tab {
  appearance: none; margin-bottom: -1px; padding: 8px 12px 7px;
  border: 0; border-bottom: 2px solid transparent; background: transparent;
  color: var(--ink-2); font: inherit; cursor: pointer;
}
.tab:hover { color: var(--ochre); }
.tab.on { color: var(--ink); border-bottom-color: var(--ochre); font-weight: 600; }

.settleGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.settle { min-width: 0; border: 1px solid var(--rule-soft); border-radius: 3px; padding: 14px 16px; }
.shead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.nameInput {
  flex: 1 1 120px; min-width: 90px; padding: 2px 0;
  border: 0; border-bottom: 1px solid var(--rule); border-radius: 0;
  background: transparent; font-size: 15px; font-weight: 600;
}
.nameInput:hover { border-bottom-color: var(--ochre-soft); }
.aliasInput {
  flex: 0 1 120px; min-width: 70px; padding: 2px 0;
  border: 0; border-bottom: 1px solid var(--rule); border-radius: 0;
  background: transparent; color: var(--ink-2); font-size: 13px;
}
.aliasInput:hover { border-bottom-color: var(--ochre-soft); }
.tag {
  padding: 0 5px; border: 1px solid var(--rule-soft); border-radius: 2px;
  background: var(--wash-ochre); color: var(--ochre);
  font-size: 11px; letter-spacing: 0.06em;
}
.slotsNum { color: var(--ink-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.water { font-size: 12px; color: var(--ink-2); }
.hexRow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 10px; color: var(--ink-2); font-size: 12px; }
.hexRow .check { margin: 0; font-size: 12px; }
.hexCheck { gap: 4px; }
.tag.stale { border-color: var(--warn); background: transparent; color: var(--warn); }
.flags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.flag { padding: 0 5px; border-radius: 2px; background: var(--cover-old); color: var(--ink-2); font-size: 11px; }
.flag.empty { background: transparent; }
.metrics { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; color: var(--ink-2); font-size: 12px; }
.metrics b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.slotBar { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.slot { display: block; width: 16px; height: 16px; border: 1px solid var(--rule); border-radius: 2px; background: var(--paper-2); }
.slot.on { border-color: var(--ochre); background: var(--wash-ochre); }

.buildings { list-style: none; margin: 10px 0 0; padding: 0; border-top: 1px solid var(--rule-soft); }
.buildings li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 5px 0; border-bottom: 1px solid var(--rule-soft); font-size: 12px; }
.bname { color: var(--ink); font-weight: 600; }
.bdesc { flex: 1 1 140px; min-width: 0; color: var(--ink-3); }
.emptyLine { color: var(--ink-3); padding: 5px 0; }
.mini {
  appearance: none; border: 0; background: transparent;
  padding: 2px 4px; color: var(--ink-2); font: inherit; font-size: 11px; cursor: pointer;
}
.mini:hover { color: var(--ochre); }
.mini.danger { color: var(--warn); }
.mini:disabled { color: var(--ink-3); cursor: not-allowed; }

.buildRow { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.buildRow select { flex: 1 1 150px; min-width: 0; }
.hint { margin: 6px 0 0; color: var(--ink-3); font-size: 11px; }

.found { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--rule-soft); }
.found p { margin: 4px 0 0; font-size: 12px; }
.foundAct { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }

.log { margin-top: 24px; }
.log ul { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12px; }
.log li { padding: 3px 0; border-bottom: 1px dotted var(--rule-soft); }
.saveRow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 14px; }
.fileInput { max-width: 180px; font: inherit; font-size: 11px; color: var(--ink-2); }
.pasteBox { margin-top: 10px; }
.pasteArea {
  width: 100%; padding: 6px 8px;
  border: 1px solid var(--rule); border-radius: 4px;
  background: var(--paper-2); color: var(--ink);
  font: inherit; font-size: 11px; resize: vertical;
}
.pasteBox .act { margin-top: 8px; }

.tabHead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px; }
.tabHead h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
.tabHead p { max-width: 640px; margin: 4px 0 0; font-size: 12px; }
.tabActs { display: flex; gap: 8px; }

.defList, .fxList { margin-top: 14px; border-top: 1px solid var(--rule); }
.def, .fxDef { border-bottom: 1px solid var(--rule-soft); }
.def > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 10px 0; cursor: pointer; list-style: none; font-size: 13px; }
.def > summary::-webkit-details-marker { display: none; }
.def > summary::before { content: "▸"; color: var(--ink-3); }
.def[open] > summary::before { content: "▾"; }
.sumName { font-weight: 600; }
.sumAlias { margin-left: -6px; color: var(--ink-3); }
.sumMeta { color: var(--ink-2); font-variant-numeric: tabular-nums; }
.sumFx { flex: 1 1 180px; color: var(--ink-3); }
.defBody { padding: 0 0 14px 20px; }
.fields { display: flex; flex-wrap: wrap; gap: 10px 14px; }
.field { display: flex; flex-direction: column; gap: 4px; color: var(--ink-2); font-size: 12px; }
.field input, .field select { min-width: 0; }
.field input[type="number"] { width: 84px; }
.field.full { margin-top: 10px; }
.field.full input { width: 100%; }
.check { display: flex; align-items: center; gap: 8px; margin: 10px 0; color: var(--ink-2); font-size: 12px; }

.fxBlock { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--rule-soft); }
.fxHead { display: flex; align-items: center; gap: 10px; color: var(--ink-2); font-size: 12px; font-weight: 600; }
.fxRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
.fxRow select { min-width: 150px; }
.fxRow input[type="number"] { width: 84px; }
.unit { font-size: 11px; }
.defFoot { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.fxDef { padding: 12px 0; }
.fxDesc { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; font-size: 12px; }
.kindHelp { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--rule-soft); color: var(--ink-3); font-size: 12px; }
.kindHelp p { margin: 0 0 6px; }
.kindHelp b { color: var(--ink-2); }

select {
  max-width: 100%; padding: 6px 8px;
  border: 1px solid var(--rule); border-radius: 4px;
  background: var(--paper-2); color: var(--ink); font: inherit;
}
select:hover { border-color: var(--rule-hover); }

@media (max-width: 900px) {
  .settleGrid { grid-template-columns: 1fr; }
}
</style>
