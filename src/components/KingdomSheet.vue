<script setup>
import { computed, ref, watch } from 'vue'
import { state, ATTRS, GOODS, attrMod, diceCount, dieType, goodsCap, goodsCapOf, storageBonus, unrestPenalty, resetAll, pushLog, claimedCount, claimLimit, logCalc, claimEnvBonus, effectiveRuinThreshold, fameCap, hasFeat, skillFeatBonus, canIgnoreFirst, buildingBonus, buildingBonusList, kingdomSkillMod, kingdomControlDC, backupInfo, restoreBackup, anarchyThreshold, createTown, useRegionActivity, regionActivitiesLeft, useClaimAttempt, claimsThisTurn, vacancyActivityMod, leaderActivityCap, isMouse } from '../store.js'
import { mouseTierOf, mouseDC, luckDie } from '../rules.js'
import roles from '../data/roles.json'
import mapLabels from '../data/mapLabels.json'
import { groupByRegion } from '../regions.js'
import abilities from '../data/abilities.json'
import feats from '../data/feats.json'
import skillsData from '../data/skills.json'
import Hint from './Hint.vue'
import CheckRoll from './CheckRoll.vue'

const poolCount = computed(() => diceCount(Number(state.level) || 0))
const die = computed(() => dieType(Number(state.hexCount) || 0))
const cap = computed(() => goodsCap(Number(state.hexCount) || 0))
const penalty = computed(() => unrestPenalty(Number(state.unrest) || 0))

function sign(n) {
  return (n >= 0 ? '+' : '') + n
}
function reset() {
  if (confirm('确定要把王国卡重置为初始状态吗？备注与占据记录也会清空。')) resetAll()
}

const RUINS = ['腐化', '犯罪', '衰败', '内讧']
const RUIN_ATTR = { 腐化: '文化', 犯罪: '经济', 衰败: '稳定', 内讧: '忠诚' }

// --- 工地与农田 ---
const WORK_TYPES = [
  { name: '伐木营地', goods: '木材', terrain: '含大量森林地形的六角格', bonusKey: '建立工地（伐木场）' },
  { name: '矿场', goods: '矿石', terrain: '含大量丘陵或山脉地形的六角格', bonusKey: '建立工地（矿场）' },
  { name: '采石场', goods: '石材', terrain: '含大量丘陵或山脉地形的六角格', bonusKey: '建立工地（采石场）' },
]
const workType = ref('伐木营地')
const workHex = ref('')
const workCost = ref(2)
const workInput = ref('')
const workTier = ref('')
const workOut = ref('')
// 崎岖地形 RP 成本（取该六角格内最险恶地形的花费：山脉12／沼泽8／森林4／丘陵2／平原1）
const TERRAIN_COST = { 平原: 1, 丘陵: 2, 森林: 4, 沼泽: 8, 山脉: 12 }
const workTerrain = ref('平原')
function setWorkCost() { workCost.value = TERRAIN_COST[workTerrain.value] || 1 }
function buildWorksite() {
  if (!workHex.value) { workOut.value = '先填六角格编号。'; return }
  const c = readCheck(workInput, workTier, workOut)
  if (!c) return
  const cost = Number(workCost.value) || 0
  if (cost > state.rp) { workOut.value = '资源点不足。'; return }
  if (!startRegion(workOut, '建立工地')) return
  state.rp -= cost
  workInput.value = ''
  workTier.value = ''
  const wt = WORK_TYPES.find((x) => x.name === workType.value)
  const bb = buildingBonus(wt.bonusKey)
  const m = regionMod('工程', '稳定') + bb
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, controlDC.value)
  let doubled = false
  if (t === '大成功' || t === '成功') {
    doubled = t === '大成功'
    state.worksites.push({ id: Date.now().toString(36), type: wt.name, goods: wt.goods, hex: workHex.value, doubled })
  } else if (t === '大失败') state.unrest += 1
  logCalc('建立工地·' + wt.name, {
    rule: '建立工地：按六角格最险恶地形花费 RP，进行一次基础检定；成功即建立工地；大成功另在到下一个王国回合结束前产量翻倍；大失败动荡 +1（王国规则 建立工地）',
    input: { 工地类型: wt.name, 适用地形: wt.terrain, 六角格: workHex.value, 花费RP: cost, 技能调整值: m, 建筑加值: bb, 控制DC: controlDC.value },
    formula: 'd20 + 技能调整值（含建筑物品加值），对抗控制 DC',
    steps: { d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? workTier.value : '—', 检定结果: c.mouse ? '—' : total },
    output: { 结果: t, 是否建立: t === '大成功' || t === '成功', 产量翻倍: doubled, 剩余RP: state.rp },
  })
  workOut.value = `${regionLine(c, controlDC.value, m, total, t)}` + (doubled ? '，工地建立且产量翻倍' : t === '大成功' || t === '成功' ? '，工地建立' : t === '大失败' ? '，动荡 +1' : '')
}
function removeWorksite(i) { state.worksites.splice(i, 1) }

const farmTerrain = ref('平原')
const farmInput = ref('')
const farmTier = ref('')
const farmHex = ref('')
const farmHex2 = ref('')
const farmOut = ref('')
function buildFarm() {
  const c = readCheck(farmInput, farmTier, farmOut)
  if (!c) return
  if (!farmHex.value) { farmOut.value = '请填入该农田所在的六角格编号。'; return }
  const cost = farmTerrain.value === '平原' ? 1 : 2
  if (cost > state.rp) { farmOut.value = '资源点不足。'; return }
  if (!startRegion(farmOut, '开垦农田')) return
  state.rp -= cost
  farmInput.value = ''
  farmTier.value = ''
  const dc = controlDC.value + (farmTerrain.value === '平原' ? 0 : 5)
  const m = regionMod('农业', '稳定')
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, dc)
  let gained = 0
  const added = []
  if (t === '大成功') {
    gained = farmHex2.value ? 2 : 1
    state.farmHexes.push(farmHex.value); added.push(farmHex.value)
    if (farmHex2.value) { state.farmHexes.push(farmHex2.value); added.push(farmHex2.value) }
  } else if (t === '成功') { gained = 1; state.farmHexes.push(farmHex.value); added.push(farmHex.value) }
  farmHex.value = ''; farmHex2.value = ''
  logCalc('开垦农田', {
    rule: '开垦农田：要求该六角格主要地形为平原或丘陵、且处于某座聚落影响范围内；平原花 1RP 对抗控制 DC，丘陵花 2RP 对抗控制 DC+5。大成功开出两个相邻农田（在第二个格号框填入相邻格），成功开出一个（王国规则 开垦农田）',
    input: { 地形: farmTerrain.value, 花费RP: cost, 目标DC: dc, 技能调整值: m },
    formula: 'd20 + 技能调整值，对抗控制 DC（丘陵 +5）',
    steps: { d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? farmTier.value : '—', 检定结果: c.mouse ? '—' : total },
    output: { 结果: t, 新增农田: gained, 农田格号: state.farmHexes.slice(), 剩余RP: state.rp },
  })
  farmOut.value = `${regionLine(c, dc, m, total, t)}` + (gained ? `，新增 ${gained} 个农田六角格（${added.join('、')}）` : t === '大失败' ? '，接下来两个事件阶段开始时各掷一次 DC 6 平值检定' : '')
}

// --- 等级进阶 ---
// 已获得的次数：有 every 的按“从 from 级起每 every 级一次”计
function gainedCount(name) {
  const a = abilities.find((x) => x.name === name)
  if (!a || state.level < a.from) return 0
  if (!a.every) return 1
  return Math.floor((state.level - a.from) / a.every) + 1
}
const boostAvail = computed(() => Math.max(0, gainedCount('属性提升') - state.boostsUsed))
const skillIncAvail = computed(() => Math.max(0, gainedCount('技能提升') - state.skillIncreasesUsed))
const featAvail = computed(() => Math.max(0, gainedCount('王国专长') - state.selectedFeats.length))
const boostPick = ref(['', ''])
function applyBoost() {
  const picks = boostPick.value.filter(Boolean)
  if (picks.length !== 2 || new Set(picks).size !== 2) return
  const delta = {}
  picks.forEach((a) => {
    const inc = state.attributes[a] < 18 ? 2 : 1
    delta[a] = { 提升前: state.attributes[a], 增量: inc, 提升后: state.attributes[a] + inc }
    state.attributes[a] += inc
  })
  state.boostsUsed += 1
  logCalc('进阶·属性提升', {
    rule: '在 5 级时以及此后每 5 级，提升两项不同属性值：低于 18 则 +2，已达 18 或以上则 +1（王国规则 属性提升）',
    input: { 王国等级: state.level, 可用次数: boostAvail.value + 1, 选择属性: picks },
    formula: '属性值 += 该属性值 < 18 ? 2 : 1',
    steps: delta,
    output: { 已用次数: state.boostsUsed },
  })
  boostPick.value = ['', '']
}
const skillPick = ref('')
const skillTarget = ref('受训')
const skillNames = (skillsData.skills || []).map((s) => s.name)
function applySkillIncrease() {
  if (!skillPick.value) return
  const before = state.proficiencies[skillPick.value] || '未受训'
  state.proficiencies[skillPick.value] = skillTarget.value
  state.skillIncreasesUsed += 1
  logCalc('进阶·技能提升', {
    rule: '3 级起每 2 级一次：未受训→受训、受训→专家；7 级起可升大师，15 级起可升传奇（王国规则 技能提升）',
    input: { 王国等级: state.level, 技能: skillPick.value, 原熟练度: before, 目标熟练度: skillTarget.value },
    formula: '熟练加值：受训 等级+2、专家 +4、大师 +6、传奇 +8',
    output: { 新熟练度: state.proficiencies[skillPick.value], 已用次数: state.skillIncreasesUsed },
  })
}
// 已接入自动计算的王国专长；其余专长只在下方列表里启用并附规则备注，由玩家在桌上手动处理
const WIRED_FEATS = {
  文官制度: '豁免指定领导角色的空缺惩罚（到「维持阶段」指定）',
  勉强应付: '两项祸患阈值 +1、另一项 +2（见下方选择）',
  忍耐无政府: '动荡达到 24 才陷入无政府',
  内部交易: '每个王国回合开始 +1 奖励资源骰',
  实用魔法: '魔法检定 +1 状态加值',
  鼓舞人心的娱乐: '动荡 ≥1 时基于文化的检定 +2',
}
function featLevelOf(name) { const f = feats.find((x) => x.name === name); return f ? f.level : 1 }
function isFeatOn(name) { return (state.selectedFeats || []).includes(name) || state.bonusFeat === name }
// 专长改成「下拉选一项 + 启用/停用」：14 项全摊成表格会占掉 700px，而一次只会用到一项
const featsShown = computed(() => feats.filter((f) => f.level <= state.level || isFeatOn(f.name)))
const featsLocked = computed(() => feats.filter((f) => !featsShown.value.includes(f)))
// 下拉选中的专长：换等级／启用停用后如果它不在列表里，退到第一项
const featPick = ref('')
const featSel = computed(() => feats.find((f) => f.name === featPick.value) || featsShown.value[0] || null)
const featSelOn = computed(() => !!featPick.value && isFeatOn(featPick.value))
const featOnNames = computed(() => feats.filter((f) => isFeatOn(f.name)).map((f) => f.name))
watch(featsShown, () => {
  if (featsShown.value.some((f) => f.name === featPick.value)) return
  // 优先落在已启用的那项，一眼就能看到现在开着什么
  const on = featsShown.value.find((f) => isFeatOn(f.name))
  featPick.value = (on || featsShown.value[0] || {}).name || ''
}, { immediate: true })
// 启用／停用：只做记录与占用名额，不改变任何数值计算
function toggleFeat(name) {
  const lv = featLevelOf(name)
  if (isFeatOn(name)) {
    if (name === state.bonusFeat) { pushLog(`${name} 由政体授予，不能在此外停用。`); return }
    const i = state.selectedFeats.indexOf(name)
    if (i >= 0) state.selectedFeats.splice(i, 1)
    logCalc('王国专长·停用', {
      rule: '王国专长在本工具中主要用于记录与提示；除「已接入计算」者外不参与数值计算，效果由玩家按备注在桌上手动处理。',
      input: { 专长: name, 专长等级: lv },
      output: { 已启用专长: [...state.selectedFeats] },
    })
    pushLog(`停用王国专长：${name}`)
    return
  }
  if (lv > state.level) { pushLog(`无法启用 ${name}：需要王国等级 ${lv}（当前 ${state.level}）`); return }
  if (featAvail.value === 0) { pushLog(`无法启用 ${name}：王国专长名额已用完（可用 ${featAvail.value}）`); return }
  state.selectedFeats.push(name)
  logCalc('王国专长·启用', {
    rule: '在 2 级时以及此后每 2 级，王国获得一个王国专长；只能选取等级不高于王国等级的专长。本工具除「已接入计算」者外不接入数值计算，请按备注手动处理（王国规则 王国专长）',
    input: { 专长: name, 专长等级: lv, 可用名额: featAvail.value + 1, 是否已接入计算: WIRED_FEATS[name] || '否（仅备注）' },
    output: { 已启用专长: [...state.selectedFeats] },
  })
  pushLog(`启用王国专长：${name}${WIRED_FEATS[name] ? '（已接入计算）' : '（仅备注，不接入计算）'}`)
}

// 已经真正接入计算的机械效果（便于核对哪些专长/能力生效、哪些还只是记录）
const effectNotes = computed(() => {
  const n = []
  if (state.level >= 4) n.push(`拓张专家：占据六角格检定 +2 环境加值；每回合可占据 ${claimLimit()} 次`)
  if (state.level >= 8) n.push(`资深领导：领导角色给其关键属性相关检定 ${state.level >= 16 ? '+3' : '+2'} 状态加值`)
  if (state.level >= 12) n.push('市政规划：指定的一座聚落可作两项市政活动')
  if (state.level >= 20) n.push('举世艳羡：每回合首次动荡／祸患可忽略；声望或恶名上限 +1')
  if (hasFeat('勉强应付')) n.push('勉强应付：按下方选择提高祸患阈值')
  if (hasFeat('忍耐无政府')) n.push('忍耐无政府：动荡达到 24 才陷入无政府')
  if (hasFeat('内部交易')) n.push('内部交易：每个王国回合开始 +1 奖励资源骰')
  if (hasFeat('实用魔法')) n.push('实用魔法：魔法检定 +1 状态加值')
  if (hasFeat('鼓舞人心的娱乐')) n.push('鼓舞人心的娱乐：动荡 ≥1 时基于文化的检定 +2')
  if (hasFeat('文官制度') && state.civilServiceRole) n.push(`文官制度：${state.civilServiceRole} 空缺时不产生空缺惩罚`)
  return n
})

// --- 祸患增加入口（事件/活动造成祸患时手动调用）---
const ruinAdd = ref({ 腐化: 0, 犯罪: 0, 衰败: 0, 内讧: 0 })
// 三个结算动作共用一次「选哪类祸患」，摊在表里是 12 个按钮，实际一局用不了几次
const ruinPick = ref(RUINS[0])
function gainRuin(cat) {
  const n = Number(ruinAdd.value[cat]) || 0
  if (n <= 0) return
  ruinAdd.value[cat] = 0
  if (canIgnoreFirst()) {
    state.ignoreFirstUsed = true
    pushLog(`举世艳羡：忽略本回合首次祸患增加（${cat} +${n}）`)
    return
  }
  if (spendFame.value && state.fame > 0) {
    state.fame -= 1
    pushLog(`举世艳羡：花 1 点${state.fameKind}忽略祸患增加（${cat} +${n}）`)
    return
  }
  const before = state.ruin[cat]
  state.ruin[cat] += n
  logCalc('祸患·增加点数', {
    rule: '王国事件或活动会使某类祸患增加；举世艳羡（20级）可忽略每回合首次增加，之后的每次增加可花费 1 点声望/恶名点忽略（王国规则 祸患 / 举世艳羡）',
    input: { 类别: cat, 增加量: n, 增加前点数: before, 有效阈值: effectiveRuinThreshold(cat) },
    formula: '祸患点数 += 增加量（超过阈值时另行结算）',
    output: { 增加后点数: state.ruin[cat], 是否已超阈值: state.ruin[cat] > effectiveRuinThreshold(cat) },
  })
  pushLog(`祸患增加：${cat} +${n} → ${state.ruin[cat]}`)
}
const spendFame = ref(false)
const ruinFlatD20 = ref('')
const ruinFlatTier = ref('')
// 祸患点数已是 0 时，若要减少其减值，改用 DC 16 平值检定
function reduceRuinPenalty(cat) {
  if (state.ruin[cat] > 0) { pushLog(`${cat} 点数不为 0，不能改用 DC 16 降减值。`); return }
  if ((state.ruinPenalty[cat] || 0) <= 0) { pushLog(`${cat} 减值已为 0。`); return }
  const mouse = isMouse()
  const r = Number(ruinFlatD20.value)
  const mt = mouseTierOf(ruinFlatTier.value)
  if (mouse ? mt < 0 : !(r >= 1 && r <= 20)) { pushLog(mouse ? '请先选择鼠鼠平值检定结果。' : '请填入桌上掷出的 d20（1–20）。'); return }
  const ok = mouse ? mt >= 2 : r >= 16
  if (ok) state.ruinPenalty[cat] = Math.max(0, state.ruinPenalty[cat] - 1)
  logCalc('祸患·点数已0时降减值', {
    rule: '若某种情况使某类祸患的点数可减少，而该类祸患已是 0 点，可改为进行一次 DC 16 平值检定；成功时把该类祸患的减值减少 1（最低 0）（王国规则 祸患 / 减少祸患减值）',
    input: { 类别: cat, 玩家掷出的d20: mouse ? '—' : r, 鼠鼠结果: mouse ? ruinFlatTier.value : '—' },
    formula: '平值检定：d20 ≥ 16 即成功（不加任何调整值）',
    output: { 减值: state.ruinPenalty[cat] },
  })
  pushLog(`${cat} DC 16 平值检定：${mouse ? `幸运骰 ${luckDie(16)}-in-6` : r} → ${ok ? '成功，减值 −1' : '失败'}`)
  ruinFlatD20.value = ''
  ruinFlatTier.value = ''
}

// --- 上下文效果入口（专长/能力里依赖具体情境的那些）---
function lifeQuality() {
  state.goods.奢侈品 += 1
  logCalc('生活品质（专长）', {
    rule: '在一个王国回合中，你首次获得奢侈品时，把获得的总量增加 1（王国规则 王国专长 生活品质）',
    input: { 触发: '本回合首次获得奢侈品' },
    formula: '获得的奢侈品数量 +1',
    output: { 奢侈品: state.goods.奢侈品 },
  })
  pushLog('生活品质：首次获得奢侈品 +1')
}
function cashOut() {
  if (state.rp <= 1) state.rp = 1
  state.dicePenalty = 4
  logCalc('变现资源（专长）', {
    rule: '因失败的技能检定或危险事件被迫花费 RP、且该开销会使 RP 降到 0 时，可改为把 RP 降到 1 并视为已足额支付；下个王国回合开始时掷的资源骰比正常少 4 个（王国规则 王国专长 变现资源）',
    input: { 前置: '该笔开销本会使 RP 归零' },
    formula: 'RP 设为 1；下回合资源骰 −4',
    output: { 当前RP: state.rp, 下回合骰数惩罚: state.dicePenalty },
  })
  pushLog('变现资源：RP 视为已足额支付（设为 1），下回合资源骰 −4')
}
function fameWealth() {
  state.pendingDice += 1
  logCalc('名声与财富（专长）', {
    rule: '每当你在一个王国回合的活动阶段中，在任何王国技能检定上取得大成功，你就于下个王国回合开始时获得 1 个奖励资源骰（王国规则 王国专长 名声与财富）',
    input: { 触发: '活动阶段某次王国技能检定大成功' },
    formula: '下回合奖励资源骰 +1',
    output: { 下回合额外骰: state.pendingDice },
  })
  pushLog('名声与财富：下回合 +1 奖励资源骰')
}
const trainSkill = ref('')
function skillTraining() {
  if (!trainSkill.value) return
  state.proficiencies[trainSkill.value] = '受训'
  logCalc('技能训练（专长）', {
    rule: '你王国在你选择的一项王国技能上获得受训熟练等级；可多次选择此专长，每次选择一项新技能（王国规则 王国专长 技能训练）',
    input: { 技能: trainSkill.value },
    formula: '熟练度 = 受训',
    output: { 熟练加值: state.level + 2 },
  })
  pushLog(`技能训练：${trainSkill.value} 获得受训`)
}

// --- 扩张 ---
const allHexes = mapLabels.labels
const claimedList = computed(() => Object.keys(state.hexClaimed).filter((k) => state.hexClaimed[k]))
const unclaimed = computed(() => allHexes.filter((l) => !state.hexClaimed[l.code]))
// 119 个格按区域分组：平铺在一个下拉里找一格，等于把规则书摊开翻
const unclaimedGroups = computed(() => groupByRegion(unclaimed.value))
const allHexGroups = computed(() => groupByRegion(allHexes))
const controlDC = computed(() => kingdomControlDC())
// 技能调整值 ＝ 关键属性调整值 ＋ 熟练加值 ＋ 状态加值
function modFor(skillName, attr) {
  // 统一口径：属性+熟练+领导状态+专长 − 动荡状态减值 − 对应祸患物品减值
  return kingdomSkillMod(skillName, attr)
}
function tier(total, dc) {
  if (total >= dc + 10) return '大成功'
  if (total >= dc) return '成功'
  if (total <= dc - 10) return '大失败'
  return '失败'
}
// 鼠鼠模式：直接读结果档；PF 模式读桌上 d20
function readCheck(inputRef, tierRef, outRef) {
  if (isMouse()) {
    const mt = mouseTierOf(tierRef.value)
    if (mt < 0) { outRef.value = '请先选择鼠鼠检定结果。'; return null }
    return { mouse: true, r: 0, tier: tierNameOf(mt) }
  }
  const r = Number(inputRef.value)
  if (!r || r < 1 || r > 20) { outRef.value = '请填入桌上掷出的 d20（1–20）。'; return null }
  return { mouse: false, r }
}
function tierNameOf(i) { return ['大失败', '失败', '成功', '大成功'][i] }
function regionTier(c, total, dc) {
  return c.mouse ? c.tier : tier(total, dc)
}
function regionLine(c, dc, m, total, t) {
  return c.mouse
    ? `2d6 DC ${mouseDC(dc, state.mouseBase)} → ${t}`
    : `d20 ${c.r} ${m >= 0 ? '+' : ''}${m} ＝ ${total} 对抗 DC ${dc} → ${t}`
}
// 区域活动共用：每回合 3 项；守备官空缺时检定 -4
function startRegion(outRef, label) {
  if (regionActivitiesLeft() <= 0) {
    outRef.value = `本回合区域活动已用完（3 项），不能再尝试${label}。`
    return false
  }
  useRegionActivity()
  return true
}
const regionMod = (skill, attr) => modFor(skill, attr) + vacancyActivityMod('region')

const CLAIM_SKILLS = [
  { skill: '探索', attr: '经济' }, { skill: '谋略', attr: '忠诚' },
  { skill: '魔法', attr: '文化' }, { skill: '荒野', attr: '稳定' },
  { skill: '工程', attr: '稳定' },
]
const claimHex = ref('')
const claimSkill = ref('探索')
const claimInput = ref('')
const claimTier = ref('')
const claimOut = ref('')
function doClaim() {
  if (!claimHex.value) { claimOut.value = '先选一个六角格。'; return }
  const c = readCheck(claimInput, claimTier, claimOut)
  if (!c) return
  if (state.rp < 1) { claimOut.value = '资源点不足（占据需 1 点）。'; return }
  if (claimsThisTurn() >= claimLimit()) { claimOut.value = `本回合已尝试占据 ${claimsThisTurn()} 次（上限 ${claimLimit()} 次）。`; return }
  if (!startRegion(claimOut, '占据六角格')) return
  useClaimAttempt()
  state.rp -= 1
  claimInput.value = ''
  claimTier.value = ''
  const s = CLAIM_SKILLS.find((x) => x.skill === claimSkill.value)
  const envBonus = claimEnvBonus()
  const m = regionMod(s.skill, s.attr) + envBonus
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, controlDC.value)
  logCalc('扩张·占据六角格', {
    rule: '占据六角格：花费 1RP，进行基础探索／谋略／魔法／荒野检定；成功即纳入领土、规模 +1；大成功还可立即再作一项区域活动；大失败使下个王国回合结束前基于稳定的检定 −1。4 级起的「拓张专家」给该检定 +2 环境加值（王国规则 占据六角格 / 拓张专家）',
    input: { 六角格: claimHex.value, 技能: s.skill, 关键属性: s.attr, 技能熟练度: state.proficiencies[s.skill] || '未受训', 控制DC: controlDC.value, 花费RP: 1, 拓张专家环境加值: envBonus },
    formula: 'd20 + (技能调整值 + 拓张专家环境加值)，对抗控制 DC',
    steps: { 技能调整值: m - envBonus, 环境加值: envBonus, 合计调整值: m, d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? claimTier.value : '—', 检定结果: c.mouse ? '—' : total },
    output: { 结果: t, 是否纳入版图: t === '大成功' || t === '成功' },
  })
  if (t === '大成功' || t === '成功') {
    state.hexClaimed[claimHex.value] = true
    pushLog(`占据 ${claimHex.value}：${t}，规模 +1`)
  } else {
    pushLog(`占据 ${claimHex.value}：${t}`)
    if (t === '大失败') claimOut.value += ''
  }
  claimOut.value = `${regionLine(c, controlDC.value, m, total, t)}` +
    (t === '大成功' || t === '成功' ? '，已纳入版图，可立即再作一项区域活动' : t === '大失败' ? '，下个回合结束前基于稳定的检定 −1' : '')
}
const clearHex = ref('')
const clearCost = ref(0)
const clearTerrain = ref('平原')
function setClearCost() { clearCost.value = TERRAIN_COST[clearTerrain.value] || 1 }
const clearInput = ref('')
const clearTier = ref('')
const clearOut = ref('')
function doClear() {
  if (!clearHex.value) { clearOut.value = '先选一个六角格。'; return }
  const c = readCheck(clearInput, clearTier, clearOut)
  if (!c) return
  const cost = Number(clearCost.value) || 0
  if (cost > state.rp) { clearOut.value = '资源点不足。'; return }
  if (!startRegion(clearOut, '清剿六角格')) return
  state.rp -= cost
  clearInput.value = ''
  clearTier.value = ''
  const m = regionMod('工程', '稳定')
  const dc = controlDC.value + (state.hexClaimed[clearHex.value] ? 0 : 2)
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, dc)
  let note = ''
  if (t === '大成功') { state.rp += Math.floor(cost / 2); state.goods.奢侈品 += 2; note = `，返还一半 RP（${Math.floor(cost / 2)}），带回 2 点奢侈品` }
  if (t === '大失败') { state.unrest += 1; note = '，动荡 +1' }
  pushLog(`清剿 ${clearHex.value}：${t}`)
  clearOut.value = `${regionLine(c, dc, m, total, t)}${note}`
}
const loseHex = ref('')
function doLose() {
  if (!loseHex.value) return
  state.hexClaimed[loseHex.value] = false
  pushLog(`失去六角格 ${loseHex.value}，规模 −1`)
  loseHex.value = ''
}

// ---- 区域活动（六角格）----
// 修筑道路：按地形花 RP，基础检定；成功在该格记录道路
const roadHex = ref('')
const roadTerrain = ref('平原')
const roadCost = ref(1)
const roadInput = ref('')
const roadTier = ref('')
const roadOut = ref('')
function setRoadCost() { roadCost.value = TERRAIN_COST[roadTerrain.value] || 1 }
function doRoad() {
  if (!roadHex.value) { roadOut.value = '先选一个六角格。'; return }
  if (!state.hexClaimed[roadHex.value]) { roadOut.value = '道路只能修在已被王国占据的六角格。'; return }
  const c = readCheck(roadInput, roadTier, roadOut)
  if (!c) return
  const cost = Number(roadCost.value) || 0
  if (cost > state.rp) { roadOut.value = '资源点不足。'; return }
  if (!startRegion(roadOut, '修筑道路')) return
  state.rp -= cost
  roadInput.value = ''
  roadTier.value = ''
  const m = regionMod('工程', '稳定')
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, controlDC.value)
  if (t === '大成功' || t === '成功') { state.hexRoads[roadHex.value] = true; if (t === '大成功') state.rp += Math.floor(cost / 2) }
  roadOut.value = `${regionLine(c, controlDC.value, m, total, t)}` + (t === '大成功' || t === '成功' ? `，${roadHex.value} 已通道路（沿路地形视为好一级）` : '，未修成')
  pushLog(`区域活动·修筑道路 ${roadHex.value}：${t}`)
  logCalc('区域活动·修筑道路', { rule: '修筑道路：要求该六角格已被王国占据；按该格最险恶地形花 RP，进行基础检定（有河流横穿需双倍 RP 修桥）；大成功返还所花商品一半（王国规则 修筑道路）。', input: { 六角格: roadHex.value, 地形: roadTerrain.value, 花费RP: cost, 技能调整值: m }, formula: 'd20 + 技能调整值，对抗控制 DC', steps: { d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? roadTier.value : '—', 检定结果: c.mouse ? '—' : total }, output: { 分级: t, 道路: !!state.hexRoads[roadHex.value] } })
}
// 设防六角格：按地形花 RP，基础检定；成功在该格建立防御工事
const fortHex = ref('')
const fortTerrain = ref('平原')
const fortCost = ref(1)
const fortInput = ref('')
const fortTier = ref('')
const fortOut = ref('')
function setFortCost() { fortCost.value = TERRAIN_COST[fortTerrain.value] || 1 }
function doFortifyHex() {
  if (!fortHex.value) { fortOut.value = '先选一个六角格。'; return }
  const c = readCheck(fortInput, fortTier, fortOut)
  if (!c) return
  const cost = Number(fortCost.value) || 0
  if (cost > state.rp) { fortOut.value = '资源点不足。'; return }
  if (!startRegion(fortOut, '设防六角格')) return
  state.rp -= cost
  fortInput.value = ''
  fortTier.value = ''
  const featBonus = hasFeat('设防封地') ? 2 : 0
  const m = regionMod('防御', '稳定') + featBonus
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, controlDC.value)
  let note = ''
  if (t === '大成功' || t === '成功') {
    state.hexFortified[fortHex.value] = true
    state.unrest = Math.max(0, state.unrest - 1)
    note = '，已建立防御工事，动荡 −1'
  }
  fortOut.value = `${regionLine(c, controlDC.value, m, total, t)}${note}${featBonus ? '（设防封地 +2）' : ''}`
  pushLog(`区域活动·设防六角格 ${fortHex.value}：${t}`)
  logCalc('区域活动·设防六角格', { rule: '设防六角格：按该格最险恶地形花 RP，进行基础检定；成功建立防御工事并使动荡减少 1。专长「设防封地」在此检定上 +2 环境加值（王国规则 设防六角格）。', input: { 六角格: fortHex.value, 地形: fortTerrain.value, 花费RP: cost, 技能调整值: m, 专长加值: featBonus }, formula: 'd20 + 技能调整值，对抗控制 DC', steps: { d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? fortTier.value : '—', 检定结果: c.mouse ? '—' : total }, output: { 分级: t, 已设防: !!state.hexFortified[fortHex.value] } })
}
// 放弃六角格：撤回占据；若含聚落则动荡翻倍且该聚落变为自由领地
const abandonHex = ref('')
const abandonOut = ref('')
function doAbandon() {
  const code = abandonHex.value
  if (!code) { abandonOut.value = '先选一个六角格。'; return }
  if (!state.hexClaimed[code]) { abandonOut.value = '该六角格未被占据。'; return }
  const townIdx = (state.towns || []).findIndex((t) => t.hex === code)
  // 放弃是不可逆的：含聚落时还会动荡翻倍并丢掉聚落，先确认再落账
  const warn = townIdx >= 0
    ? `放弃 ${code}？该格含聚落「${state.towns[townIdx].name}」：动荡会翻倍，该聚落变为自由领地。此操作不可撤销。`
    : `放弃 ${code}？将撤回该格的占据，规模 −1。此操作不可撤销。`
  if (!confirm(warn)) return
  if (!startRegion(abandonOut, '放弃六角格')) return
  state.hexClaimed[code] = false
  if (townIdx >= 0) {
    const doubled = state.unrest * 2
    state.unrest = doubled
    const nm = state.towns[townIdx].name
    state.towns.splice(townIdx, 1)
    state.settlements = state.towns.length
    abandonOut.value = `放弃 ${code}：该格含聚落「${nm}」，动荡翻倍至 ${doubled}，该聚落变为自由领地（已移出王国）`
  } else {
    abandonOut.value = `放弃 ${code}：已撤回占据，规模 −1`
  }
  logCalc('区域活动·放弃六角格', { rule: '放弃六角格：放弃对某个受控六角格的占据并撤回所有定居者或勘探者；若被放弃的六角格包含聚落，动荡翻倍且该聚落变为自由领地（王国规则 放弃六角格）。', input: { 六角格: code, 含聚落: townIdx >= 0 }, output: { 动荡: state.unrest, 聚落数: state.towns.length } })
  pushLog('区域活动·放弃六角格：' + abandonOut.value)
  abandonHex.value = ''
}
// 迁都
const capitalTown = ref('')
const capitalInput = ref('')
const capitalTier = ref('')
const capitalOut = ref('')
// 迁都失败／大失败需要指定祸患：失败两项各 +1；大失败三项各 +1，剩下的一项 +3
const capRuin1 = ref('腐化')
const capRuin2 = ref('犯罪')
const capRuin3 = ref('衰败')
const capD4 = ref('')
// 迁都：留在原首都的宫殿改为「一座占用 4 个地块的贵族别院」
// （规则原文允许用连续 4 格表示这一座单一建筑，故把 4 个「宫殿」地块整体改为 4 个「贵族别院」）
function convertPalaceToManor(t) {
  const l = (t && t.lots) || []
  for (let i = 0; i + 3 < l.length; i++) {
    if (l[i] === '宫殿' && l[i + 1] === '宫殿' && l[i + 2] === '宫殿' && l[i + 3] === '宫殿') {
      for (let k = i; k < i + 4; k++) l[k] = '贵族别院'
      return true
    }
  }
  return false
}
function doMoveCapital() {
  const i = (state.towns || []).findIndex((t) => t.name === capitalTown.value)
  if (i < 0) { capitalOut.value = '请选择目标聚落。'; return }
  if (i === 0) { capitalOut.value = '该聚落已是首都。'; return }
  if (state.unrest >= anarchyThreshold()) { capitalOut.value = '已进入无政府：只能尝试「平息动荡」，不能迁都。'; return }
  if (state.lastCapitalMove && state.turn - state.lastCapitalMove < 3) { capitalOut.value = '至少 3 个王国回合内不能再次迁都。'; return }
  const target = state.towns[i]
  const lots = target.lots || []
  const ok = lots.some((x) => x === '城堡' || x === '宫殿' || x === '市政厅')
  if (!ok) { capitalOut.value = '目标聚落（非当前首都）必须建有城堡、宫殿或市政厅。'; return }
  if (capRuin1.value === capRuin2.value) { capitalOut.value = '失败档的两项祸患请选不同的类别。'; return }
  const c = readCheck(capitalInput, capitalTier, capitalOut)
  if (!c) return
  if (!confirm(`迁都到「${capitalTown.value}」？本回合全部领导活动将被用尽，失败会带来动荡与祸患。此操作不可撤销。`)) return
  const dc = controlDC.value + 5
  const m = c.mouse ? 0 : modFor('工业', '经济')   // 迁都是「工业」技能下的受训活动
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, dc)
  // 需求：所有领导者必须把活动阶段的全部领导活动用于此项 → 本回合领导活动全部占用
  state.capitalAttemptTurn = state.turn
  state.acts.leader = Math.max(state.acts.leader || 0, leaderActivityCap())
  const ruin4 = RUINS.find((c) => ![capRuin1.value, capRuin2.value, capRuin3.value].includes(c))
  const notes = []
  if (t === '大成功' || t === '成功') {
    const old = state.towns[0]
    const converted = convertPalaceToManor(old)
    const [town] = state.towns.splice(i, 1)
    state.towns.unshift(town)
    state.lastCapitalMove = state.turn
    notes.push(`首都迁至「${town.name}」`)
    notes.push(converted ? '旧首都的宫殿已改为一座占用 4 个地块的贵族别院' : '旧首都没有宫殿，无需处理')
    if (t === '成功') { state.unrest += 1; notes.push('动荡 +1') }
    else notes.push('大成功：民众对新首都感到兴奋，无动荡增加')
  } else if (t === '失败') {
    state.unrest += 1
    state.ruin[capRuin1.value] = (state.ruin[capRuin1.value] || 0) + 1
    state.ruin[capRuin2.value] = (state.ruin[capRuin2.value] || 0) + 1
    notes.push('首都保持不变', '动荡 +1', `${capRuin1.value} +1、${capRuin2.value} +1`)
  } else {
    const d = Number(capD4.value)
    if (!(d >= 1 && d <= 4)) { capitalOut.value = '迁都大失败：请填入桌上掷出的 1d4（1–4）作为动荡增量。'; return }
    state.unrest += d
    for (const c of [capRuin1.value, capRuin2.value, capRuin3.value]) state.ruin[c] = (state.ruin[c] || 0) + 1
    if (ruin4) state.ruin[ruin4] = (state.ruin[ruin4] || 0) + 3
    notes.push('首都保持不变', `动荡 +${d}（1d4）`, `${capRuin1.value}／${capRuin2.value}／${capRuin3.value} 各 +1，${ruin4 || '第四项'} +3`)
  }
  capitalOut.value = `迁都 → ${t}：${regionLine(c, dc, m, total, t)}；${notes.join('；')}。本回合的全部领导活动已用于迁都。`
  logCalc('区域活动·迁都', {
    rule: '迁都（工业·受训）：需求为某座非首都聚落已建有城堡、宫殿或市政厅，且所有领导者把活动阶段的全部领导活动用于此项；检定 DC = 控制 DC + 5；至少 3 个王国回合内不能再次迁都。大成功：迁移极出色、无动荡增加；成功：动荡 +1；失败：首都保持不变、动荡 +1 且所选两项祸患各 +1；大失败：迁都不成、首都保持不变、动荡 +1d4 且所选三项祸患各 +1、第四项 +3。迁移后留在原首都的宫殿改为一座占用 4 个地块的贵族别院（王国规则 迁都 / 宫殿）',
    input: { 目标聚落: target.name, 原首都: (state.towns[0] || {}).name || '—', 对抗DC: dc, 适用技能: '工业（经济）', 技能调整值: m, 失败档祸患: [capRuin1.value, capRuin2.value], 第四项祸患: ruin4 || '—' },
    formula: 'd20 + 工业（经济）技能调整值，对抗控制 DC + 5',
    steps: { d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? capitalTier.value : '—', 检定结果: c.mouse ? '—' : total },
    output: { 分级: t, 首都: (state.towns[0] || {}).name, 上次迁都回合: state.lastCapitalMove, 动荡: state.unrest, 祸患: { ...state.ruin } },
  })
  capitalInput.value = ''
  capitalTier.value = ''
  capD4.value = ''
  pushLog('区域活动·迁都：' + capitalOut.value)
}
// 灌溉
const irrigateHex = ref('')
const irrigateInput = ref('')
const irrigateTier = ref('')
const irrigateOut = ref('')
function doIrrigate() {
  if (!irrigateHex.value) { irrigateOut.value = '先选一个六角格。'; return }
  const c = readCheck(irrigateInput, irrigateTier, irrigateOut)
  if (!c) return
  if (!startRegion(irrigateOut, '灌溉')) return
  const m = c.mouse ? 0 : regionMod('工程', '稳定')
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, controlDC.value)
  let note = ''
  if (t === '大成功' || t === '成功') { state.hexIrrigated[irrigateHex.value] = true; note = '，灌溉成功（该格农田产量提升，按剧情处理）' }
  else if (t === '失败') note = '，灌溉未成功'
  else { state.unrest += 1; note = '，灌溉徒劳并成疾病滋生地：动荡 +1；此后每个事件阶段开始时对该格做 DC 4 平值检定（每有一处灌溉大失败格，DC +1），失败则额外遭受一次瘟疫事件' }
  irrigateOut.value = `${regionLine(c, controlDC.value, m, total, t)}${note}`
  irrigateInput.value = ''
  irrigateTier.value = ''
  pushLog(`区域活动·灌溉 ${irrigateHex.value}：${t}`)
}
// 建立聚落
const FOUND_SKILL_ATTR = { 工程: '稳定', 工业: '经济', 政治: '忠诚', 学术: '文化' }
const foundHex = ref('')
const foundSkill = ref('工程')
const foundInput = ref('')
const foundTier = ref('')
const foundRp = ref(3)
const foundOut = ref('')
function doFound() {
  if (!foundHex.value) { foundOut.value = '先选一个六角格。'; return }
  if (!state.hexClaimed[foundHex.value]) { foundOut.value = '只能在自己的六角格上建立聚落。'; return }
  if ((state.towns || []).some((t) => t.hex === foundHex.value)) { foundOut.value = '该六角格已有聚落。'; return }
  const c = readCheck(foundInput, foundTier, foundOut)
  if (!c) return
  if (!startRegion(foundOut, '建立聚落')) return
  const m = c.mouse ? 0 : regionMod(foundSkill.value, FOUND_SKILL_ATTR[foundSkill.value] || '稳定')
  const total = c.mouse ? 0 : c.r + m
  const t = regionTier(c, total, controlDC.value)
  const cost = Number(foundRp.value) || 0
  if (t === '大失败' || cost > state.rp) {
    foundOut.value = `建立聚落失败：${regionLine(c, controlDC.value, m, total, t)}${cost > state.rp ? '（RP 不足，视为大失败）' : ''}，未建立聚落。`
  } else {
    state.rp -= cost
    const name = prompt('新聚落名称', '新村庄') || '新村庄'
    createTown(name, foundHex.value)
    foundOut.value = `建立聚落成功：${foundHex.value} 上建立村庄「${name}」，花费 ${cost} RP（${t}）。`
  }
  foundInput.value = ''
  foundTier.value = ''
  pushLog('区域活动·建立聚落：' + foundOut.value)
}

function settleRuin(cat) {
  if (state.ruin[cat] > effectiveRuinThreshold(cat)) {
    state.ruin[cat] -= effectiveRuinThreshold(cat)
    state.ruinPenalty[cat] += 1
    logCalc('祸患·结算溢出', {
      rule: '每当某类祸患超过其阈值，就把该类祸患的点数总量减去等于其阈值的数量，并使该类祸患的减值增加 1（王国规则 祸患）',
      input: { 类别: cat, 阈值: effectiveRuinThreshold(cat), 结算前点数: state.ruin[cat] + effectiveRuinThreshold(cat) },
      formula: '点数 -= 阈值；减值 += 1',
      output: { 结算后点数: state.ruin[cat], 减值: state.ruinPenalty[cat] },
    })
  }
}
function ruinResist(cat) {
  state.ruinThreshold[cat] += 2
  state.ruinPenalty[cat] = 0
}
function resistLevelOk() {
  return state.level >= 5 && (state.level - 5) % 3 === 0
}

function collapseKingdom() {
  if (!confirm('确定要清除整个王国、重新开始吗？（此操作不可撤销）')) return
  pushLog('王国覆灭：领土被削减至 0 且未能重建，王国从头再来。')
  resetAll()
}

function exportSave() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `王国存档-第${state.turn}回合.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
function importSave(e) {
  const f = e.target.files && e.target.files[0]
  if (!f) return
  if (!confirm('用这个文件覆盖当前存档？当前内容会先自动备份，之后可用「回滚到上次自动备份」找回。')) { e.target.value = ''; return }
  const r = new FileReader()
  r.onload = () => {
    try { Object.assign(state, JSON.parse(String(r.result))) }
    catch (err) { alert('这个文件解析失败，可能不是本工具的存档。') }
  }
  r.readAsText(f)
  e.target.value = ''
}
// 上一版自动备份（每次自动保存前留档）；显示其回合与时间供判断
const backupTick = ref(0)  // 回滚后自增，触发下面的 computed 重新读取本机备份
const backup = computed(() => { void backupTick.value; return backupInfo() })
const backupLabel = computed(() => {
  const b = backup.value
  if (!b) return '上次自动备份：无'
  const t = b.time ? new Date(b.time).toLocaleString('zh-CN') : '未知时间'
  return `上次自动备份：第 ${b.turn} 回合 · ${b.level} 级 · ${t}`
})
function doRestore() {
  if (!confirm('回滚到「上次自动备份」？当前状态会被这份备份覆盖（备份本身保留，可再次回滚）。')) return
  if (restoreBackup()) { backupTick.value++; alert('已回滚到上次自动备份。') }
  else alert('没有可用的自动备份。')
}
</script>

<template>
  <div class="panel">
    <h2>王国</h2>
    <div class="row">
      <div class="field">
        <label>王国名</label>
        <input v-model="state.name" />
      </div>
      <div class="field">
        <label>王国等级（等于队伍等级）</label>
        <input type="number" min="1" v-model.number="state.level" />
      </div>
      <div class="field">
        <label>规模（已占据六角格，由「扩张」与地图决定）</label>
        <div class="num">{{ state.hexCount }}<span class="muted">　骰面 {{ die }}</span></div>
      </div>
      <div class="field">
        <label>名声取向</label>
        <select v-model="state.fameKind">
          <option>声望</option>
          <option>恶名</option>
        </select>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>四项属性</h2>
    <table>
      <thead>
        <tr><th>属性</th><th>数值</th><th>调整值</th></tr>
      </thead>
      <tbody>
        <tr v-for="a in ATTRS" :key="a">
          <td>{{ a }}</td>
          <td><input type="number" min="1" v-model.number="state.attributes[a]" /></td>
          <td>{{ sign(attrMod(state.attributes[a])) }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="panel">
    <h2>会期结算</h2>
    <p>
      资源骰 <b>{{ poolCount }}{{ die }}</b>
      <span class="muted">（骰数＝王国等级＋4，当前 {{ state.level }} 级；骰面看规模，当前 {{ state.hexCount }} 格）</span>
    </p>
    <p>
      动荡 <b>{{ state.unrest }}</b>，全部王国检定 {{ sign(penalty) }}
      <span class="muted">（1／5／10／15 点分别对应 −1／−2／−3／−4）</span>
    </p>
    <div class="row">
      <div class="field">
        <label>本期资源点</label>
        <input type="number" min="0" v-model.number="state.rp" />
      </div>
      <div class="field">
        <label>{{ state.fameKind }}点数（上限 3，回合结束未花即失）</label>
        <input type="number" min="0" :max="fameCap()" v-model.number="state.fame" />
        <span class="muted">上限 {{ fameCap() }}</span>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>祸患<Hint text="每类祸患对应一项属性：点数超过阈值时减去等于阈值的数量，并使该类祸患减值 +1；减值作用于所有使用对应属性的检定。" /></h2>
    <table>
      <thead>
        <tr><th>祸患</th><th>对应属性</th><th style="width: 110px">点数</th><th style="width: 210px">阈值</th><th style="width: 90px">减值</th></tr>
      </thead>
      <tbody>
        <tr v-for="c in RUINS" :key="c" :class="{ over: state.ruin[c] > effectiveRuinThreshold(c) }">
          <td>{{ c }}</td>
          <td class="muted">{{ RUIN_ATTR[c] }}</td>
          <td><input type="number" min="0" v-model.number="state.ruin[c]" /></td>
          <td style="white-space: nowrap">
            <input type="number" min="1" v-model.number="state.ruinThreshold[c]" style="width: 62px" />
            <span class="muted" v-if="(state.ruinThresholdExtra || {})[c]">+{{ state.ruinThresholdExtra[c] }}</span>
            <span class="muted">　有效 {{ effectiveRuinThreshold(c) }}</span>
          </td>
          <td class="num">−{{ state.ruinPenalty[c] }}</td>
        </tr>
      </tbody>
    </table>

    <details class="more">
      <summary>祸患结算</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>祸患</label>
          <select v-model="ruinPick"><option v-for="c in RUINS" :key="'p' + c">{{ c }}</option></select>
        </div>
        <div class="field"><label>增加量</label><input type="number" min="0" v-model.number="ruinAdd[ruinPick]" style="width: 70px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="!ruinAdd[ruinPick]" @click="gainRuin(ruinPick)">增加</button></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="state.ruin[ruinPick] <= effectiveRuinThreshold(ruinPick)" @click="settleRuin(ruinPick)">结算溢出</button></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="state.ruin[ruinPick] > 0 || (state.ruinPenalty[ruinPick] || 0) <= 0" @click="reduceRuinPenalty(ruinPick)">DC 16 降减值</button></div>
        <CheckRoll v-model:dice="ruinFlatD20" v-model:tier="ruinFlatTier" :dc="16" flat label="DC 16 降减值用 d20" width="80px" />
        <div class="field">
          <label>举世艳羡 · 花 1 点{{ state.fameKind }}忽略本次祸患增加</label>
          <div class="check"><input type="checkbox" v-model="spendFame" id="spendFame" /><label for="spendFame">启用（当前 {{ state.fame }} 点）</label></div>
        </div>
      </div>
      <div class="row" style="margin-top: 10px" v-if="resistLevelOk()">
        <div class="field" v-for="c in RUINS" :key="'r' + c">
          <label>{{ c }} · 祸患抗性<Hint text="祸患抗性在 5、8、11、14、17、20 级各获得一次，可把一类祸患的阈值 +2 并把其减值清零。" /></label>
          <button class="act" @click="ruinResist(c)">阈值 +2，减值清零</button>
        </div>
      </div>
    </details>
  </div>

  <div class="panel">
    <h2>商品<span class="muted">（基础上限 {{ cap }}，储存建筑会提高对应商品上限）</span></h2>
    <table>
      <thead>
        <tr><th>商品</th><th>数量</th><th>上限</th><th>储存建筑加成</th></tr>
      </thead>
      <tbody>
        <tr v-for="g in GOODS" :key="g">
          <td>{{ g }}</td>
          <td><input type="number" min="0" v-model.number="state.goods[g]" /></td>
          <td class="num">{{ goodsCapOf(g) }}</td>
          <td class="muted">{{ storageBonus(g) ? '+' + storageBonus(g) : '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="panel">
    <details class="more">
      <summary>等级进阶（对照表）</summary>
      <table style="margin-top: 8px">
        <thead><tr><th style="width: 110px">能力</th><th style="width: 70px">起始等级</th><th style="width: 80px">间隔</th><th style="width: 90px">状态</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="a in abilities" :key="a.name">
            <td>{{ a.name }}</td>
            <td class="num">{{ a.from }}</td>
            <td class="num">{{ a.every ? '每 ' + a.every + ' 级' : '一次' }}</td>
            <td>{{ state.level >= a.from ? '已获得 ' + gainedCount(a.name) + ' 次' : '未获得' }}</td>
            <td class="muted">{{ a.text }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <h2 style="margin-top: 20px">属性提升<span class="muted">（可用 {{ boostAvail }} 次）</span></h2>
    <div class="row">
      <div class="field"><label>属性一</label><select v-model="boostPick[0]"><option value="">未选</option><option v-for="a in ATTRS" :key="a">{{ a }}</option></select></div>
      <div class="field"><label>属性二</label><select v-model="boostPick[1]"><option value="">未选</option><option v-for="a in ATTRS" :key="a">{{ a }}</option></select></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="boostAvail === 0" @click="applyBoost">提升</button></div>
    </div>

    <h2 style="margin-top: 20px">技能提升<span class="muted">（可用 {{ skillIncAvail }} 次）</span></h2>
    <div class="row">
      <div class="field"><label>技能</label><select v-model="skillPick"><option value="">未选</option><option v-for="n in skillNames" :key="n">{{ n }}</option></select></div>
      <div class="field"><label>目标熟练度</label><select v-model="skillTarget"><option>受训</option><option>专家</option><option>大师</option><option>传奇</option></select></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="skillIncAvail === 0 || !skillPick" @click="applySkillIncrease">提升</button></div>
    </div>

    <h2 style="margin-top: 20px">王国专长<span class="muted">（可用名额 {{ featAvail }}；共 {{ feats.length }} 项）<Hint text="选定一项后点「启用」占名额；标着「已接入计算」的会并入数值，其余按备注在桌上处理。政体奖励的专长不占名额。" /></span></h2>
    <div class="row">
      <div class="field" style="flex: 1; min-width: 280px">
        <label>专长（{{ featsShown.length }} 项）</label>
        <select v-model="featPick">
          <option v-for="f in featsShown" :key="f.name" :value="f.name">{{ f.name }}（{{ f.level }} 级 · {{ WIRED_FEATS[f.name] ? '已接入计算' : '仅备注' }}）</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="act" v-if="!featSelOn" :disabled="!featPick || !featSel || featSel.level > state.level || featAvail === 0" @click="toggleFeat(featPick)">启用</button>
        <button class="act" v-else-if="featPick !== state.bonusFeat" @click="toggleFeat(featPick)">停用</button>
        <span class="tag" v-else>政体奖励</span>
      </div>
    </div>
    <p class="muted" v-if="featSel" style="margin-top: 8px">{{ featSel.text }}</p>
    <p class="muted" v-if="featAvail === 0">名额已满，停用一个才能再启用。</p>
    <p class="muted">已启用：{{ featOnNames.join('、') || '无' }}</p>

    <details class="more" v-if="featsLocked.length" style="margin-top: 10px">
      <summary>未达等级（{{ featsLocked.length }} 项）</summary>
      <p class="muted" v-for="f in featsLocked" :key="f.name" style="margin: 6px 0 0">{{ f.name }} · 需 {{ f.level }} 级<span v-if="WIRED_FEATS[f.name]"> · 已接入计算</span></p>
    </details>

    <div v-if="effectNotes.length" style="margin-top: 14px">
      <h2>已接入计算的机械效果</h2>
      <p class="muted" v-for="(t, i) in effectNotes" :key="i" style="margin-bottom: 4px">{{ t }}</p>
    </div>

    <div v-if="hasFeat('勉强应付')" style="margin-top: 14px">
      <h2>勉强应付 · 祸患阈值</h2>
      <p class="muted">把两项祸患的阈值提高 1，另一项提高 2。</p>
      <div class="row">
        <div class="field" v-for="c in RUINS" :key="'x' + c">
          <label>{{ c }} 额外阈值</label>
          <select v-model.number="state.ruinThresholdExtra[c]">
            <option :value="0">0</option><option :value="1">+1</option><option :value="2">+2</option>
          </select>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <details class="more">
      <summary>上下文效果入口<Hint text="这些专长／能力依赖具体情境，对得上时机时点一下即生效，并写入回合记录与控制台日志。" /></summary>

      <div class="row" style="margin-top: 10px">
        <div class="field"><label>生活品质 · 本回合首次获得奢侈品时</label><button class="act" @click="lifeQuality">奢侈品 +1</button></div>
        <div class="field"><label>当前奢侈品</label><div class="num">{{ state.goods.奢侈品 }}</div></div>
        <div class="field"><label>变现资源 · 某笔开销本会使 RP 归零时</label><button class="act" @click="cashOut">RP 设为 1、下回合资源骰 −4</button></div>
        <div class="field"><label>下回合骰数惩罚</label><div class="num">{{ state.dicePenalty }}</div></div>
        <div class="field"><label>名声与财富 · 活动阶段取得大成功时</label><button class="act" @click="fameWealth">下回合 +1 奖励资源骰</button></div>
        <div class="field"><label>下回合额外骰</label><div class="num">{{ state.pendingDice }}</div></div>
        <div class="field"><label>技能训练</label><select v-model="trainSkill"><option value="">未选</option><option v-for="n in skillNames" :key="n">{{ n }}</option></select></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="!trainSkill" @click="skillTraining">获得受训</button></div>
      </div>

      <details class="more" style="margin-top: 14px">
        <summary>需要人工裁定<span class="muted">　五项情境能力，按规则在桌上处理</span></summary>
        <p class="muted" style="margin: 8px 0 4px">优渥生活（4 级）／奢华生活（10 级）：身处王国时，开拓者在工艺或获得收入的检定上 +1／+2 环境加值。</p>
        <p class="muted" style="margin: 0 0 4px">协作领导：专注投入协助他人时，成功赋予的环境加值提高到 +3；11 级起，被协助检定的大失败视为失败，且若该技能达专家熟练度则失败视为成功。</p>
        <p class="muted" style="margin: 0 0 4px">自由公正：新领导层与效忠誓约中基于忠诚的检定 +2 环境加值；失败或大失败时可花 2RP 重掷（须接受第二次结果）。</p>
        <p class="muted" style="margin: 0 0 4px">快速恢复：尝试终止一个持续中的有害王国事件时，该检定 +4 状态加值。</p>
        <p class="muted" style="margin: 0">王国保障：每回合一次，可放弃掷骰，改用 10 + 熟练加值作为结果（在「参考 · 技能检定」里手动采用）。</p>
      </details>
    </details>
  </div>

  <div class="panel">
    <h2>工地与农田<Hint text="工地在王国的六角格上建立，每回合的资源收集里产出商品；每个农田使王国消耗 −1，前提是位于某座聚落影响范围内（本工具不从地图推导邻接，消耗未自动扣减农田）。" /></h2>

    <table v-if="state.worksites.length" style="margin-bottom: 12px">
      <thead><tr><th>工地</th><th>六角格</th><th>产出</th><th>产量翻倍</th><th style="width: 70px">　</th></tr></thead>
      <tbody>
        <tr v-for="(w, i) in state.worksites" :key="w.id">
          <td>{{ w.type }}</td>
          <td class="num">{{ w.hex }}</td>
          <td>{{ w.goods }}</td>
          <td>{{ w.doubled ? '是（至下回合结束）' : '否' }}</td>
          <td><button class="act mini" @click="removeWorksite(i)">移除</button></td>
        </tr>
      </tbody>
    </table>

    <div class="row">
      <div class="field">
        <label>兴建工地</label>
        <select v-model="workType"><option v-for="w in WORK_TYPES" :key="w.name">{{ w.name }}</option></select>
      </div>
      <div class="field"><label>六角格编号</label><input v-model="workHex" placeholder="如 GB1" style="width: 110px" /></div>
      <div class="field"><label>地形（定 RP）</label><select v-model="workTerrain" @change="setWorkCost"><option>平原</option><option>丘陵</option><option>森林</option><option>沼泽</option><option>山脉</option></select></div>
      <div class="field"><label>花资源点</label><input type="number" min="0" v-model.number="workCost" /></div>
      <CheckRoll v-model:dice="workInput" v-model:tier="workTier" :dc="controlDC" label="桌上 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" @click="buildWorksite">花资源点并结算</button></div>
    </div>
    <p class="muted">适用地形：{{ (WORK_TYPES.find(w => w.name === workType) || {}).terrain }}</p>
    <p class="muted" v-if="workOut">{{ workOut }}</p>

    <div class="row" style="margin-top: 16px">
      <div class="field"><label>开垦农田</label><select v-model="farmTerrain"><option>平原</option><option>丘陵</option></select></div>
      <div class="field"><label>花费</label><div class="num">{{ farmTerrain === '平原' ? 1 : 2 }} RP</div></div>
      <div class="field"><label>六角格编号</label><input v-model="farmHex" placeholder="如 GB1" style="width: 100px" /></div>
      <div class="field"><label>相邻格（大成功用）</label><input v-model="farmHex2" placeholder="可留空" style="width: 100px" /></div>
      <CheckRoll v-model:dice="farmInput" v-model:tier="farmTier" :dc="controlDC + (farmTerrain === '平原' ? 0 : 5)" label="桌上 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" @click="buildFarm">花资源点并结算</button></div>
    </div>
    <p class="muted" v-if="farmOut">{{ farmOut }}</p>
    <div class="row" style="margin-top: 6px">
      <div class="field" style="flex: 1">
        <label>农田六角格（共 {{ (state.farmHexes || []).length }} 个）</label>
        <div v-if="!(state.farmHexes || []).length" class="num muted">无</div>
        <span v-else>
          <span class="chip" v-for="(h, i) in state.farmHexes" :key="i">{{ h }}<button class="x" @click="state.farmHexes.splice(i, 1)">×</button></span>
        </span>
      </div>
    </div>

    <h2 style="margin-top: 22px">建筑加值<span class="muted">（同名取最高、不叠加）<Hint text="已建成建筑提供的物品加值。征税、动用国库、改善生活、订立贸易协定、建立工地会自动计入，其余检定（如平息动荡、军队活动）按此表手工取用。" /></span></h2>
    <p class="muted" v-if="!buildingBonusList().length">无。</p>
    <table v-else>
      <thead><tr><th style="width: 65%">适用活动 / 检定</th><th>物品加值</th></tr></thead>
      <tbody>
        <tr v-for="b in buildingBonusList()" :key="b.label"><td>{{ b.label }}</td><td class="num">+{{ b.bonus }}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="panel">
    <h2>扩张<Hint text="占据花 1 资源点，成功纳入版图并得 10 点王国 XP；该六角格须先被侦察、且与版图相邻。1／4／9 级每回合分别可占据 1／2／3 次。" /></h2>
    <p class="muted">已占据 <b>{{ claimedCount() }}</b> 格；本回合最多占据 {{ claimLimit() }} 次。</p>
    <div class="row">
      <div class="field">
        <label>占据哪个六角格</label>
        <select v-model="claimHex" style="max-width: 260px">
          <option value="">选择</option>
          <optgroup v-for="g in unclaimedGroups" :key="g.code" :label="g.code + '　' + g.name + '（' + g.items.length + '）'">
            <option v-for="l in g.items" :key="l.code" :value="l.code">{{ l.code }}</option>
          </optgroup>
        </select>
      </div>
      <div class="field">
        <label>用哪项技能</label>
        <select v-model="claimSkill"><option v-for="s in CLAIM_SKILLS" :key="s.skill">{{ s.skill }}</option></select>
      </div>
      <CheckRoll v-model:dice="claimInput" v-model:tier="claimTier" :dc="controlDC" label="桌上 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" @click="doClaim">花 1 资源点并结算</button></div>
    </div>
    <p class="muted" v-if="claimOut">{{ claimOut }}</p>

    <div class="row" style="margin-top: 16px">
      <div class="field">
        <label>清剿哪个六角格</label>
        <select v-model="clearHex" style="max-width: 260px">
          <option value="">选择</option>
          <optgroup v-for="g in allHexGroups" :key="g.code" :label="g.code + '　' + g.name + '（' + g.items.length + '）'">
            <option v-for="l in g.items" :key="l.code" :value="l.code">{{ l.code }}</option>
          </optgroup>
        </select>
      </div>
      <div class="field"><label>地形（定 RP）</label><select v-model="clearTerrain" @change="setClearCost"><option>平原</option><option>丘陵</option><option>森林</option><option>沼泽</option><option>山脉</option></select></div>
      <div class="field"><label>花资源点</label><input type="number" min="0" v-model.number="clearCost" /></div>
      <CheckRoll v-model:dice="clearInput" v-model:tier="clearTier" :dc="controlDC + (state.hexClaimed[clearHex] ? 0 : 2)" label="桌上 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" @click="doClear">结算工程检定</button></div>
    </div>
    <p class="muted" v-if="clearOut">{{ clearOut }}</p>

    <details class="more" style="margin-top: 16px">
      <summary>失去六角格</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>失去哪个<Hint text="失去六角格会丢掉该格的地形改良好处，格内聚落变为自由领地；若领土被切断，其余部分成为次级领土，相关检定 −4 且每回合开始时动荡 +1。" /></label>
          <select v-model="loseHex" style="max-width: 260px">
            <option value="">选择</option>
            <option v-for="c in claimedList" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="!loseHex" @click="doLose">标记为失去</button></div>
      </div>
    </details>
    <div v-if="claimedCount() === 0" style="margin-top: 14px">
      <p class="muted" style="color: var(--warn)">领土归零：下个王国回合必须占据至少 1 个六角格，并建立或占据至少 1 座聚落，否则王国视为彻底覆灭。</p>
      <button class="act" @click="collapseKingdom">王国覆灭，重新开始</button>
    </div>
  </div>

  <div class="panel">
    <h2>区域活动<span class="muted">（在活动阶段的区域活动步骤进行）</span></h2>

    <details class="more">
      <summary>修筑道路</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>六角格</label>
          <select v-model="roadHex" style="max-width: 200px">
            <option value="">选择</option>
            <optgroup v-for="g in allHexGroups" :key="g.code" :label="g.code + '　' + g.name">
              <option v-for="l in g.items" :key="l.code" :value="l.code">{{ l.code }}</option>
            </optgroup>
          </select>
        </div>
        <div class="field"><label>地形（定 RP）</label><select v-model="roadTerrain" @change="setRoadCost"><option>平原</option><option>丘陵</option><option>森林</option><option>沼泽</option><option>山脉</option></select></div>
        <div class="field"><label>花资源点</label><input type="number" min="0" v-model.number="roadCost" style="width: 80px" /></div>
        <CheckRoll v-model:dice="roadInput" v-model:tier="roadTier" :dc="controlDC" label="桌上 d20" width="80px" />
        <div class="field"><label>&nbsp;</label><button class="act" @click="doRoad">结算</button></div>
      </div>
      <p class="muted" v-if="roadOut">{{ roadOut }}</p>
    </details>

    <details class="more">
      <summary>设防六角格</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>六角格</label>
          <select v-model="fortHex" style="max-width: 200px">
            <option value="">选择</option>
            <optgroup v-for="g in allHexGroups" :key="g.code" :label="g.code + '　' + g.name">
              <option v-for="l in g.items" :key="l.code" :value="l.code">{{ l.code }}</option>
            </optgroup>
          </select>
        </div>
        <div class="field"><label>地形（定 RP）</label><select v-model="fortTerrain" @change="setFortCost"><option>平原</option><option>丘陵</option><option>森林</option><option>沼泽</option><option>山脉</option></select></div>
        <div class="field"><label>花资源点</label><input type="number" min="0" v-model.number="fortCost" style="width: 80px" /></div>
        <CheckRoll v-model:dice="fortInput" v-model:tier="fortTier" :dc="controlDC" label="桌上 d20" width="80px" />
        <div class="field"><label>&nbsp;</label><button class="act" @click="doFortifyHex">结算</button></div>
      </div>
      <p class="muted" v-if="fortOut">{{ fortOut }}</p>
    </details>

    <details class="more">
      <summary>放弃六角格</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>放弃哪个</label>
          <select v-model="abandonHex" style="max-width: 200px"><option value="">选择</option><option v-for="c in claimedList" :key="c" :value="c">{{ c }}</option></select>
        </div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="!abandonHex" @click="doAbandon">放弃</button></div>
      </div>
      <p class="muted" v-if="abandonOut">{{ abandonOut }}</p>
    </details>

    <details class="more">
      <summary>迁都</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>目标聚落<Hint text="需求：目标聚落须建有城堡、宫殿或市政厅，且本回合全部领导活动都要用于迁都（结算后即用尽）。大成功无动荡；成功动荡 +1；失败动荡 +1 且所选两项祸患各 +1；大失败动荡 +1d4、所选三项祸患各 +1、剩下的一项 +3。原首都的宫殿会变成占 4 个地块的贵族别院。" /></label>
          <select v-model="capitalTown" style="max-width: 200px"><option value="">选择</option><option v-for="t in state.towns" :key="t.id" :value="t.name">{{ t.name }}</option></select>
        </div>
        <div class="field"><label>检定</label><div class="num muted">工业（经济）· DC {{ controlDC + 5 }}</div></div>
        <CheckRoll v-model:dice="capitalInput" v-model:tier="capitalTier" :dc="controlDC + 5" label="桌上 d20" width="80px" />
        <div class="field"><label>大失败 1d4</label><input type="number" min="1" max="4" v-model="capD4" style="width: 70px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="doMoveCapital">结算</button></div>
        <div class="field"><label>上次迁都</label><div class="num muted">{{ state.lastCapitalMove ? '第 ' + state.lastCapitalMove + ' 回合' : '—' }}</div></div>
      </div>
      <div class="row">
        <div class="field"><label>失败／大失败 · 祸患一</label><select v-model="capRuin1"><option v-for="c in RUINS" :key="'c1' + c">{{ c }}</option></select></div>
        <div class="field"><label>祸患二</label><select v-model="capRuin2"><option v-for="c in RUINS" :key="'c2' + c">{{ c }}</option></select></div>
        <div class="field"><label>大失败 · 祸患三</label><select v-model="capRuin3"><option v-for="c in RUINS" :key="'c3' + c">{{ c }}</option></select></div>
      </div>
      <p class="muted" v-if="capitalOut">{{ capitalOut }}</p>
    </details>

    <details class="more">
      <summary>灌溉</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>六角格</label>
          <select v-model="irrigateHex" style="max-width: 200px">
            <option value="">选择</option>
            <optgroup v-for="g in allHexGroups" :key="g.code" :label="g.code + '　' + g.name">
              <option v-for="l in g.items" :key="l.code" :value="l.code">{{ l.code }}</option>
            </optgroup>
          </select>
        </div>
        <CheckRoll v-model:dice="irrigateInput" v-model:tier="irrigateTier" :dc="controlDC" label="桌上 d20" width="80px" />
        <div class="field"><label>&nbsp;</label><button class="act" @click="doIrrigate">结算</button></div>
      </div>
      <p class="muted" v-if="irrigateOut">{{ irrigateOut }}</p>
    </details>

    <details class="more">
      <summary>建立聚落</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>六角格（须已清剿且无聚落）<Hint text="建立聚落总以村庄起步：大成功花 1d6 RP、成功 3d6 RP、失败 6d6 RP，把掷出的总和填进右边的花费框；大失败则未建立。" /></label>
          <select v-model="foundHex" style="max-width: 200px"><option value="">选择</option><option v-for="c in claimedList" :key="c" :value="c">{{ c }}</option></select>
        </div>
        <div class="field"><label>技能</label><select v-model="foundSkill"><option>工程</option><option>工业</option><option>政治</option><option>学术</option></select></div>
        <div class="field"><label>花 RP（1d6／3d6／6d6 掷出值）</label><input type="number" min="0" v-model.number="foundRp" style="width: 90px" /></div>
        <CheckRoll v-model:dice="foundInput" v-model:tier="foundTier" :dc="controlDC" label="桌上 d20" width="80px" />
        <div class="field"><label>&nbsp;</label><button class="act" @click="doFound">结算</button></div>
      </div>
      <p class="muted" v-if="foundOut">{{ foundOut }}</p>
    </details>
  </div>

  <div class="panel">
    <h2>存档<Hint text="数据只存在本机浏览器，换设备不会跟随；导出可带走或备份，每次自动保存都留上一版，出错可回滚。" /></h2>
    <div class="row">
      <div class="field"><label>&nbsp;</label><button class="act" @click="exportSave">导出存档</button></div>
      <div class="field"><label>从文件恢复</label><input type="file" accept="application/json" @change="importSave" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="doRestore">回滚到上次自动备份</button></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="reset">重置王国</button></div>
    </div>
    <p class="muted">{{ backupLabel }}</p>
  </div>
</template>

<style scoped>
.num { font-variant-numeric: tabular-nums; padding-top: 7px; }
td.num { padding-top: 9px; }
.act.mini { padding: 2px 9px; font-size: 12px; }
select { min-width: 120px; }
.chip { display: inline-flex; align-items: center; font-size: 12px; padding: 2px 4px 2px 7px; margin: 2px 6px 0 0; border: 1px solid var(--rule-soft); border-radius: 3px; background: var(--cover-old); }
.chip .x { appearance: none; border: 0; background: transparent; color: var(--ink-2); cursor: pointer; font: inherit; padding: 0 3px; margin-left: 4px; }
.chip .x:hover { color: var(--warn); }
/* 点数越过阈值：这一行有帐要结 */
tr.over input { border-color: var(--warn); }
</style>
