<script setup>
import { computed, reactive, ref } from 'vue'
import { state, resetKingdom, exportSaveFile, importSaveText } from '../kingdomStore.js'
import { state as mapState } from '../mapStore.js'
import {
  BUILDING_TIERS,
  EFFECT_KINDS,
  GROWTH_RATES,
  SETTLEMENT_TYPES,
  allowedDefs,
  ambitionStatus,
  buildBuilding,
  clearBuildings,
  costText,
  countBuildingInstances,
  countEffectUsage,
  defaultBuildingDefs,
  defaultOptions,
  defById,
  defLabel,
  demolishBuilding,
  effectSummary,
  foundSettlement,
  kingdomStats,
  maintenanceCost,
  newBuildingDef,
  newEffectDef,
  newSettlementCost,
  settleMaintenance,
  settlementStats,
  tierLabel,
  upgradeSettlement,
} from '../kingdom/model.js'

// 兼容热更新与旧存档：内存里的状态可能还没有 options
if (!state.options) state.options = defaultOptions()

const tab = ref('play')
const message = ref('')
const picks = reactive({})
const issues = reactive({})
const fileInput = ref(null)
const pasting = ref(false)
const pasteText = ref('')

const stats = computed(() => kingdomStats(state))
const rows = computed(() => state.settlements.map((s) => ({ s, st: settlementStats(state, s) })))
const newCost = computed(() => newSettlementCost(state))
const ambitions = computed(() => ambitionStatus(state))
const ambitionDone = computed(() => ambitions.value.filter((a) => a.done).length)
const maintenance = computed(() => maintenanceCost(state))
const growthList = computed(() => Object.values(GROWTH_RATES))
// 只认地图页里已占据的格子；存档里若还留着已取消占据的编号，也保留为可选项并标出
const claimedHexes = computed(() => Object.keys(mapState.hexClaimed || {}).sort())
const recentLog = computed(() => state.log.slice(-12).reverse())

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

function defAria(def) {
  if (!def) return ''
  const parts = [
    defLabel(def),
    `${tierLabel(def.tier)}档`,
    `${def.slots}槽`,
    costText(state, def),
    effectSummary(state, def),
  ]
  if (def.requiresWater) parts.push('需要临水')
  if (def.limitPerSettlement) parts.push(`每定居点限${def.limitPerSettlement}座`)
  return parts.join('，')
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
  delete issues[settlement.id]
}

function selectedDef(settlement) {
  return defById(state, pickOf(settlement))
}

function build(settlement) {
  const id = pickOf(settlement)
  const result = buildBuilding(state, settlement.id, id)
  if (!result.ok) {
    issues[settlement.id] = result.reason
    return
  }
  delete issues[settlement.id]
  message.value = `已建成${nameOf(id)}。`
}

function upgrade(settlement) {
  const result = upgradeSettlement(state, settlement.id)
  message.value = result.ok ? `已升级为${SETTLEMENT_TYPES[result.type].label}。` : result.reason
}

function remove(settlement, building) {
  const result = demolishBuilding(state, settlement.id, building.id)
  message.value = result.ok ? '已拆除，槽位空出。' : result.reason
}

function rebuild(settlement) {
  if (!window.confirm(`清空${settlement.name}的全部建筑？槽位会空出，不退款。`)) return
  const result = clearBuildings(state, settlement.id)
  message.value = result.ok ? `已清空 ${result.count} 座建筑。` : result.reason
}

function found() {
  const result = foundSettlement(state)
  message.value = result.ok ? `已新建${result.settlement.name}。` : result.reason
}

function payMaintenance() {
  const result = settleMaintenance(state)
  if (!result.ok) {
    message.value = result.reason
    return
  }
  if (result.paid) message.value = result.cost ? `已付维护费${result.cost}p。` : '无需维护费。'
  else message.value = `维护费${result.cost}p不足，拆除${result.demolished.name}抵账。`
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

function usageOf(effectId) {
  return countEffectUsage(state, effectId)
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
  for (const key of Object.keys(issues)) delete issues[key]
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
    message.value = '导入失败：请选择导出的王国存档 JSON。'
    return
  }
  for (const key of Object.keys(picks)) delete picks[key]
  for (const key of Object.keys(issues)) delete issues[key]
  message.value = '已导入王国存档。'
}

function togglePaste() {
  pasting.value = !pasting.value
  if (!pasting.value) pasteText.value = ''
}

function importPaste() {
  if (!importSaveText(pasteText.value)) {
    message.value = '导入失败：请粘贴导出的王国存档 JSON。'
    return
  }
  for (const key of Object.keys(picks)) delete picks[key]
  for (const key of Object.keys(issues)) delete issues[key]
  pasteText.value = ''
  pasting.value = false
  message.value = '已导入王国存档。'
}
</script>

<template>
  <section class="kingdom">
    <h1 class="sr-only">王国经营</h1>
    <header class="head">
      <div class="stats">
        <div class="stat"><span>总人口</span><b>{{ stats.totalPopulation }}</b></div>
        <div class="stat"><span>劳力骰</span><b>{{ stats.laborDice }}d6</b></div>
        <label class="stat edit"><span>劳力点数</span><input type="number" min="0" v-model.number="state.laborPoints" /></label>
        <label class="stat edit"><span>国库 p</span><input type="number" min="0" v-model.number="state.treasury" /></label>
        <label class="stat edit"><span>物资</span><input type="number" min="0" v-model.number="state.materials" /></label>
      </div>
      <div v-if="state.options.pressure" class="pressure">
        <span>维护费 <b>{{ maintenance }}p</b></span>
        <button class="act" @click="payMaintenance">结算维护费</button>
      </div>
    </header>

    <div class="ticker">
      税收 {{ stats.tax }}p · 建筑产出 {{ stats.buildingP }}p · 物资入库 {{ signed(stats.materials) }} · 劳力加成 {{ signed(stats.laborBonus) }}d6
    </div>

    <div v-if="message" class="status" role="status" aria-live="polite">{{ message }}</div>

    <div class="ambitions">
      <span class="ambLabel">志向 {{ ambitionDone }}/{{ ambitions.length }}</span>
      <label v-for="a in ambitions" :key="a.id" class="amb" :class="{ done: a.done }">
        <input type="checkbox" :checked="a.done" disabled />
        <span>{{ a.label }}</span>
      </label>
    </div>

    <nav class="tabs" aria-label="王国经营页签">
      <button class="tab" :class="{ on: tab === 'play' }" :aria-pressed="tab === 'play'" @click="tab = 'play'">经营盘</button>
      <button class="tab" :class="{ on: tab === 'buildings' }" :aria-pressed="tab === 'buildings'" @click="tab = 'buildings'">建筑表</button>
      <button class="tab" :class="{ on: tab === 'effects' }" :aria-pressed="tab === 'effects'" @click="tab = 'effects'">效果类型</button>
      <button class="tab" :class="{ on: tab === 'tune' }" :aria-pressed="tab === 'tune'" @click="tab = 'tune'">调节</button>
    </nav>

    <div v-if="tab === 'play'" class="play">
      <h2 class="panelTitle">经营盘</h2>
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
            <span class="rowLabel">地图格</span>
            <label v-for="code in hexOptions(s.hexes)" :key="code" class="check hexCheck" :title="hexNote(code)">
              <input type="checkbox" :value="code" v-model="s.hexes" />
              <span>{{ code }}</span>
            </label>
            <span v-if="!hexOptions(s.hexes).length" class="muted">未关联</span>
            <span v-if="s.hexes.some((h) => !claimedHexes.includes(h))" class="tag stale">含未占据</span>
          </div>
          <div class="flags">
            <button v-if="st.full && st.type.next" class="mini" @click="upgrade(s)">升级为{{ SETTLEMENT_TYPES[st.type.next].label }}</button>
            <span v-else-if="st.full" class="tag">最高档</span>
            <button v-if="st.full && !st.type.next && st.totalCount" class="mini" @click="rebuild(s)">原址重建</button>
            <span v-if="!st.totalCount" class="tag empty">空定居点</span>
          </div>
          <div class="metrics">
            <span>人口 <b>{{ st.population }}</b></span>
            <span>税 <b>{{ st.tax }}p</b></span>
            <span>产出 <b>{{ st.buildingP }}p</b></span>
            <span>物资 <b>{{ signed(st.materials) }}</b></span>
            <span v-if="st.laborBonus">劳力 <b>{{ signed(st.laborBonus) }}d6</b></span>
          </div>
          <div class="slotBar">
            <span class="sr-only">槽位 {{ st.used }}/{{ st.capacity }}</span>
            <span v-for="n in st.capacity" :key="n" class="slot" :class="{ on: n <= st.used }" aria-hidden="true"></span>
            <span v-if="!st.capacity" class="muted">无槽位</span>
          </div>
          <ul class="buildings">
            <li v-for="b in s.buildings" :key="b.id">
              <span class="bname">{{ nameOf(b.defId) }}</span>
              <span class="bdesc">{{ effectSummary(state, defById(state, b.defId)) }}</span>
              <button class="mini" :aria-label="`拆除${nameOf(b.defId)}`" @click="remove(s, b)">拆除</button>
            </li>
            <li v-if="!s.buildings.length" class="muted emptyLine">暂无建筑</li>
          </ul>
          <div class="buildRow">
            <select :value="pickOf(s)" :disabled="!defsFor(s).length" :aria-label="`在${s.name}建造建筑`" @change="setPick(s, $event.target.value)">
              <option v-for="d in defsFor(s)" :key="d.id" :value="d.id">{{ defLabel(d) }}</option>
            </select>
            <button class="act" :disabled="!defsFor(s).length" @click="build(s)">建造</button>
          </div>
          <div v-if="selectedDef(s)" class="buildMeta">
            <span>{{ effectSummary(state, selectedDef(s)) }}</span>
            <span class="cost">{{ costText(state, selectedDef(s)) }}</span>
            <span v-if="selectedDef(s).requiresWater" class="tag">临水</span>
            <span v-if="selectedDef(s).limitPerSettlement" class="tag">限{{ selectedDef(s).limitPerSettlement }}</span>
            <span v-if="selectedDef(s).slots > 1" class="tag">{{ selectedDef(s).slots }} 槽</span>
          </div>
          <p v-if="issues[s.id]" class="issue">{{ issues[s.id] }}</p>
        </article>
      </div>

      <div class="found">
        <b>新建定居点</b>
        <span class="cost">{{ newCost.labor }} 劳力 · {{ newCost.p }}p · {{ newCost.materials }} 物资</span>
        <button class="act" @click="found">新建村庄</button>
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
        <label class="fileLabel">文件<input ref="fileInput" class="fileInput" type="file" accept=".json,application/json" @change="onFile" /></label>
        <button class="mini danger" @click="resetGame">重置王国存档</button>
      </div>
      <div v-if="pasting" class="pasteBox">
        <textarea v-model="pasteText" class="pasteArea" rows="6" aria-label="粘贴王国存档 JSON" placeholder="粘贴王国存档 JSON"></textarea>
        <button class="act" :disabled="!pasteText.trim()" @click="importPaste">导入粘贴内容</button>
      </div>
    </div>

    <div v-if="tab === 'buildings'" class="tableTab">
      <header class="tabHead">
        <h2>建筑表</h2>
        <div class="tabActs">
          <button class="act" @click="addDef">新增建筑</button>
          <button class="act" @click="resetBuildings">恢复默认</button>
        </div>
      </header>
      <div class="defList">
        <details v-for="d in state.buildingDefs" :key="d.id" class="def">
          <summary :aria-label="defAria(d)">
            <span class="sumName">{{ d.name || '未命名建筑' }}</span>
            <span v-if="d.alias" class="sumAlias">（{{ d.alias }}）</span>
            <span class="tag">{{ tierLabel(d.tier) }}</span>
            <span class="sumMeta">{{ d.slots }}槽 · {{ costText(state, d) }}</span>
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
              <button
                class="mini danger"
                :disabled="!!countBuildingInstances(state, d.id)"
                :title="countBuildingInstances(state, d.id) ? '已有建成实例，先拆除再删除' : '删除建筑定义'"
                @click="removeDef(d)"
              >删除建筑</button>
              <span v-if="countBuildingInstances(state, d.id)" class="usedNote">
                已有 {{ countBuildingInstances(state, d.id) }} 座，先拆除
              </span>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div v-if="tab === 'effects'" class="tableTab">
      <header class="tabHead">
        <h2>效果类型</h2>
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
            <span v-if="usageOf(fx.id)" class="muted">{{ usageOf(fx.id) }} 条建筑效果使用中</span>
            <button
              class="mini danger"
              :disabled="usageOf(fx.id) > 0"
              :title="usageOf(fx.id) ? '仍被建筑使用，先从建筑上移除' : '删除效果类型'"
              @click="removeEffectDef(fx)"
            >删除</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="tab === 'tune'" class="tune">
      <header class="tabHead">
        <h2>调节</h2>
      </header>
      <fieldset class="knob">
        <legend>成长速度</legend>
        <label v-for="g in growthList" :key="g.id" class="radio">
          <input type="radio" :value="g.id" v-model="state.options.growth" />
          <span>{{ g.label }}</span>
          <span class="meta">劳力骰 ÷{{ g.divisor }} · 建造成本 ×{{ g.costMultiplier }}</span>
        </label>
      </fieldset>
      <label class="knob rowKnob">
        <input type="checkbox" v-model="state.options.compactSlots" />
        <span>紧凑槽位</span>
        <span class="meta">村庄 3 · 城镇 6 · 城市 9</span>
      </label>
      <label class="knob rowKnob">
        <input type="checkbox" v-model="state.options.singleResource" />
        <span>单资源模式</span>
        <span class="meta">建筑只花 p</span>
      </label>
      <label class="knob rowKnob">
        <input type="checkbox" v-model="state.options.pressure" />
        <span>压力模式</span>
        <span class="meta">维护费 = 建筑数 × 5p，经营盘结算</span>
      </label>
    </div>
  </section>
</template>

<style scoped>
.kingdom { max-width: 1180px; margin: 0 auto; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.panelTitle { margin: 0 0 12px; font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }

.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 14px 24px; }
.stats { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 22px; }
.stat { display: flex; flex-direction: column; gap: 1px; font-size: 12px; letter-spacing: 0.08em; color: var(--ink-2); }
.stat b { color: var(--ink); font-size: 17px; font-weight: 600; letter-spacing: 0; font-variant-numeric: tabular-nums; }
.stat input { width: 78px; padding: 4px 7px; }
.pressure { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--ink-2); }
.pressure b { color: var(--warn); font-variant-numeric: tabular-nums; }

.ticker { margin-top: 10px; color: var(--ink-2); font-size: 12px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.status {
  display: inline-block; margin-top: 12px; padding: 3px 10px;
  border-left: 2px solid var(--ochre-soft); background: var(--wash-ochre);
  color: var(--ink-2); font-size: 12px;
}

.ambitions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 18px; }
.ambLabel { margin-right: 2px; color: var(--ink-3); font-size: 12px; letter-spacing: 0.1em; font-variant-numeric: tabular-nums; }
.amb {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 5px;
  border: 1px solid var(--rule-soft); border-radius: 2px;
  color: var(--ink-3); font-size: 12px; cursor: default;
}
.amb input { width: 12px; height: 12px; margin: 0; }
.amb.done { border-color: var(--ochre-soft); background: var(--wash-ochre); color: var(--ochre); }

.tabs { display: flex; gap: 4px; margin: 20px 0 16px; border-bottom: 1px solid var(--rule); }
.tab {
  appearance: none; margin-bottom: -1px; padding: 8px 12px 7px;
  border: 0; border-bottom: 2px solid transparent; background: transparent;
  color: var(--ink-2); font: inherit; cursor: pointer; transition: color 0.15s, border-color 0.15s;
}
.tab:hover { color: var(--ochre); }
.tab.on { color: var(--ink); border-bottom-color: var(--ochre); font-weight: 600; }

.settleGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.settle { min-width: 0; padding: 14px 16px 16px; border: 1px solid var(--rule-soft); border-radius: 3px; background: var(--paper-2); }
.shead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
.nameInput {
  flex: 1 1 120px; min-width: 90px; padding: 2px 0;
  border: 0; border-bottom: 1px solid var(--rule); border-radius: 0;
  background: transparent; font-size: 15px; font-weight: 600;
}
.nameInput:hover { border-bottom-color: var(--ochre-soft); }
.aliasInput {
  flex: 0 1 110px; min-width: 64px; padding: 2px 0;
  border: 0; border-bottom: 1px solid transparent; border-radius: 0;
  background: transparent; color: var(--ink-2); font-size: 12px;
}
.aliasInput:hover { border-bottom-color: var(--rule); }
.tag {
  padding: 0 5px; border: 1px solid var(--rule-soft); border-radius: 2px;
  background: var(--wash-ochre); color: var(--ochre);
  font-size: 12px; letter-spacing: 0.06em; white-space: nowrap;
}
.slotsNum { margin-left: auto; color: var(--ink-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.water { font-size: 12px; color: var(--ink-2); }
.hexRow { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; margin-top: 8px; font-size: 12px; }
.rowLabel { color: var(--ink-3); font-size: 12px; letter-spacing: 0.06em; }
.hexRow .check { margin: 0; font-size: 12px; }
.hexCheck { gap: 4px; }
.tag.stale { border-color: var(--warn); background: transparent; color: var(--warn); }
.flags { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; min-height: 18px; }
.tag.empty { background: transparent; color: var(--ink-3); }
.metrics { display: flex; flex-wrap: wrap; gap: 2px 14px; margin-top: 8px; color: var(--ink-2); font-size: 12px; }
.metrics b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.slotBar { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.slot { display: block; width: 15px; height: 15px; border: 1px solid var(--rule); border-radius: 2px; background: var(--paper); }
.slot.on { border-color: var(--ochre); background: var(--wash-ochre); }

.buildings { list-style: none; margin: 10px 0 0; padding: 0; border-top: 1px solid var(--rule-soft); }
.buildings li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 4px 0; border-bottom: 1px solid var(--rule-soft); font-size: 12px; }
.bname { color: var(--ink); font-weight: 600; }
.bdesc { flex: 1 1 120px; min-width: 0; color: var(--ink-3); font-size: 12px; }
.emptyLine { color: var(--ink-3); }
.mini {
  appearance: none; border: 0; background: transparent;
  padding: 3px 6px; color: var(--ink-2); font: inherit; font-size: 12px; cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.mini:hover { color: var(--ochre); }
.mini.danger { color: var(--warn); }
.mini:disabled { color: var(--ink-3); cursor: not-allowed; }

.buildRow { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.buildRow select { flex: 1 1 150px; min-width: 0; }
.buildMeta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin-top: 5px; color: var(--ink-3); font-size: 12px; }
.buildMeta .cost { color: var(--ink-2); font-variant-numeric: tabular-nums; }
.issue { margin: 5px 0 0; color: var(--warn); font-size: 12px; }

.found { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--rule-soft); font-size: 13px; }
.found .cost { color: var(--ink-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.found .act { margin-left: auto; }

.log { margin-top: 22px; }
.log ul { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12px; }
.log li { padding: 3px 0; border-bottom: 1px dotted var(--rule-soft); }
.saveRow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 14px; font-size: 12px; }
.fileLabel { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); }
.fileInput { max-width: 170px; font: inherit; font-size: 12px; color: var(--ink-2); }
.pasteBox { margin-top: 10px; }
.pasteArea {
  width: 100%; padding: 6px 8px;
  border: 1px solid var(--rule); border-radius: 4px;
  background: var(--paper-2); color: var(--ink);
  font: inherit; font-size: 12px; resize: vertical;
}
.pasteBox .act { margin-top: 8px; }

.tabHead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
.tabHead h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
.tabActs { display: flex; gap: 8px; }

.defList, .fxList { margin-top: 12px; border-top: 1px solid var(--rule); }
.def, .fxDef { border-bottom: 1px solid var(--rule-soft); }
.def > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 10px 0; cursor: pointer; list-style: none; font-size: 13px; }
.def > summary::-webkit-details-marker { display: none; }
.def > summary::before { content: "▸"; color: var(--ink-3); }
.def[open] > summary::before { content: "▾"; }
.sumName { font-weight: 600; }
.sumAlias { margin-left: -6px; color: var(--ink-3); }
.sumMeta { color: var(--ink-2); font-variant-numeric: tabular-nums; }
.sumFx { flex: 1 1 160px; color: var(--ink-3); }
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
.unit { font-size: 12px; }
.defFoot { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.usedNote { color: var(--ink-3); font-size: 12px; }
.fxDef { padding: 12px 0; }
.fxDesc { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; font-size: 12px; }

.tune { display: grid; gap: 10px; max-width: 680px; margin-top: 16px; }
.knob { border: 1px solid var(--rule-soft); border-radius: 3px; padding: 12px 14px; }
fieldset.knob { margin: 0; }
.knob legend { padding: 0 6px; color: var(--ink-2); font-size: 12px; letter-spacing: 0.06em; }
.radio { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px; cursor: pointer; }
.radio .meta, .rowKnob .meta { margin-left: auto; color: var(--ink-3); font-size: 12px; font-variant-numeric: tabular-nums; }
.rowKnob { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.rowKnob:hover, .radio:hover { border-color: var(--rule-hover); }

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
