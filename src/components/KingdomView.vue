<script setup>
import { computed, reactive, ref } from 'vue'
import { state, resetKingdom, exportSaveFile, importSaveText } from '../kingdomStore.js'
import { state as mapState } from '../mapStore.js'
import {
  BUILDING_TIERS,
  EFFECT_KINDS,
  GROWTH_RATES,
  SETTLEMENT_TYPES,
  UPKEEP_PER_BUILDING,
  allowedDefs,
  ambitionStatus,
  buildBuilding,
  buildCost,
  canBuild,
  canFoundSettlement,
  clearBuildings,
  costText,
  defaultOptions,
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
  pendingProduction,
  settleCheck,
  settleProduction,
  settlementStats,
  settlementType,
  startNewRound,
  upgradeSettlement,
} from '../kingdom/model.js'

// 兼容热更新与旧存档：内存里的状态可能还没有 options
if (!state.options) state.options = defaultOptions()

const tab = ref('play')
const message = ref('')
const messageWarn = ref(false)
const flashId = ref('')
const picks = reactive({})
const fileInput = ref(null)
const pasting = ref(false)
const pasteText = ref('')
let flashTimer = null

const stats = computed(() => kingdomStats(state))
const laborMax = computed(() => stats.value.laborDice * 6)
const pending = computed(() => pendingProduction(state))
const hasPending = computed(() => pending.value.p !== 0 || pending.value.materials > 0)
const settleStatus = computed(() => settleCheck(state))
const netText = computed(() => {
  const n = stats.value.netIncomeP
  return n > 0 ? `+${n}p` : `${n}p`
})
const rows = computed(() => state.settlements.map((s) => {
  const st = settlementStats(state, s)
  return { s, st, up: upgradePreview(st) }
}))
const defGroups = computed(() => BUILDING_TIERS
  .map((t) => ({ ...t, defs: state.buildingDefs.filter((d) => d.tier === t.id) }))
  .filter((g) => g.defs.length))
const visibleEffects = computed(() => state.effectDefs.filter((fx) => fx.kind !== 'note'))
const visibleKinds = computed(() => EFFECT_KINDS.filter((k) => k.id !== 'note'))
const recommendations = computed(() => {
  const map = {}
  for (const settlement of state.settlements) {
    const st = settlementStats(state, settlement)
    const ranked = defsFor(settlement)
      .filter((def) => !structuralBlock(settlement, def))
      .map((def) => ({ def, ...defScore(st, def) }))
      .filter((x) => x.netP > 0)
      .sort((a, b) => b.netPerSlot - a.netPerSlot || b.netP - a.netP || a.payback - b.payback)
    map[settlement.id] = ranked[0] || null
  }
  return map
})
const newCost = computed(() => newSettlementCost(state))
const foundCheck = computed(() => canFoundSettlement(state))
const ambitions = computed(() => ambitionStatus(state))
const ambitionDone = computed(() => ambitions.value.filter((a) => a.done).length)
const growthList = computed(() => Object.values(GROWTH_RATES))
const recentLog = computed(() => state.log.slice(-12).reverse())

function upgradePreview(st) {
  if (!st.type.next) return null
  const next = settlementType(st.type.next, state.options)
  return {
    type: next,
    capacity: st.capacity + next.slots - st.type.slots,
    population: st.population + next.basePop - st.type.basePop,
  }
}

function say(text, warn = false) {
  message.value = text
  messageWarn.value = warn
}

function flash(id) {
  flashId.value = id
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashId.value = '' }, 2400)
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

function clampLabor() {
  state.laborPoints = clampInt(state.laborPoints, 0, laborMax.value)
}

function clampResource(key) {
  state[key] = clampInt(state[key], 0, 9999999)
}

function clampDef(def) {
  def.slots = clampInt(def.slots, 1, 99)
  def.labor = clampInt(def.labor, 0, 999)
  def.p = clampInt(def.p, 0, 9999999)
  def.materials = clampInt(def.materials, 0, 99999)
  def.limitPerSettlement = clampInt(def.limitPerSettlement, 0, 99)
}

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

function hexAlias(code) {
  return (mapState.hexAliases || {})[code] || ''
}

function hexLabel(code) {
  const alias = hexAlias(code)
  return alias ? `${code} ${alias}` : code
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
  const cur = picks[settlement.id]
  return defsFor(settlement).some((d) => d.id === cur) ? cur : ''
}

function setPick(settlement, defId) {
  picks[settlement.id] = defId
}

function selectedDef(settlement) {
  return defById(state, pickOf(settlement))
}

// 结构性阻塞：档位已经由 defsFor 过滤，这里只管临水、上限与槽位
function structuralBlock(settlement, def) {
  if (def.requiresWater && !settlement.water) return '需临水'
  const same = settlement.buildings.filter((b) => b.defId === def.id).length
  if (def.limitPerSettlement > 0 && same >= def.limitPerSettlement) return `已达上限${def.limitPerSettlement}`
  if (def.slots > settlementStats(state, settlement).free) return `需${def.slots}槽`
  return ''
}

// 智能推荐：按净 p/槽 排序，税收按当前人口四舍五入后的差额计算
function defScore(st, def) {
  let addP = 0
  let addPop = 0
  for (const effect of def.effects || []) {
    const kind = effectKind(effect)
    const value = Number(effect.value) || 0
    if (kind === 'incomeP') addP += value
    else if (kind === 'population') addPop += value
  }
  const taxDelta = Math.floor((st.population + addPop) / 2) - st.tax
  const netP = addP + taxDelta - UPKEEP_PER_BUILDING
  const costP = buildCost(state, def).p
  return {
    netP,
    payback: netP > 0 && costP > 0 ? Math.ceil(costP / netP) : 0,
    netPerSlot: netP / Math.max(1, def.slots),
  }
}

function isRecommended(settlement, defId) {
  const rec = recommendations.value[settlement.id]
  return !!rec && rec.def.id === defId
}

function recText(settlement) {
  const rec = recommendations.value[settlement.id]
  if (!rec) return ''
  return `推荐：净 ${signed(rec.netP)}p/轮，${rec.payback ? `${rec.payback} 轮回本` : '即时回本'}`
}

function defOptionLabel(settlement, def) {
  const block = structuralBlock(settlement, def)
  const rec = isRecommended(settlement, def.id) ? '推荐｜' : ''
  return `${rec}${defLabel(def)}｜${costText(state, def)}${block ? `｜${block}` : ''}`
}

function buildCheck(settlement) {
  const id = pickOf(settlement)
  return id ? canBuild(state, settlement.id, id) : { ok: false, reason: '选择建筑后建造' }
}

function settle() {
  const result = settleProduction(state)
  if (!result.ok) {
    say(result.reason, true)
    return
  }
  const parts = []
  if (result.p) parts.push(`${signed(result.p)}p`)
  if (result.materials) parts.push(`${signed(result.materials)}物资`)
  say(`已结算：${parts.join('、')}。`)
}

function newRound() {
  if (!state.settled && hasPending.value) {
    if (!window.confirm('本次产出尚未结算，开始新一轮会放弃它。确定继续？')) return
  }
  startNewRound(state)
  say('已开始新一轮，劳力已清零。')
}

function build(settlement) {
  const id = pickOf(settlement)
  if (!id) {
    say('先选择建筑。', true)
    return
  }
  const before = settlement.type
  const result = buildBuilding(state, settlement.id, id)
  if (!result.ok) {
    say(result.reason, true)
    return
  }
  if (settlement.type !== before) {
    const type = SETTLEMENT_TYPES[settlement.type]
    say(`已建成${nameOf(id)}；${settlement.name || '定居点'}升为${type.label}（${type.slots}槽，基础人口${type.basePop}）。`)
    flash(settlement.id)
  } else {
    say(`已建成${nameOf(id)}。`)
  }
}

function upgrade(settlement) {
  const result = upgradeSettlement(state, settlement.id)
  if (!result.ok) {
    say(result.reason, true)
    return
  }
  const type = settlementType(result.type, state.options)
  say(`已升级为${type.label}：${type.slots}槽，基础人口${type.basePop}。`)
  flash(settlement.id)
}

function remove(settlement, building) {
  const def = defById(state, building.defId)
  const label = def ? defLabel(def) : '建筑'
  if (!window.confirm(`拆除${settlement.name || '定居点'}的${label}？槽位会空出，但不退款。`)) return
  const result = demolishBuilding(state, settlement.id, building.id)
  if (!result.ok) {
    say(result.reason, true)
    return
  }
  say(`已拆除${label}，槽位空出。`)
}

function found() {
  const result = foundSettlement(state)
  if (!result.ok) {
    say(result.reason, true)
    return
  }
  say(`已新建${result.settlement.name}（${settlementType('village', state.options).slots}槽村庄）。`)
}

function rebuild(settlement) {
  if (!window.confirm(`清空${settlement.name}的全部建筑？槽位会空出，不退款。`)) return
  const result = clearBuildings(state, settlement.id)
  if (!result.ok) {
    say(result.reason, true)
    return
  }
  say(`已清空 ${result.count} 座建筑，槽位全部空出。`)
  flash(settlement.id)
}

function addDef() {
  state.buildingDefs.unshift(newBuildingDef())
  say('已新增建筑，展开建筑表后编辑。')
}

function removeDef(def) {
  const used = countBuildingInstances(state, def.id)
  if (used) {
    say('先拆除已建成的该建筑，再删除定义。', true)
    return
  }
  const i = state.buildingDefs.findIndex((d) => d.id === def.id)
  if (i >= 0) state.buildingDefs.splice(i, 1)
  say(`已删除建筑定义：${def.name}。`)
}

function addEffect(def) {
  const first = state.effectDefs[0]
  if (!first) {
    say('先在效果类型里建立一个效果。', true)
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
  say('已新增效果类型，可在建筑效果里选用。')
}

function removeEffectDef(fx) {
  const used = countEffectUsage(state, fx.id)
  if (used) {
    say('该效果仍被建筑使用，先从建筑上移除。', true)
    return
  }
  const i = state.effectDefs.findIndex((e) => e.id === fx.id)
  if (i >= 0) state.effectDefs.splice(i, 1)
  say(`已删除效果类型：${fx.label}。`)
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
  say('已恢复默认建筑表。')
}

function resetGame() {
  if (!window.confirm('重置王国存档会清空当前国库、定居点、自定义建筑与效果。继续？')) return
  resetKingdom()
  for (const key of Object.keys(picks)) delete picks[key]
  say('已重置王国存档。')
}

function exportSave() {
  exportSaveFile()
  say('已导出王国存档。')
}

async function onFile(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  const text = await file.text()
  if (!importSaveText(text)) {
    say('导入失败：文件不是有效的王国存档。', true)
    return
  }
  for (const key of Object.keys(picks)) delete picks[key]
  say('已导入王国存档。')
}

function togglePaste() {
  pasting.value = !pasting.value
  if (!pasting.value) pasteText.value = ''
}

function importPaste() {
  if (!importSaveText(pasteText.value)) {
    say('导入失败：粘贴内容不是有效的王国存档。', true)
    return
  }
  for (const key of Object.keys(picks)) delete picks[key]
  pasteText.value = ''
  pasting.value = false
  say('已导入王国存档。')
}
</script>

<template>
  <section class="kingdom">
    <header class="head">
      <div>
        <h1>王国经营</h1>
        <p class="sub muted">{{ rows.length }} 处定居点 · 总人口 {{ stats.totalPopulation }} · 劳力 {{ stats.laborDice }}d6</p>
      </div>
      <p class="status" :class="{ warn: messageWarn }" role="status" aria-live="polite">{{ message }}</p>
    </header>

    <div class="ledger">
      <div class="ledgerCell">
        <span class="ledgerLabel">本次净产出</span>
        <div class="ledgerValue" :class="{ minus: stats.netIncomeP < 0 }" :title="`税收 ${stats.tax}p ＋ 建筑 ${stats.buildingP}p － 维护 ${stats.upkeep}p`">
          {{ netText }}
          <button class="mini settleBtn" :disabled="!settleStatus.ok" :title="settleStatus.ok ? '把净产出入库，维护费从国库扣除' : settleStatus.reason" @click="settle">结算</button>
        </div>
        <p v-if="stats.upkeep" class="ledgerHint">维护 {{ stats.upkeep }}p</p>
        <p v-if="hasPending && !settleStatus.ok" class="hint warn">{{ settleStatus.reason }}</p>
      </div>
      <div class="ledgerCell">
        <span class="ledgerLabel">本次劳力
          <button class="roundBtn" title="清空劳力并开始下一次经营" @click="newRound">新一轮</button>
        </span>
        <div class="ledgerValue">
          <span class="dice">掷 {{ stats.laborDice }}d6</span>
          <input type="number" min="0" :max="laborMax" v-model.number="state.laborPoints" aria-label="本次劳力点数总和" @change="clampLabor" />
          <span class="unit">点</span>
        </div>
      </div>
      <label class="ledgerCell">
        <span class="ledgerLabel">国库</span>
        <div class="ledgerValue">
          <input type="number" min="0" v-model.number="state.treasury" aria-label="国库 p" @change="clampResource('treasury')" />
          <span class="unit">p</span>
        </div>
        <p class="ledgerHint">当前结余</p>
      </label>
      <label class="ledgerCell">
        <span class="ledgerLabel">物资</span>
        <div class="ledgerValue">
          <input type="number" min="0" v-model.number="state.materials" aria-label="物资库存" @change="clampResource('materials')" />
          <span class="unit">物资</span>
        </div>
        <p class="ledgerHint">本次产出 {{ signed(stats.materials) }}</p>
      </label>
    </div>

    <div class="ambitions">
      <span class="ambLabel">志向 {{ ambitionDone }}/{{ ambitions.length }}</span>
      <label v-for="a in ambitions" :key="a.id" class="amb" :class="{ done: a.done }">
        <input type="checkbox" :checked="a.done" disabled />
        <span>{{ a.label }}</span>
      </label>
    </div>

    <nav class="tabs" aria-label="王国经营视图">
      <button class="tab" :class="{ on: tab === 'play' }" :aria-current="tab === 'play' ? 'page' : undefined" @click="tab = 'play'">经营盘</button>
      <button class="tab" :class="{ on: tab === 'buildings' }" :aria-current="tab === 'buildings' ? 'page' : undefined" @click="tab = 'buildings'">建筑表</button>
      <button class="tab" :class="{ on: tab === 'effects' }" :aria-current="tab === 'effects' ? 'page' : undefined" @click="tab = 'effects'">效果类型</button>
      <button class="tab" :class="{ on: tab === 'tune' }" :aria-current="tab === 'tune' ? 'page' : undefined" @click="tab = 'tune'">调节</button>
    </nav>

    <div v-if="tab === 'play'" class="play">
      <div class="settleGrid">
        <article v-for="{ s, st, up } in rows" :key="s.id" class="settle" :class="{ flash: flashId === s.id }">
          <header class="shead">
            <div class="sTitle">
              <input v-model="s.name" class="nameInput" aria-label="定居点名称" />
              <input v-model="s.alias" class="aliasInput" placeholder="别名" aria-label="定居点别名" />
            </div>
            <div class="sMeta">
              <span class="tag">{{ st.type.label }}</span>
              <span v-if="!st.totalCount" class="tag">空</span>
              <span class="slotsNum">{{ st.used }}/{{ st.capacity }} 槽</span>
              <label class="check water"><input type="checkbox" v-model="s.water" /><span>临水</span></label>
            </div>
          </header>
          <details class="hexEdit">
            <summary>
              <span class="muted">地图格</span>
              <span class="hexList">{{ s.hexes.length ? s.hexes.join('、') : '未关联' }}</span>
              <span v-if="s.hexes.some((h) => !claimedHexes.includes(h))" class="tag stale">含未占据</span>
              <span class="hexEditLink">选择</span>
            </summary>
            <div class="hexPicker">
              <label v-for="code in hexOptions(s.hexes)" :key="code" class="check hexCheck" :title="hexNote(code)">
                <input type="checkbox" :value="code" v-model="s.hexes" />
                <span>{{ hexLabel(code) }}</span>
              </label>
              <span v-if="!hexOptions(s.hexes).length" class="muted">地图页还没有已占据格</span>
            </div>
          </details>
          <div class="metrics">
            <span>人口 <b>{{ st.population }}</b></span>
            <span>收入 <b>{{ st.incomeP }}p</b></span>
            <span>维护 <b>{{ st.upkeep }}p</b></span>
            <span>净产出 <b>{{ signed(st.netIncomeP) }}p</b></span>
            <span>物资 <b>{{ signed(st.materials) }}</b></span>
            <span v-if="st.laborBonus">劳力 <b>{{ signed(st.laborBonus) }}d6</b></span>
          </div>
          <div class="slotBar" aria-hidden="true">
            <span v-for="n in st.capacity" :key="n" class="slot" :class="{ on: n <= st.used }"></span>
            <span v-if="!st.capacity" class="muted">无槽位</span>
          </div>
          <ul class="buildings">
            <li v-for="b in s.buildings" :key="b.id">
              <span class="bname">{{ nameOf(b.defId) }}</span>
              <span class="bdesc">{{ effectSummary(state, defById(state, b.defId)) }}</span>
              <button class="mini" :aria-label="'拆除' + nameOf(b.defId)" @click="remove(s, b)">拆除</button>
            </li>
            <li v-if="!s.buildings.length" class="muted emptyLine">暂无建筑</li>
          </ul>
          <div v-if="st.full" class="upgradeBlock">
            <div class="upgradeText">
              <b>{{ up ? '槽位已满，可以升级' : '已是最高档' }}</b>
              <p v-if="up" class="hint">升级为{{ up.type.label }}：{{ st.capacity }}→{{ up.capacity }} 槽，人口 {{ st.population }}→{{ up.population }}；不花资源，立即生效。</p>
              <p v-else class="hint">槽位已满，可在原址拆除重建，或在别处新建定居点。</p>
            </div>
            <button v-if="up" class="act primary" :aria-label="'升级' + (s.name || '定居点') + '为' + up.type.label" @click="upgrade(s)">升级为{{ up.type.label }}</button>
            <button v-else-if="st.totalCount" class="mini" @click="rebuild(s)">原址重建</button>
          </div>
          <template v-else>
            <div class="buildRow">
              <select :value="pickOf(s)" :disabled="!defsFor(s).length" :aria-label="'选择' + (s.name || '定居点') + '的建筑'" @change="setPick(s, $event.target.value)">
                <option value="">选择建筑</option>
                <option v-for="d in defsFor(s)" :key="d.id" :value="d.id" :disabled="!!structuralBlock(s, d)">{{ defOptionLabel(s, d) }}</option>
              </select>
              <button class="act" :disabled="!buildCheck(s).ok" @click="build(s)">建造</button>
            </div>
            <p v-if="pickOf(s)" class="hint" :class="{ warn: !buildCheck(s).ok }">
              {{ buildCheck(s).ok ? `${effectSummary(state, selectedDef(s))}；${costText(state, selectedDef(s))}` : buildCheck(s).reason }}<span v-if="isRecommended(s, pickOf(s))" class="recNote">；{{ recText(s) }}</span>
            </p>
          </template>
        </article>
      </div>

      <div class="found">
        <div>
          <b>新建定居点</b>
          <p class="muted">费用 {{ newCost.labor }} 劳力 · {{ newCost.p }}p · {{ newCost.materials }} 物资。</p>
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

      <details class="more saveBlock">
        <summary>存档</summary>
        <div class="saveRow">
          <button class="mini" @click="exportSave">导出存档</button>
          <button class="mini" @click="togglePaste">{{ pasting ? '收起粘贴' : '粘贴导入' }}</button>
          <span class="muted">文件：</span>
          <input ref="fileInput" class="fileInput" type="file" accept=".json,application/json" aria-label="导入王国存档文件" @change="onFile" />
          <button class="mini danger resetBtn" @click="resetGame">重置王国存档</button>
        </div>
        <div v-if="pasting" class="pasteBox">
          <textarea v-model="pasteText" class="pasteArea" rows="6" placeholder="粘贴王国存档 JSON"></textarea>
          <button class="act" :disabled="!pasteText.trim()" @click="importPaste">导入粘贴内容</button>
        </div>
      </details>
    </div>

    <div v-if="tab === 'buildings'" class="tableTab">
      <header class="tabHead">
        <div>
          <h2>建筑表</h2>
          <p class="muted">这里改的名称、成本、槽位与效果会即时影响经营盘；每座建筑每次结算维护 {{ UPKEEP_PER_BUILDING }}p，已建成的建筑沿用当前定义。</p>
        </div>
        <div class="tabActs">
          <button class="act" @click="addDef">新增建筑</button>
          <button class="mini" @click="resetBuildings">恢复默认</button>
        </div>
      </header>
      <p v-if="!state.buildingDefs.length" class="muted defEmpty">还没有建筑定义，点“新增建筑”开始。</p>
      <div v-else class="defList">
        <section v-for="g in defGroups" :key="g.id" class="defGroup">
          <h3 class="defGroupHead">{{ g.label }}档<span class="muted">{{ g.defs.length }}</span></h3>
          <details v-for="d in g.defs" :key="d.id" class="def">
            <summary>
              <span class="sumName">{{ d.name || '未命名建筑' }}</span>
              <span v-if="d.alias" class="sumAlias">（{{ d.alias }}）</span>
              <span class="sumMeta">{{ d.slots }}槽 · {{ costText(state, d) }}</span>
              <span class="sumFx">{{ effectSummary(state, d) }}</span>
              <span v-if="d.requiresWater || d.limitPerSettlement" class="sumTags">
                <span v-if="d.requiresWater" class="tag">临水</span>
                <span v-if="d.limitPerSettlement" class="tag">限{{ d.limitPerSettlement }}</span>
              </span>
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
                <label class="field">槽位<input type="number" min="1" v-model.number="d.slots" @change="clampDef(d)" /></label>
                <label class="field">劳力<input type="number" min="0" v-model.number="d.labor" @change="clampDef(d)" /></label>
                <label class="field">p<input type="number" min="0" v-model.number="d.p" @change="clampDef(d)" /></label>
                <label class="field">物资<input type="number" min="0" v-model.number="d.materials" @change="clampDef(d)" /></label>
                <label class="field">上限（0不限）<input type="number" min="0" v-model.number="d.limitPerSettlement" @change="clampDef(d)" /></label>
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
        </section>
      </div>
    </div>

    <div v-if="tab === 'effects'" class="tableTab">
      <header class="tabHead">
        <div>
          <h2>效果类型</h2>
          <p class="muted">效果类型可自由增删。这里只列参与计算的效果；说明型效果只在建筑效果里作为记录项选用。</p>
        </div>
        <div class="tabActs">
          <button class="act" @click="addEffectDef">新增效果类型</button>
        </div>
      </header>
      <p v-if="!visibleEffects.length" class="muted fxEmpty">还没有计算型效果，点“新增效果类型”开始。</p>
      <div v-else class="fxList">
        <div v-for="fx in visibleEffects" :key="fx.id" class="fxDef">
          <div class="fields">
            <label class="field">名称<input v-model="fx.label" /></label>
            <label class="field">单位<input v-model="fx.unit" placeholder="如 人、p、颗" /></label>
            <label class="field">计算类型
              <select v-model="fx.kind">
                <option v-for="k in visibleKinds" :key="k.id" :value="k.id">{{ k.label }}</option>
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
        <p v-for="k in visibleKinds" :key="k.id"><b>{{ k.label }}</b>：{{ k.hint }}</p>
      </div>
    </div>

    <div v-if="tab === 'tune'" class="tableTab">
      <header class="tabHead">
        <div>
          <h2>调节</h2>
          <p class="muted">成长速度、槽位与资源口径即时生效；维护费固定为每座建筑 5p，已在经营盘统一结算。</p>
        </div>
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
    </div>
  </section>
</template>

<style scoped>
.kingdom { max-width: 1180px; margin: 0 auto; }

.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 8px 26px; }
.head h1 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: 0.04em; }
.head .sub { margin: 4px 0 0; font-size: 12px; }
.status {
  flex: 0 1 520px; min-height: 42px; margin: 0;
  color: var(--ochre); font-size: 13px; line-height: 1.6; text-align: right;
}
.status.warn { color: var(--warn); }

.ledger {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 18px; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
}
.ledgerCell { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 10px 16px; border-left: 1px solid var(--rule-soft); }
.ledgerCell:first-child { padding-left: 0; border-left: 0; }
.ledgerCell:last-child { padding-right: 0; }
.ledgerLabel { color: var(--ink-2); font-size: 12px; letter-spacing: 0.04em; }
.roundBtn {
  appearance: none; margin-left: 6px; padding: 0 2px;
  border: 0; background: transparent; color: var(--ochre);
  font: inherit; font-size: 12px; cursor: pointer;
}
.roundBtn:hover { text-decoration: underline; }
.ledgerValue { display: flex; align-items: baseline; gap: 6px; color: var(--ink); font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ledgerValue.minus { color: var(--warn); }
.ledgerValue input { width: 72px; padding: 3px 7px; font-size: 15px; font-weight: 600; }
.ledgerValue .dice { color: var(--ink-2); font-size: 12px; font-weight: 400; white-space: nowrap; }
.ledgerValue .unit { color: var(--ink-2); font-size: 12px; font-weight: 400; }
.ledgerHint { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.5; }

.ambitions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 6px; margin-top: 14px; }
.ambLabel { margin-right: 2px; color: var(--ink-3); font-size: 12px; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }
.amb {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 5px;
  border: 1px solid var(--rule-soft); border-radius: 2px;
  color: var(--ink-3); font-size: 12px; cursor: default;
}
.amb input { width: 12px; height: 12px; margin: 0; }
.amb.done { border-color: var(--ochre-soft); background: var(--wash-ochre); color: var(--ochre); }

.knob {
  margin: 16px 0 0; padding: 12px 14px;
  border: 1px solid var(--rule-soft); border-radius: 3px;
}
.knob legend { padding: 0 6px; color: var(--ink-2); font-size: 12px; letter-spacing: 0.08em; }
.radio { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-top: 6px; color: var(--ink-2); font-size: 12px; }
.radio input { margin: 0; }
.radio .meta, .rowKnob .meta { color: var(--ink-3); }
.rowKnob { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; color: var(--ink-2); font-size: 12px; }
.rowKnob input { margin: 0; }

.tabs { display: flex; gap: 4px; margin: 18px 0 16px; border-bottom: 1px solid var(--rule); }
.tab {
  appearance: none; margin-bottom: -1px; padding: 8px 12px 7px;
  border: 0; border-bottom: 2px solid transparent; background: transparent;
  color: var(--ink-2); font: inherit; cursor: pointer;
}
.tab:hover { color: var(--ochre); }
.tab.on { color: var(--ink); border-bottom-color: var(--ochre); font-weight: 600; }

.settleGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
.settle { min-width: 0; border: 1px solid var(--rule-soft); border-radius: 3px; padding: 14px 16px; }
.settle.flash { border-color: var(--ochre-soft); }
.shead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.sTitle { display: flex; flex: 1 1 100%; align-items: baseline; gap: 10px; min-width: 0; }
.sMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.nameInput {
  flex: 1 1 auto; min-width: 100px; padding: 2px 0;
  border: 0; border-bottom: 1px solid var(--rule); border-radius: 0;
  background: transparent; font-size: 15px; font-weight: 600;
}
.nameInput:hover { border-bottom-color: var(--ochre-soft); }
.aliasInput {
  flex: 0 1 110px; min-width: 60px; padding: 2px 0;
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
.water { margin: 0; font-size: 12px; color: var(--ink-2); }
.hexEdit { margin-top: 10px; color: var(--ink-2); font-size: 12px; }
.hexEdit > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-height: 24px; cursor: pointer; list-style: none; }
.hexEdit > summary::-webkit-details-marker { display: none; }
.hexEdit > summary::before { content: "▸"; color: var(--ink-3); }
.hexEdit[open] > summary::before { content: "▾"; }
.hexList { color: var(--ink); font-variant-numeric: tabular-nums; }
.hexEditLink { color: var(--ochre); font-size: 12px; letter-spacing: 0.06em; }
.hexPicker { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; padding: 8px 0 0 14px; border-top: 1px solid var(--rule-soft); }
.hexCheck { gap: 5px; margin: 0; }
.tag.stale { border-color: var(--warn); background: transparent; color: var(--warn); }
.metrics { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 10px; color: var(--ink-2); font-size: 12px; }
.metrics b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.slotBar { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.slot { display: block; width: 16px; height: 16px; border: 1px solid var(--rule); border-radius: 2px; background: var(--paper-2); }
.slot.on { border-color: var(--ochre); background: var(--select-wash); }

.buildings { list-style: none; margin: 10px 0 0; padding: 0; border-top: 1px solid var(--rule-soft); }
.buildings li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 5px 0; border-bottom: 1px solid var(--rule-soft); font-size: 12px; }
.bname { color: var(--ink); font-weight: 600; }
.bdesc { flex: 1 1 140px; min-width: 0; color: var(--ink-3); }
.emptyLine { color: var(--ink-3); padding: 5px 0; }
.mini {
  appearance: none; border: 0; background: transparent;
  padding: 4px 8px; color: var(--ink-2); font: inherit; font-size: 12px; cursor: pointer;
}
.mini:hover { color: var(--ochre); }
.mini.danger { color: var(--warn); }
.mini:disabled { color: var(--ink-3); cursor: not-allowed; }
.settleBtn {
  margin-left: auto; padding: 3px 8px; white-space: nowrap;
  border: 1px solid var(--ochre-soft); border-radius: 4px;
  background: var(--wash-ochre); color: var(--ochre); font-weight: 400;
}
.settleBtn:hover { border-color: var(--ochre); color: var(--ochre); }
.settleBtn:disabled { border-color: var(--rule-soft); background: transparent; color: var(--ink-3); }

.upgradeBlock {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
  gap: 10px 16px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ochre-soft);
}
.upgradeText { flex: 1 1 220px; min-width: 0; }
.upgradeText b { font-size: 13px; font-weight: 600; }
.upgradeText .hint { margin: 4px 0 0; }
button.act.primary { border-color: var(--ochre); background: var(--wash-ochre); color: var(--ochre); }
button.act.primary:hover { border-color: var(--ochre); background: var(--cover-old); color: var(--ochre); }

.buildRow { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.buildRow select { flex: 1 1 150px; min-width: 0; }
.hint { margin: 6px 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.6; }
.hint.warn { color: var(--warn); }
.recNote { color: var(--ochre); }

.found { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--rule-soft); }
.found p { margin: 4px 0 0; font-size: 12px; }
.foundAct { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }

.log { margin-top: 24px; }
.log ul { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12px; }
.log li { padding: 3px 0; border-bottom: 1px dotted var(--rule-soft); }
.saveBlock { margin-top: 18px; }
.saveRow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; margin-top: 10px; }
.resetBtn { margin-left: auto; }
.fileInput { max-width: 220px; font: inherit; font-size: 12px; color: var(--ink-2); }
.fileInput::file-selector-button {
  appearance: none; margin-right: 8px; padding: 4px 10px;
  border: 1px solid var(--rule); border-radius: 4px;
  background: var(--paper-2); color: var(--ink); font: inherit; font-size: 12px; cursor: pointer;
}
.fileInput::file-selector-button:hover { border-color: var(--ochre-soft); color: var(--ochre); }
.pasteBox { margin-top: 10px; }
.pasteArea {
  width: 100%; padding: 6px 8px;
  border: 1px solid var(--rule); border-radius: 4px;
  background: var(--paper-2); color: var(--ink);
  font: inherit; font-size: 12px; resize: vertical;
}
.pasteBox .act { margin-top: 8px; }

.tabHead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px; }
.tabHead h2 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
.tabHead p { max-width: 640px; margin: 4px 0 0; font-size: 12px; }
.tabActs { display: flex; align-items: center; gap: 8px; }

.defEmpty, .fxEmpty { margin-top: 14px; }
.defList { margin-top: 6px; }
.fxList { margin-top: 14px; border-top: 1px solid var(--rule); }
.defGroup { margin-top: 16px; }
.defGroupHead {
  display: flex; align-items: baseline; gap: 8px; margin: 0; padding-bottom: 6px;
  border-bottom: 1px solid var(--rule); color: var(--ink-2);
  font-size: 12px; font-weight: 600; letter-spacing: 0.12em;
}
.defGroupHead .muted { font-weight: 400; letter-spacing: 0; }
.def, .fxDef { border-bottom: 1px solid var(--rule-soft); }
.fxList .fxDef:last-child { border-bottom: 0; }
.def > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 10px 0; cursor: pointer; list-style: none; font-size: 13px; }
.def > summary::-webkit-details-marker { display: none; }
.def > summary::before { content: "▸"; color: var(--ink-3); }
.def[open] > summary::before { content: "▾"; }
.sumName { font-weight: 600; }
.sumAlias { margin-left: -6px; color: var(--ink-3); }
.sumMeta { color: var(--ink-2); font-variant-numeric: tabular-nums; }
.sumFx { flex: 1 1 180px; color: var(--ink-3); }
.sumTags { display: flex; flex-wrap: wrap; gap: 4px; }
.defBody { padding: 0 0 14px 20px; }
.fields { display: flex; flex-wrap: wrap; gap: 10px 14px; }
.field { display: flex; flex-direction: column; gap: 4px; color: var(--ink-2); font-size: 12px; }
.field input, .field select { min-width: 0; }
.field select { min-width: 80px; }
.field input[type="number"] { width: 84px; }
.field.full { margin-top: 10px; }
.field.full input { width: 100%; max-width: 640px; }
.check { display: flex; align-items: center; gap: 8px; color: var(--ink-2); font-size: 12px; min-height: 24px; }
.defBody > .check { margin: 10px 0; }

.fxBlock { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--rule-soft); }
.fxHead { display: flex; align-items: center; gap: 10px; color: var(--ink-2); font-size: 12px; font-weight: 600; }
.fxRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
.fxRow select { min-width: 150px; }
.fxRow input[type="number"] { width: 84px; height: 37px; padding: 4px 8px; }
.unit { font-size: 12px; }
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
select:disabled { color: var(--ink-3); border-color: var(--rule-soft); cursor: not-allowed; }

@media (max-width: 900px) {
  .status { flex: 1 1 100%; text-align: left; }
  .ledger { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ledgerCell { border-left: 0; }
  .ledgerCell:nth-child(even) { border-left: 1px solid var(--rule-soft); }
  .ledgerCell:nth-child(n+3) { border-top: 1px solid var(--rule-soft); }
  .ledgerCell:nth-child(odd) { padding-left: 0; }
  .settleGrid { grid-template-columns: 1fr; }
  .mini { padding: 6px 10px; }
}

@media (max-width: 560px) {
  .ledgerValue { flex-wrap: wrap; gap: 4px 6px; }
  .ledgerValue input { width: 64px; }
  .resetBtn { margin-left: 0; }
  .defBody { padding-left: 0; }
  .defBody .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
  .defBody .field input, .defBody .field select { width: 100%; }
  .def > summary .sumFx { flex: 1 1 100%; padding-left: 16px; }
  .def > summary .sumTags { padding-left: 16px; }
  .fxRow select { flex: 1 1 100%; min-width: 0; }
  .fxRow .mini { margin-left: auto; }
}
</style>
