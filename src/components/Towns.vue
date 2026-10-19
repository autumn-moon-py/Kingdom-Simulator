<script setup>
import { ref, computed } from 'vue'
import { state, pushLog, logCalc, buildingAutoEffects, kingdomSkillMod, kingdomControlDC, tierIndex, tierName, fameCap, isCrowded, isBuildingLot, firstBuildScope, claimFirstBuild, createTown, useCivicActivity, civicPerSettlement, goodsCapOf, isMouse } from '../store.js'
import { mouseTierOf, rollLine } from '../rules.js'
import buildings from '../data/buildings.json'
import skillsData from '../data/skills.json'
import CheckRoll from './CheckRoll.vue'

const byName = Object.fromEntries(buildings.map((b) => [b.名称, b]))
// 48 个地块 = 12 个含 4 地块的街区，使「大都会（10+ 街区）」可达
const lotsPerTown = 48
const COLS = 8
// 王国技能 → 关键属性（用于建造检定的技能调整值）
const SKILL_ATTR = Object.fromEntries((skillsData.skills || []).map((s) => [s.name, s.attribute]))
const RESIDENTIAL = new Set(buildings.filter((b) => String(b.特质 || '').includes('住宅')).map((b) => b.名称))

const activeId = ref(null)
const pickLot = ref(null)
const autoPlace = ref(false)
const q = ref('')

const town = computed(() => state.towns.find((t) => t.id === activeId.value) || state.towns[0])
const lots = computed(() => (town.value ? town.value.lots : []))

function newTown(name) {
  const t = createTown(name)
  activeId.value = t.id
  pushLog(`建立聚落「${name}」`)
  return t
}
if (!state.towns.length) newTown('首都')
// 补齐旧聚落缺失的基础设施列表
for (const t of state.towns) if (!Array.isArray(t.infra)) t.infra = []

// 占地块数：「无」地块的基础设施不占格
function slotCount(b) {
  const n = parseInt(b.地块, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}
// 解析「建造」字段：技能列表与 DC（如「防御（专家）、工业（专家）DC 26」「工业（受训）DC 16」）
function parseBuild(b) {
  const s = String(b.建造 || '')
  if (s.includes('无')) return null
  const dcM = [...s.matchAll(/DC\s*(\d+)/g)]
  const dc = dcM.length ? Number(dcM[dcM.length - 1][1]) : null
  const head = s.split(/DC\s*\d+/)[0]
  const skills = [...new Set((skillsData.skills || []).map((x) => x.name).filter((n) => head.includes(n)))]
  return dc ? { dc, skills } : null
}
// 住宅地块数（按「住宅」特质的建筑计），用于与含建筑街区数比较判定过度拥挤
const houseCount = computed(() => lots.value.filter((x) => x && RESIDENTIAL.has(x)).length)
// 过度拥挤：住宅地块数 < 含建筑街区数（按规则自动判定）
const crowded = computed(() => (town.value ? isCrowded(town.value) : false))

// 聚落类型与派生值（王国规则 聚落类型 / 规模 / 人口 / 等级 / 消耗 / 最高物品加值 / 影响）
const SETTLEMENT_TABLE = {
  村庄: { 规模: '1 街区', 人口: '400 或更少', 等级: '1', 消耗: 1, 最高物品加值: '+1', 影响: '0', 最低王国等级: 1 },
  城镇: { 规模: '4 街区', 人口: '401–2,000', 等级: '2–4', 消耗: 2, 最高物品加值: '+1', 影响: '1 六角格', 最低王国等级: 3 },
  城市: { 规模: '9 街区', 人口: '2,001–25,000', 等级: '5–9', 消耗: 4, 最高物品加值: '+2', 影响: '2 六角格', 最低王国等级: 9 },
  大都会: { 规模: '10+ 街区', 人口: '25,001+', 等级: '10+', 消耗: 6, 最高物品加值: '+3', 影响: '3 六角格', 最低王国等级: 15 },
}
const derived = computed(() => {
  const l = lots.value
  const blocks = []
  for (let i = 0; i < l.length; i += 4) blocks.push(l.slice(i, i + 4))
  const blocksWithBuilding = blocks.filter((b) => b.some(isBuildingLot)).length
  const filledBlocks = blocks.filter((b) => b.every(Boolean)).length
  let type = '村庄'
  if (blocksWithBuilding >= 10) type = '大都会'
  else if (blocksWithBuilding >= 5) type = '城市'
  else if (blocksWithBuilding >= 2) type = '城镇'
  const t = SETTLEMENT_TABLE[type]
  return {
    含建筑街区: blocksWithBuilding,
    填满街区: filledBlocks,
    地块总数: l.length,
    已建地块: l.filter((v) => v && v !== '瓦砾').length,
    类型: type,
    聚落等级: Math.min(20, blocksWithBuilding),
    ...t,
    达标: state.level >= t.最低王国等级,
  }
})

function affordable(b) {
  const c = b.cost || {}
  if ((c.RP || 0) > state.rp) return false
  return Object.keys(c).every((k) => k === 'RP' || (state.goods[k] || 0) >= c[k])
}
// 拆除返还：把建筑花费减半（升级/替换时按「升级自」规则扣除旧建筑全部花费）
function costOf(name) {
  const b = byName[name]
  return (b && b.cost) || {}
}

const choices = computed(() => {
  const k = q.value.trim()
  return buildings
    .filter((b) => b.等级 <= state.level)
    .filter((b) => !k || b.名称.includes(k))
    .sort((a, b) => a.等级 - b.等级)
})

// 待建造建筑与其建造检定
const pending = ref(null)
const buildSkill = ref('')
const buildDice = ref('')
const buildTierPick = ref('')
const useUpgrade = ref(false)
const buildOut = ref('')
const pendingBuild = computed(() => (pending.value ? parseBuild(pending.value) : null))
const pendingUpgradeFrom = computed(() => {
  if (!pending.value || !pending.value.升级自) return null
  const has = lots.value.includes(pending.value.升级自) || (town.value.infra || []).includes(pending.value.升级自)
  return has ? pending.value.升级自 : null
})
function openBuild(b) {
  pending.value = b
  const pb = parseBuild(b)
  buildSkill.value = pb && pb.skills.length ? pb.skills[0] : ''
  buildDice.value = ''
  buildTierPick.value = ''
  useUpgrade.value = false
  buildOut.value = ''
}
// 街区限制：垃圾场/铸造厂/制革厂不能与住宅建筑共用街区（制革厂允许出租屋）
function blockHasResidence(start, need) {
  if (!town.value) return false
  const row = Math.floor(start / COLS)
  const block = town.value.lots.slice(row * COLS, row * COLS + COLS)
  return block.some((x) => x && RESIDENTIAL.has(x) && !(pending.value.名称 === '制革厂' && x === '出租屋'))
}
// 建造与拆除都是活动阶段第 3 步的市政活动：每尝试一次就占掉一个名额，结果写回提示里
function civicNote() {
  const used = useCivicActivity()
  return `（市政活动 已用 ${used} / ${state.settlements * civicPerSettlement()}）`
}
// 自动放置：替用户挑第一块放得下的空地块（同一行要够 need 格，受限建筑还要避开有住宅的街区）
function autoLot(name, need) {
  const t = town.value
  if (!t) return -1
  for (let start = 0; start < t.lots.length; start++) {
    if (t.lots[start] !== null) continue
    const row = Math.floor(start / COLS)
    const rowFree = t.lots.slice(row * COLS, row * COLS + COLS).filter((x) => x === null).length
    if (need > rowFree) continue
    if (need > 0 && ['垃圾场', '铸造厂', '制革厂'].includes(name) && blockHasResidence(start, need)) continue
    return start
  }
  return -1
}
function build(b) {
  const t = town.value
  if (!t || pending.value !== b) return
  const pb = parseBuild(b)
  const need = slotCount(b)
  let start = pickLot.value
  if (start === null && autoPlace.value) {
    start = need === 0 ? 0 : autoLot(b.名称, need)
    if (start < 0) { buildOut.value = '没有放得下的空地块。'; return }
  }
  if (start === null) { buildOut.value = '请先选中一块空地块。'; return }
  if (t.lots[start] === RUBBLE) { buildOut.value = '该地块堆有瓦砾，须先通过拆除活动清除后才能建造。'; return }
  // 宫殿（15 级）：只能建在你的首都（首都＝state.towns[0]）
  if (b.名称 === '宫殿' && state.towns[0] !== t) { buildOut.value = '宫殿只能建在你的首都。'; return }
  // 街区限制与行内空位：先校验，避免付了钱才发现放不下
  if (need > 0 && ['垃圾场', '铸造厂', '制革厂'].includes(b.名称) && blockHasResidence(start, need)) {
    buildOut.value = `${b.名称} 不能与住宅建筑共用同一街区。`
    return
  }
  const row = Math.floor(start / COLS)
  const rowFree = t.lots.slice(row * COLS, (row + 1) * COLS).filter((x) => x === null).length
  if (need > 0 && need > rowFree) { buildOut.value = `同一行空地块不足，这一座需要 ${need} 格。`; return }
  // 建造检定：技能 + d20（外部录入）对抗 DC
  const mouse = isMouse()
  let r = null, buildSkillName = '', buildMod = 0, buildTotal = 0, buildTier = ''
  if (pb) {
    r = mouse ? 0 : Number(buildDice.value)
    if (mouse ? mouseTierOf(buildTierPick.value) < 0 : !(r >= 1 && r <= 20)) {
      buildOut.value = mouse ? '请先选择鼠鼠检定结果。' : '请填入桌上掷出的 d20（1–20）。'
      return
    }
    if (!buildSkill.value) { buildOut.value = '请选择建造检定使用的技能。'; return }
    const attr = SKILL_ATTR[buildSkill.value] || '稳定'
    buildSkillName = buildSkill.value
    buildMod = kingdomSkillMod(buildSkillName, attr)
    buildTotal = mouse ? 0 : r + buildMod
    buildTier = mouse ? tierName(mouseTierOf(buildTierPick.value)) : tierName(tierIndex(buildTotal, pb.dc, r))
  }
  const c = b.cost || {}
  // 升级建造：若聚落已有「升级自」建筑，可扣除其花费并替换它
  let discount = {}
  let replaced = ''
  if (useUpgrade.value && pendingUpgradeFrom.value) {
    replaced = pendingUpgradeFrom.value
    discount = costOf(replaced)
  }
  // 规则：先支付 RP 与商品，再进行检定；失败不退费，下个王国回合可免费续建
  const pendingKey = `${t.id}:${b.名称}`
  const alreadyPaid = (state.pendingBuilds || []).some((x) => x.key === pendingKey)
  const payRP = alreadyPaid ? 0 : Math.max(0, (c.RP || 0) - (discount.RP || 0))
  const payGoods = {}
  if (!alreadyPaid) {
    if (payRP > state.rp) { buildOut.value = '资源点不足。'; return }
    for (const k of Object.keys(c)) {
      if (k === 'RP') continue
      const needGood = Math.max(0, c[k] - (discount[k] || 0))
      if (needGood > (state.goods[k] || 0)) { buildOut.value = `${k} 不足。`; return }
      payGoods[k] = needGood
    }
  }
  if (!alreadyPaid) {
    state.rp -= payRP
    for (const [k, v] of Object.entries(payGoods)) state.goods[k] -= v
  }
  // 检定失败：花费已支付，记录待续建；不替换旧建筑、不占地块
  if (pb && (buildTier === '失败' || buildTier === '大失败')) {
    const civic = civicNote()
    if (!alreadyPaid) {
      state.pendingBuilds = state.pendingBuilds || []
      state.pendingBuilds.push({ key: pendingKey, townId: t.id, name: b.名称, start, paid: { RP: payRP, ...payGoods } })
    }
    const line = rollLine({ mouse, dc: pb.dc, d: r, mod: mouse ? 0 : buildMod, total: buildTotal, tier: buildTier })
    buildOut.value = `建造检定 ${buildSkillName}：${line}，本次建造失败（花费已支付；下个王国回合可在同一聚落免费续建）。${civic}`
    logCalc('聚落建造·检定失败', {
      rule: '建造建筑需先花费 RP 与商品，再进行该建筑指定的技能检定；失败则建造未成功，下个王国回合可继续完成且无需重新支付（王国规则 建筑）。',
      input: { 建筑: b.名称, 技能: buildSkillName, DC: pb.dc, 调整值: buildMod, 已付RP: payRP },
      steps: { d20: mouse ? '—' : r, 鼠鼠结果: mouse ? buildTierPick.value : '—', 检定结果: mouse ? '—' : buildTotal },
      output: { 分级: buildTier, 待续建: true },
    })
    buildTierPick.value = ''
    return
  }
  const civic = civicNote()
  // 成功：大成功返还所花费商品的一半；移除待续建记录；升级时替换旧建筑
  if (pb && buildTier === '大成功') {
    for (const [k, v] of Object.entries(payGoods)) {
      const back = Math.floor(v / 2)
      if (back) state.goods[k] = Math.min(goodsCapOf(k), (state.goods[k] || 0) + back)
    }
  }
  state.pendingBuilds = (state.pendingBuilds || []).filter((x) => x.key !== pendingKey)
  if (replaced) {
    const li = t.lots.indexOf(replaced); if (li >= 0) t.lots[li] = null
    const ii = (t.infra || []).indexOf(replaced); if (ii >= 0) t.infra.splice(ii, 1)
  }
  if (need === 0) {
    // 基础设施不占地块
    t.infra.push(b.名称)
  } else {
    let placed = 0
    for (let i = start; i < t.lots.length && placed < need; i++) {
      if (t.lots[i] === null) { t.lots[i] = b.名称; placed++ }
    }
    // 磨坊：是否临水由手工标记
  }
  // 建筑效果：结构化字段「祸患」+ 从「效果」文本解析的自动效果（建造时动荡减少等）
  const effs = []
  if (b.祸患) {
    const hit = ['腐化', '犯罪', '衰败', '内讧'].find((x) => String(b.祸患).includes(x))
    if (hit) { state.ruin[hit] = (state.ruin[hit] || 0) + 1; effs.push(`${hit} +1`) }
    else effs.push(`需手动处理祸患：${b.祸患}`)
  }
  // 「首次建造」类效果：按范围记账（任何聚落一次／每座聚落一次／每个王国回合一次）后判定是否生效
  const scope = firstBuildScope(b.效果)
  const countInTown = (nm) => [...(t.lots || []), ...(t.infra || [])].filter((x) => x === nm).length
  const firstOk = scope ? claimFirstBuild(b.名称, scope, t.id) : true
  for (const e of buildingAutoEffects(b.效果)) {
    const isFirstKind = e.type === 'unrest' || e.type === 'ruinAdd' || e.type === 'ruinSub'
    if (isFirstKind && scope && !firstOk) continue
    // 酿酒厂：仅当该聚落中酿酒厂不足 4 座时才减动荡（去掉本次刚建的那座后仍有 4 座则不再生效）
    if (b.名称 === '酿酒厂' && isFirstKind && countInTown('酿酒厂') - 1 >= 4) continue
    if (e.type === 'unrest') { state.unrest = Math.max(0, state.unrest + e.value); effs.push(`动荡 ${e.value}`) }
    else if (e.type === 'ruinAdd') { state.ruin[e.cat] = (state.ruin[e.cat] || 0) + e.value; effs.push(`${e.cat} +${e.value}`) }
    else effs.push(e.label)   // 掷骰减动荡／祸患减少／消耗减少：提示手工施加
  }
  // 著名／臭名昭著：建成时 +1 声望/恶名（两种特质同时存在时按王国偏好取一）
  if (/著名/.test(String(b.特质 || ''))) {
    state.fame = Math.min(fameCap(), (state.fame || 0) + 1)
    effs.push(`${state.fameKind} +1`)
  }
  const effNote = effs.length ? effs.join('；') : ''
  pushLog(`在「${t.name}」${replaced ? '升级建造' : alreadyPaid ? '续建' : '建造'} ${b.名称}（${alreadyPaid ? '上回合已付费' : `花 ${payRP} 资源点`}）${effNote ? '；' + effNote : ''}`)
  logCalc('聚落建造·' + b.名称, {
    rule: '建筑在市政活动步骤通过建造建筑活动建造：先花费 RP 与商品，再进行该建筑指定的技能检定；升级建造时从新建筑花费中减去旧建筑花费并替换之；「无」地块的基础设施不占地块；垃圾场/铸造厂/制革厂不能与住宅共用街区；「首次建造」类效果按范围（任何聚落/每座聚落/每回合）只结算一次；带著名/臭名昭著特质的建筑建成时 +1 声望/恶名（王国规则 建筑）',
    input: {
      聚落: t.name, 建筑: b.名称, 建筑等级: b.等级, 王国等级: state.level, 建造检定: pb ? `${buildSkillName} DC ${pb.dc}` : '无',
      占地块数: need, 花费: b.花费, 升级自: replaced || '—', 起始地块: start,
    },
    formula: '扣除 RP 与商品（升级时减去旧建筑花费）；再结算建筑效果',
    steps: { 建造前资源点: state.rp + payRP, 建造后资源点: state.rp },
    output: { 建造后资源点: state.rp, 是否占地块: need > 0, 建筑效果: effNote || '无' },
  })
  buildOut.value = `${b.名称} ${replaced ? `（升级自 ${replaced}）` : alreadyPaid ? '（续建）' : ''}建造完成（地块 ${start}），${alreadyPaid ? '本回合未再付费' : `花 ${payRP} 资源点`}。${effNote ? ' ' + effNote : ''}${civic}`
  pending.value = null
  pickLot.value = null
  q.value = ''
  buildDice.value = ''
  buildTierPick.value = ''
}

function demolishInfra(i) {
  const t = town.value
  const name = t.infra[i]
  if (!name) return
  t.infra.splice(i, 1)
  pushLog(`拆除「${t.name}」的 ${name}（基础设施）`)
}

// ---- 拆除活动 / 瓦砾 / 修理受损建筑 ----
const RUBBLE = '瓦砾'
const actionLot = ref(null)        // 选中的已建/瓦砾地块（拆除或修理）
const demolishDice = ref('')
const demolishTierPick = ref('')
const demolishOut = ref('')
const repairDice = ref('')
const repairTierPick = ref('')
// 修理检定的 DC：与该建筑的建造 DC 相同；无法解析时退回控制 DC
const pendingRepairDC = computed(() => {
  const t = town.value
  const i = actionLot.value
  if (!t || i === null) return kingdomControlDC()
  const b = byName[t.lots[i]]
  const pb = b ? parseBuild(b) : null
  return pb ? pb.dc : kingdomControlDC()
})
// 与点击地块同名且连续的同类地块（多格建筑占用多格）
function instanceLots(t, i) {
  const v = t.lots[i]
  if (!v) return []
  let s = i; let e = i
  while (s - 1 >= 0 && t.lots[s - 1] === v) s--
  while (e + 1 < t.lots.length && t.lots[e + 1] === v) e++
  const out = []
  for (let k = s; k <= e; k++) out.push(k)
  return out
}
function lotDamaged(t, i) { return Array.isArray(t.damagedLots) && t.damagedLots.includes(i) }
function markDamaged(i) {
  const t = town.value
  if (!Array.isArray(t.damagedLots)) t.damagedLots = []
  const name = t.lots[i]
  if (t.lots[i] === RUBBLE) { demolishOut.value = '瓦砾不能标记为受损。'; return }
  const idxs = instanceLots(t, i)
  t.damagedLots = [...new Set([...t.damagedLots, ...idxs])]
  demolishOut.value = `${name} 已标记为受损（修理需花一半花费并做建造检定，现有建筑 +2 物品加值）`
}
function unmarkDamaged(i) {
  const t = town.value
  if (!Array.isArray(t.damagedLots)) return
  t.damagedLots = t.damagedLots.filter((x) => !instanceLots(t, i).includes(x))
  demolishOut.value = '已取消受损标记'
}
// 拆除活动：工程基础检定；成功清空该地块，失败化为瓦砾；对瓦砾成功则清除瓦砾
function doDemolish() {
  const t = town.value
  const i = actionLot.value
  if (!t || i === null) return
  const name = t.lots[i]
  if (!name) { demolishOut.value = '该地块没有建筑。'; return }
  const mouse = isMouse()
  const r = mouse ? 0 : Number(demolishDice.value)
  if (mouse ? mouseTierOf(demolishTierPick.value) < 0 : !(r >= 1 && r <= 20)) {
    demolishOut.value = mouse ? '请先选择鼠鼠检定结果。' : '请填入桌上掷出的 d20（1–20）。'
    return
  }
  const dc = kingdomControlDC()
  const m = mouse ? 0 : kingdomSkillMod('工程', '稳定')
  const total = mouse ? 0 : r + m
  const tier = mouse ? tierName(mouseTierOf(demolishTierPick.value)) : tierName(tierIndex(total, dc, r))
  const idxs = instanceLots(t, i)
  if (tier === '大成功' || tier === '成功') {
    for (const k of idxs) t.lots[k] = null
    if (Array.isArray(t.damagedLots)) t.damagedLots = t.damagedLots.filter((x) => !idxs.includes(x))
    demolishOut.value = `${name === RUBBLE ? '瓦砾已清除' : `已拆除 ${name}`}（${idxs.length} 格）；大成功另返还所花费商品的一半（手工结算）`
  } else {
    for (const k of idxs) t.lots[k] = RUBBLE
    demolishOut.value = `拆除失败：${name} 化为瓦砾（${idxs.length} 格），需再次拆除清除后才能建造`
    if (tier === '大失败') { state.unrest += 1; demolishOut.value += '；动荡 +1' }
  }
  demolishOut.value += ' ' + civicNote()
  logCalc('聚落·拆除活动', {
    rule: '拆除：选择一块被占用的地块，进行基础工程检定；成功把它化为碎石并清走，为新建筑腾出空间；失败的拆除会使该地块化为瓦砾。瓦砾妨碍在这些地块中建造，必须先拆除清除（王国规则 建筑 / 拆除）。d20 由玩家在桌上掷出后录入。',
    input: { 聚落: t.name, 地块: i, 目标: name, 技能调整值: m, 控制DC: dc },
    formula: '检定结果 = d20 + 工程技能调整值，对抗控制 DC',
    steps: { 玩家掷出的d20: mouse ? '—' : r, 鼠鼠结果: mouse ? demolishTierPick.value : '—', 检定结果: mouse ? '—' : total },
    output: { 分级: tier, 地块状态: t.lots[i] || '空' },
  })
  demolishDice.value = ''
  demolishTierPick.value = ''
  actionLot.value = null
}
// 修理受损建筑：花该建筑花费的一半，做建造检定（现有建筑提供 +2 物品加值）
function doRepair() {
  const t = town.value
  const i = actionLot.value
  if (!t || i === null) return
  const name = t.lots[i]
  const b = byName[name]
  if (!b) { demolishOut.value = '该地块没有可修理的建筑。'; return }
  if (!lotDamaged(t, i)) { demolishOut.value = '该建筑未标记为受损。'; return }
  const mouse = isMouse()
  const rr = mouse ? 0 : Number(repairDice.value)
  if (mouse ? mouseTierOf(repairTierPick.value) < 0 : !(rr >= 1 && rr <= 20)) {
    demolishOut.value = mouse ? '请先选择鼠鼠检定结果。' : '请填入桌上掷出的 d20（1–20）。'
    return
  }
  const c = b.cost || {}
  const halfRP = Math.floor((c.RP || 0) / 2)
  const pb = parseBuild(b)
  // 先扣一半花费
  if (halfRP > state.rp) { demolishOut.value = `资源点不足（需 ${halfRP} RP）。`; return }
  for (const k of Object.keys(c)) if (k !== 'RP' && Math.floor(c[k] / 2) > (state.goods[k] || 0)) { demolishOut.value = `${k} 不足。`; return }
  state.rp -= halfRP
  for (const k of Object.keys(c)) if (k !== 'RP') state.goods[k] -= Math.floor(c[k] / 2)
  const skill = pb && pb.skills.length ? pb.skills[0] : '工程'
  const attr = SKILL_ATTR[skill] || '稳定'
  const mod = mouse ? 0 : kingdomSkillMod(skill, attr) + 2   // 现有建筑 +2 物品加值
  const dc = pb ? pb.dc : kingdomControlDC()
  const total = mouse ? 0 : rr + mod
  const tier = mouse ? tierName(mouseTierOf(repairTierPick.value)) : tierName(tierIndex(total, dc, rr))
  const line = rollLine({ mouse, dc, d: rr, mod: mouse ? 2 : mod, total, tier })
  const civic = civicNote()
  const idxs = instanceLots(t, i)
  if (tier === '大成功' || tier === '成功') {
    t.damagedLots = (t.damagedLots || []).filter((x) => !idxs.includes(x))
    if (tier === '大成功') {
      // 大成功：返还所花费商品的一半（RP 不返还）
      for (const k of Object.keys(c)) {
        if (k === 'RP') continue
        const back = Math.floor(Math.floor(c[k] / 2) / 2)
        if (back) state.goods[k] = Math.min(goodsCapOf(k), (state.goods[k] || 0) + back)
      }
    }
    demolishOut.value = `修理完成：${name}（花 ${halfRP} RP，${line}，含现有建筑 +2）${civic}`
  } else if (tier === '大失败') {
    // 大失败：受损建筑化为瓦砾
    for (const k of idxs) t.lots[k] = RUBBLE
    t.damagedLots = (t.damagedLots || []).filter((x) => !idxs.includes(x))
    demolishOut.value = `修理大失败：${name} 化为瓦砾（${line}），花费已消耗，须先拆除瓦砾再重建。${civic}`
  } else {
    demolishOut.value = `修理失败：${name} 仍受损（${line}），花费已消耗。${civic}`
  }
  logCalc('聚落·修理受损建筑', {
    rule: '修理受损但尚未被碎石取代的建筑：先花费该建筑所列 RP 与商品成本的一半，进行该建筑的建造检定，现有建筑为此检定提供 +2 物品加值（王国规则 建筑）。d20 由玩家在桌上掷出后录入。',
    input: { 聚落: t.name, 建筑: name, 花费一半RP: halfRP, 适用技能: skill, 技能调整值: mod, 对抗DC: dc },
    formula: '检定结果 = d20 + 技能调整值 + 2（现有建筑）',
    steps: { 玩家掷出的d20: mouse ? '—' : rr, 鼠鼠结果: mouse ? repairTierPick.value : '—', 检定结果: mouse ? '—' : total },
    output: { 分级: tier, 仍受损: lotDamaged(t, i) },
  })
  repairDice.value = ''
  repairTierPick.value = ''
  actionLot.value = null
}

function addTown() {
  const name = prompt('新聚落名称', '新村庄')
  if (name) newTown(name)
}
// 磨坊临水标记（消耗减免用）
function toggleWaterMill() { town.value.waterMill = !town.value.waterMill }
</script>

<template>
  <div class="panel">
    <h2>聚落<span class="muted"> · 共 {{ state.towns.length }} 座</span></h2>
    <div class="row">
      <div class="field" v-for="t in state.towns" :key="t.id">
        <label>{{ t.lots.filter(Boolean).length }} / {{ lotsPerTown }} 地块</label>
        <button class="act" :class="{ on: t.id === (town && town.id) }" @click="activeId = t.id">{{ t.name }}</button>
      </div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="addTown">新建聚落</button></div>
    </div>
  </div>

  <div class="panel" v-if="town">
    <h2>
      {{ town.name }}
      <span class="muted">住宅 {{ houseCount }} 座{{ crowded ? ' · 过度拥挤（每回合 +1 动荡）' : '' }}</span>
    </h2>
    <div class="field" style="margin-bottom: 12px">
      <label>聚落名称</label>
      <input v-model="town.name" style="width: 220px" />
    </div>

    <table style="margin-bottom: 14px">
      <thead><tr><th>类型</th><th>规模</th><th>人口</th><th style="width: 80px">聚落等级</th><th style="width: 60px">消耗</th><th style="width: 90px">最高物品加值</th><th style="width: 90px">影响</th><th style="width: 110px">含建筑／填满街区</th><th style="width: 110px">已建／全部地块</th></tr></thead>
      <tbody>
        <tr>
          <td>{{ derived.类型 }}<span class="muted" v-if="!derived.达标">（需王国 {{ derived.最低王国等级 }} 级）</span></td>
          <td>{{ derived.规模 }}</td>
          <td class="muted">{{ derived.人口 }}</td>
          <td class="num">{{ derived.聚落等级 }}</td>
          <td class="num">{{ derived.消耗 }}</td>
          <td class="num">{{ derived.最高物品加值 }}</td>
          <td>{{ derived.影响 }}</td>
          <td class="num">{{ derived.含建筑街区 }} / {{ derived.填满街区 }}</td>
          <td class="num">{{ derived.已建地块 }} / {{ derived.地块总数 }}</td>
        </tr>
      </tbody>
    </table>

    <div class="lots">
      <button
        v-for="(v, i) in lots"
        :key="i"
        class="lot"
        :class="{ empty: !v, built: !!v, rubble: v === '瓦砾', damaged: lotDamaged(town, i), sel: pickLot === i || actionLot === i }"
        :title="v ? (v + (lotDamaged(town, i) ? '（受损）' : '')) : '空地块'"
        @click="v ? (actionLot = i, pickLot = null, demolishOut = '', demolishDice = '', repairDice = '') : (pickLot = i, actionLot = null)"
      >
        <span v-if="v">{{ v }}<span v-if="lotDamaged(town, i)" class="mk">受损</span></span><span v-else class="empty">空</span>
      </button>
    </div>
    <div class="check" style="margin-top: 8px">
      <input type="checkbox" v-model="autoPlace" id="autoplace" />
      <label for="autoplace">自动放置（不用先点地块，由系统挑第一块放得下的空地）</label>
    </div>
    <p class="muted" style="margin-top: 8px">点空地块选中它，再从下方选建筑；点已建成/瓦砾的格子可拆除或修理。</p>

    <div v-if="actionLot !== null" class="opblock">
      <h2 style="width: 100%">地块 {{ actionLot }}：{{ lots[actionLot] }}<span class="muted" v-if="lotDamaged(town, actionLot)"> · 受损</span></h2>
      <div class="field">
        <CheckRoll bare v-model:dice="demolishDice" v-model:tier="demolishTierPick" :dc="kingdomControlDC()" label="拆除活动（工程基础检定）" width="80px" />
        <button class="act" @click="doDemolish">{{ lots[actionLot] === '瓦砾' ? '清除瓦砾' : '拆除' }}</button>
      </div>
      <template v-if="lots[actionLot] !== '瓦砾'">
        <div class="field">
          <CheckRoll bare v-model:dice="repairDice" v-model:tier="repairTierPick" :dc="pendingRepairDC" label="修理受损（花一半花费，现有建筑 +2）" width="80px" />
          <button class="act" :disabled="!lotDamaged(town, actionLot)" @click="doRepair">修理</button>
        </div>
        <div class="field">
          <label>受损标记</label>
          <button class="act" v-if="!lotDamaged(town, actionLot)" @click="markDamaged(actionLot)">标记受损</button>
          <button class="act" v-else @click="unmarkDamaged(actionLot)">取消受损</button>
        </div>
      </template>
      <div class="field"><label>&nbsp;</label><button class="act" @click="actionLot = null">关闭</button></div>
    </div>
    <p class="muted" v-if="demolishOut">{{ demolishOut }}</p>
    <div class="row" style="margin-top: 8px">
      <div class="field">
        <label>基础设施</label>
        <span v-if="!(town.infra || []).length" class="muted">无</span>
        <span v-else>
          <span class="chip" v-for="(name, i) in town.infra" :key="i">{{ name }}<button class="x" @click="demolishInfra(i)">×</button></span>
        </span>
      </div>
      <div class="field">
        <label>临水磨坊</label>
        <button class="act" :class="{ on: town.waterMill }" @click="toggleWaterMill">{{ town.waterMill ? '已标记（消耗 −1）' : '未标记' }}</button>
      </div>
    </div>

    <template v-if="pickLot !== null || autoPlace">
      <h2 style="margin-top: 20px">建造建筑<span class="muted" v-if="pickLot !== null"> · 地块 {{ pickLot }}</span></h2>
      <div class="row" style="margin-bottom: 12px">
        <div class="field">
          <label>筛选（仅列王国等级 {{ state.level }} 及以下）</label>
          <input v-model="q" placeholder="如 旅店、兵营" style="width: 200px" />
        </div>
      </div>
      <table>
        <thead><tr><th style="width: 150px">建筑</th><th style="width: 50px">等级</th><th style="width: 50px">地块</th><th style="width: 190px">花费</th><th style="width: 80px">建造</th><th>效果</th></tr></thead>
        <tbody>
          <tr v-for="b in choices" :key="b.名称">
            <td>{{ b.名称 }}</td>
            <td class="num">{{ b.等级 }}</td>
            <td class="num">{{ slotCount(b) || '无' }}</td>
            <td>{{ b.花费 }}</td>
            <td><button class="act" :disabled="!affordable(b)" @click="openBuild(b)">选择</button></td>
            <td class="muted">{{ (b.效果 || '').slice(0, 70) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted" v-if="!choices.length">没有符合条件的建筑。</p>

      <div v-if="pending" class="opblock">
        <h2 style="width: 100%">建造 {{ pending.名称 }}<span class="muted"> · {{ pending.建造 || '无建造检定' }}</span></h2>
        <template v-if="pendingBuild">
          <div class="field">
            <label>建造技能</label>
            <select v-model="buildSkill" style="min-width: 140px">
              <option v-for="s in pendingBuild.skills" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="field"><label>DC</label><div class="num">{{ pendingBuild.dc }}</div></div>
          <CheckRoll v-model:dice="buildDice" v-model:tier="buildTierPick" :dc="pendingBuild.dc" label="桌上掷出的 d20" width="80px" />
        </template>
        <div class="field" v-if="pendingUpgradeFrom">
          <label>升级建造</label>
          <div class="check"><input type="checkbox" v-model="useUpgrade" id="upg" /><label for="upg">以「{{ pendingUpgradeFrom }}」升级（扣除其花费并替换）</label></div>
        </div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="build(pending)">确认建造</button></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="pending = null">取消</button></div>
      </div>
      <p class="muted" v-if="buildOut">{{ buildOut }}</p>
    </template>
  </div>
</template>

<style scoped>
.lots { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; max-width: 760px; }
.lot {
  appearance: none;
  min-height: 56px;
  border: 1px solid var(--rule);
  background: var(--paper-2);
  border-radius: 3px;
  font: inherit;
  font-size: 12px;
  color: var(--ink-2);
  cursor: pointer;
  padding: 2px;
  overflow: hidden;
  line-height: 1.2;
}
.lot:hover { border-color: var(--ochre-soft); }
.lot.empty { background: transparent; border-color: var(--rule-soft); }
.lot.built { background: var(--cover-old); color: var(--ink); border-color: var(--ochre-soft); }
.lot.rubble { background: var(--rule-soft); color: var(--ink); font-style: italic; }
.lot.damaged { background: var(--wash-damage); border-color: var(--warn); }
.lot .mk { color: var(--warn); font-size: 12px; display: block; }
.lot.sel { border-color: var(--warn); border-width: 2px; background: var(--wash-damage); }
.lot .empty { color: var(--ink-3); }
.act.on { border-color: var(--ochre); color: var(--ochre); background: var(--cover-old); }
.opblock { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; padding: 10px 12px; border: 1px solid var(--rule-soft); border-radius: 6px; }
.chip { display: inline-flex; align-items: center; font-size: 12px; padding: 2px 4px 2px 7px; margin: 2px 6px 0 0; border: 1px solid var(--rule-soft); border-radius: 3px; background: var(--cover-old); }
.chip .x { appearance: none; border: 0; background: transparent; color: var(--ink-2); cursor: pointer; font: inherit; padding: 0 3px; margin-left: 4px; }
.chip .x:hover { color: var(--warn); }
</style>
