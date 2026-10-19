<script setup>
import { ref, computed, watch, watchEffect } from 'vue'
import { state, rpDiceCount, dieType, consumption, consumptionParts, unrestPenalty, attrMod, pushLog, logCalc, civicPerSettlement, anarchyThreshold, featBonusDice, fameCap, canIgnoreFirst, hasFeat, goodsCapOf, syncLegionLevels, buildingBonus, kingdomSkillMod, kingdomControlDC, claimedCount, crowdedCount, ATTRS, GOODS, effectiveRuinThreshold, tierIndex, tierName, worsenTier, addTempEffect, dropTempEffect, EFFECT_SCOPES, isTrained, hasBank, rulerPalaceBonus, pruneTempEffects, vacancyMods, roleVacant, leaderActivityCap, vacancyActivityMod, isMouse } from '../store.js'
import { mouseTierOf, rollLine, flatLine, luckDie } from '../rules.js'
import roles from '../data/roles.json'
import events from '../data/events.json' with { type: 'json' }
import eventWeights from '../data/eventWeights.json' with { type: 'json' }
import skillsData from '../data/skills.json'
import hexes from '../data/hexes.json'
import groups from '../data/groups.json'
import Hint from './Hint.vue'
import CheckRoll from './CheckRoll.vue'
import { settled, undoSnap, beginSettle, undoSettle as undoLast, resetSettles } from '../settleBus.js'

const phase = ref(0)
const phases = ['维持阶段', '商贸阶段', '活动阶段', '事件阶段']

function undoSettle() {
  if (undoLast()) tradeMsg.value = '已撤销上一次结算'
}

const controlDC = computed(() => kingdomControlDC())
const rpDice = computed(() => rpDiceCount())
const die = computed(() => dieType(state.hexCount))
const vacancies = computed(() => roles.filter((r) => roleVacant(r.name) && r.name !== state.civilServiceRole).length)
const vacancyNow = computed(() => vacancyMods())
const rulerVacant = computed(() => roleVacant('统治者') && state.civilServiceRole !== '统治者')
const rulerVacD4 = ref('')
const rulerVacOut = ref('')
function applyRulerVacancy() {
  if (!rulerVacant.value) return
  const n = Number(rulerVacD4.value)
  if (!(n >= 1 && n <= 4)) { rulerVacOut.value = '统治者空缺：请填入桌上掷出的 1d4（1–4）。'; return }
  if (!beginSettle('rulerVac')) { rulerVacOut.value = '本回合的统治者空缺动荡已经结算过。'; return }
  state.unrest += n
  rulerVacD4.value = ''
  rulerVacOut.value = `统治者空缺：动荡 +${n}`
  pushLog(rulerVacOut.value)
}
// 任命（授职）的 4 个领导角色：只有它们按关键属性提供状态加值；每个王国回合开始时可以重新选定
const investedCount = computed(() => (state.invested || []).length)
function isInvested(name) { return (state.invested || []).includes(name) }
function toggleInvest(name) {
  const arr = [...(state.invested || [])]
  const i = arr.indexOf(name)
  if (i >= 0) arr.splice(i, 1)
  else {
    if (arr.length >= 4) return
    arr.push(name)
  }
  state.invested = arr
  pushLog(`领导角色任命调整：${arr.join('、') || '（无）'}`)
}

// --- 维持阶段（骰子由玩家在桌上掷出后录入）---
const rollResult = ref(null)
const rpInput = ref('')
function settleResources() {
  const raw = String(rpInput.value).trim()
  if (!raw) { rollResult.value = { err: '请填入你掷出的骰面结果（可逐个用逗号分隔，也可只填总和）。' }; return }
  const list = raw.split(/[\s,，+]+/).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n))
  if (!list.length) { rollResult.value = { err: '看不明白这个结果，请填数字。' }; return }
  const sum = list.length > 1 ? list.reduce((a, b) => a + b, 0) : list[0]
  const n = rpDice.value
  if (!beginSettle('rp')) { rollResult.value = { err: '本回合资源骰已经结算过；如需重来，请点「撤销上一次结算」。' }; return }
  rollResult.value = { out: list, sum }
  state.rp += sum
  const penaltyUsed = state.dicePenalty || 0
  state.dicePenalty = 0
  rpInput.value = ''
  logCalc('维持阶段·资源收集', {
    rule: '骰子数量 = 王国等级 + 4；骰型随规模（1-9 格 d4，10-24 d6，25-49 d8，50-99 d10，100+ d12）。掷出的总和即本期资源点（王国规则 资源骰）。骰子由玩家在桌上掷出后录入。',
    input: { 王国等级: state.level, 规模格数: state.hexCount, 应掷骰数: n, 骰型: die.value, 奖励骰: state.bonusDice, 动荡减值: unrestPenalty(state.unrest), 变现资源惩罚: penaltyUsed, 玩家录入: list },
    formula: '骰数 = 等级 + 4 + 奖励骰 + 动荡调整 − 变现资源惩罚；本期资源点 = 各骰之和',
    steps: list.length > 1 ? { 骰面明细: list } : { 玩家直接录入总和: sum },
    output: { 本期资源点合计: sum, 本期累计: state.rp },
  })
  pushLog(`资源收集：${n}${die.value} = ${list.join('+')} = ${sum} 资源点`)
}
// 过度拥挤聚落数由聚落自动推导（住宅地块数 < 含建筑街区数 即过度拥挤）
const crowdedNow = computed(() => crowdedCount())
const unrestDelta = computed(() => crowdedNow.value + (state.war ? 1 : 0) + state.sustainedEventMod)
const unrestRoll = ref(null)
const d10Input = ref('')
const unrestRuinCat = ref('腐化')
const unrestFlatD20 = ref('')
const unrestFlatTier = ref('')
function applyUnrest() {
  const delta = unrestDelta.value
  const projected = state.unrest + delta
  let extra = ''
  if (delta > 0 && canIgnoreFirst()) {
    if (!beginSettle('unrest')) { unrestRoll.value = '本回合的动荡调整已经结算过；如需重来，请点「撤销上一次结算」。'; return }
    state.ignoreFirstUsed = true
    unrestRoll.value = '举世艳羡：本回合首次动荡增加已被忽略。'
    pushLog('举世艳羡：忽略本回合首次动荡增加')
    return
  }
  let drain = null
  // 规则：动荡达到 10 或以上就掷 1d10 并做 DC 11 检定；达到 20 只是额外陷入无政府，不会跳过前面两步
  const willSplash = projected >= 10
  if (willSplash) {
    drain = Number(d10Input.value)
    if (!(drain >= 1 && drain <= 10)) { unrestRoll.value = '动荡将达 10 或以上，请先填入桌上掷出的 1d10（1–10）作为祸患增量。'; return }
  }
  if (!beginSettle('unrest')) { unrestRoll.value = '本回合的动荡调整已经结算过；如需重来，请点「撤销上一次结算」。'; return }
  state.unrest = projected
  if (state.unrest >= 10) {
    state.ruin[unrestRuinCat.value] = (state.ruin[unrestRuinCat.value] || 0) + drain
    extra = `祸患 ${unrestRuinCat.value} +${drain}（现 ${state.ruin[unrestRuinCat.value]}）`
    const mouse = isMouse()
    const f = Number(unrestFlatD20.value)
    if (mouse) {
      const mt = mouseTierOf(unrestFlatTier.value)
      if (mt < 0) extra += '；还需选择鼠鼠平值检定结果（失败将失去一个六角格）'
      else extra += mt >= 2 ? '；幸运骰成功，不失去六角格' : '；幸运骰失败，须失去一个六角格（到「王国卡 · 扩张」用“标记为失去”）'
    } else if (!(f >= 1 && f <= 20)) extra += '；还需填入 DC 11 平值检定的 d20（失败将失去一个六角格）'
    else extra += f >= 11 ? '；DC 11 平值检定成功，不失去六角格' : '；DC 11 平值检定失败，须失去一个六角格（到「王国卡 · 扩张」用“标记为失去”）'
  }
  if (state.unrest >= anarchyThreshold()) {
    extra = '已陷入无政府：只能尝试平息动荡，且所有王国检定结果恶化一级' + (extra ? '；' + extra : '')
  }
  d10Input.value = ''
  unrestFlatD20.value = ''
  unrestFlatTier.value = ''
  unrestRoll.value = extra
  logCalc('维持阶段·调整动荡', {
    rule: '动荡调整 = 过度拥挤聚落数 + 战争(+1) + 持续事件调整；动荡 ≥10 时每回合开始掷 1d10 祸患（可自行分配到四类祸患）并做 DC 11 平值检定，失败失去一个六角格；≥20 陷入无政府（王国规则 动荡 / 第2步：调整动荡）。1d10 由玩家在桌上掷出后录入。',
    input: { 过度拥挤聚落: crowdedNow.value, 战争: state.war, 持续事件调整: state.sustainedEventMod, 调整前动荡: state.unrest - delta, 祸患分配类别: unrestRuinCat.value },
    formula: '新动荡 = 原动荡 + (拥挤 + 战争 + 持续事件调整)；动荡 ≥10 时对应祸患 += 1d10',
    steps: { 本回合变化: delta, 祸患1d10: drain ?? '未触发' },
    output: { 调整后动荡: state.unrest, 检定减值: unrestPenalty(state.unrest), 额外后果: extra || '无' },
  })
  pushLog(`调整动荡：${delta >= 0 ? '+' : ''}${delta} → 动荡 ${state.unrest}${extra ? '；' + extra : ''}`)
}
const payResult = ref('')
// 增加商品并按该商品的储存上限截断，返回实际入库数量
function addGoods(g, n) {
  const cap = goodsCapOf(g)
  const before = state.goods[g] || 0
  state.goods[g] = Math.min(cap, before + n)
  return state.goods[g] - before
}
// 减少祸患（低于 0 时归零）；返回实际减少量
function reduceRuin(cat, n) {
  const before = state.ruin[cat] || 0
  state.ruin[cat] = Math.max(0, before - n)
  return before - state.ruin[cat]
}
// 第一个王国回合消耗为 0（王国规则 第4步：支付消耗）
const consumptionValue = computed(() => (state.turn === 1 ? 0 : consumption()))
function payWithFood() {
  const need = consumptionValue.value
  if (!beginSettle('pay')) { payResult.value = '本回合消耗已经支付过；如需重来，请点「撤销上一次结算」。'; return }
  const useFood = Math.min(state.goods.食物, need)
  state.goods.食物 -= useFood
  const left = need - useFood
  const costRP = left * 5
  state.rp = Math.max(0, state.rp - costRP)
  const p = consumptionParts()
  logCalc('维持阶段·支付消耗', {
    rule: '消耗 = 各聚落消耗总和 + 各军队消耗总和 + 王国事件调整；第 1 个王国回合消耗为 0。用食物支付，缺口每 1 点可改花 5RP 或使动荡 +1d4（王国规则 第4步：支付消耗）',
    input: { 聚落消耗: p.settlement, 军队消耗: p.army, 事件调整: p.event, 可用食物: state.goods.食物 + useFood },
    formula: '消耗 = 聚落 + 军队 + 事件调整；缺口 × 5 = 需付资源点',
    steps: { 消耗合计: need, 用食物支付: useFood, 缺口: left },
    output: { 扣除资源点: costRP, 剩余资源点: state.rp },
  })
  pushLog(`支付消耗 ${need}：食物 -${useFood}，缺口 ${left} 用 ${costRP} 资源点顶`)
  payResult.value = `消耗 ${need} 点（聚落 ${p.settlement} + 军队 ${p.army} + 事件 ${p.event}）。用掉食物 ${useFood} 份，缺口 ${left} 点折 ${costRP} 资源点。`
}
const payD4Input = ref('')
function payWithUnrest() {
  const need = consumptionValue.value
  const useFood = Math.min(state.goods.食物, need)
  const left = need - useFood
  let drain = 0
  if (left > 0) {
    const d = Number(payD4Input.value)
    // 缺口每 1 点各掷 1d4，此处填入 left 颗 d4 的总和
    if (!(d >= left && d <= left * 4)) { payResult.value = `消耗缺口 ${left} 点，每点各掷 1d4，请填入 ${left} 颗 d4 的总和（${left}–${left * 4}）。`; return }
    drain = d
  }
  if (!beginSettle('pay')) { payResult.value = '本回合消耗已经支付过；如需重来，请点「撤销上一次结算」。'; return }
  state.goods.食物 -= useFood
  state.unrest += drain
  payD4Input.value = ''
  const p = consumptionParts()
  pushLog(`支付消耗 ${need}：食物 -${useFood}，缺口 ${left} 点改记动荡 +${drain}（${left} 颗 1d4 桌上掷得合计 ${drain}）`)
  payResult.value = `消耗 ${need} 点（聚落 ${p.settlement} + 军队 ${p.army} + 事件 ${p.event}）。食物用掉 ${useFood} 份，缺口 ${left} 点转为动荡 +${drain}（${left} 颗 1d4 合计 ${drain}）。`
}

// 收集工地商品（资源收集步骤的第二半）
const collectOut = ref('')
function collectWorksites() {
  if (!state.worksites.length) { collectOut.value = '还没有工地。'; return }
  if (!beginSettle('worksites')) { collectOut.value = '本回合工地商品已经收取过；如需重来，请点「撤销上一次结算」。'; return }
  const rows = []
  for (const w of state.worksites) {
    const n = w.doubled ? 2 : 1
    const got = addGoods(w.goods, n)
    rows.push({ 工地: w.type, 六角格: w.hex, 商品: w.goods, 数量: got })
  }
  logCalc('维持阶段·收集工地商品', {
    rule: '维持阶段的资源收集步骤中，除掷资源骰外还要收集各工地产出的商品；产量翻倍的工地按双倍计（王国规则 第3步：资源收集 / 建立工地）',
    input: { 工地数: state.worksites.length, 商品上限: { 食物: goodsCapOf('食物'), 木材: goodsCapOf('木材'), 矿石: goodsCapOf('矿石'), 石材: goodsCapOf('石材'), 奢侈品: goodsCapOf('奢侈品') } },
    formula: '每个工地产出 1 份对应商品；翻倍时 2 份；超过上限的部分丢失',
    steps: rows,
    output: { 商品储备: { ...state.goods } },
  })
  collectOut.value = rows.length ? rows.map((r) => `${r.工地}→${r.商品} +${r.数量}`).join('，') : '还没有工地。'
  pushLog(`收集工地商品：${collectOut.value}`)
}

// --- 商贸阶段 ---
// 商贸阶段每个动作各有一次检定：d20 均由玩家在桌上掷出后录入对应输入框
const taxInput = ref('')
const taxTier = ref('')
const improveInput = ref('')
const improveTier = ref('')
const treasuryInput = ref('')
const treasuryTier = ref('')
const pactInput = ref('')
const pactTier = ref('')
function baseCheck(skill, attr, rawValue, bonus = 0, dcBonus = 0, tierPick = '') {
  const mouse = isMouse()
  const r = mouse ? 0 : Number(rawValue)
  const m = mouse ? 0 : kingdomSkillMod(skill, attr)
  const dc = (controlDC.value === '—' ? 14 : controlDC.value) + dcBonus
  const valid = mouse ? mouseTierOf(tierPick) >= 0 : (r >= 1 && r <= 20)
  const total = r + m + bonus
  const anarchy = state.unrest >= anarchyThreshold()   // 无政府：所有王国检定结果恶化一级
  let ti = mouse ? mouseTierOf(tierPick) : tierIndex(total, dc, valid ? r : undefined)
  if (ti < 0) ti = 1
  if (anarchy) ti = worsenTier(ti, 1)
  const tier = tierName(ti)
  if (ti === 3) state.fame = Math.min(fameCap(), (state.fame || 0) + 1)  // 大成功 → 声望/恶名 +1
  return { r, m, bonus, dc, total, tier, ti, ok: ti >= 2, valid, anarchy, mouse, tierPick }
}
const tradeMsg = ref('')
function needTradeRoll() { tradeMsg.value = isMouse() ? '请先选择鼠鼠检定结果。' : '请先填入桌上掷出的 d20（1–20）。'; return false }
function checkLine(c) {
  return rollLine({ mouse: c.mouse, dc: c.dc, d: c.r, mod: c.mouse ? c.bonus : c.m + c.bonus, total: c.total, tier: c.tier })
}
function tax() {
  const mouse = isMouse()
  const r = Number(taxInput.value)
  if (mouse ? mouseTierOf(taxTier.value) < 0 : !(r >= 1 && r <= 20)) return needTradeRoll()
  if (!beginSettle('taxStep')) { tradeMsg.value = '本回合已经做过征税/不征税检定；如需重来，请点「撤销上一次结算」。'; return }
  const b = buildingBonus('征税')
  const c = baseCheck('贸易', '经济', taxInput.value, b, 0, taxTier.value)
  if (!c.valid) { settled.value.taxStep = false; return needTradeRoll() }
  taxInput.value = ''
  taxTier.value = ''
  const lastTaxed = (state.lastUsed.tax || 0) === state.turn - 1
  if (c.ti === 3) { state.econBonus = 2; tradeMsg.value = `征税：${checkLine(c)}。本回合基于经济的检定 +2 环境加值。` }
  else if (c.ti === 2) {
    state.econBonus = 1
    let extra = ''
    if (lastTaxed) { state.unrest += 1; extra = '；上回合曾征税，动荡 +1' }
    tradeMsg.value = `征税：${checkLine(c)}。本回合基于经济的检定 +1 环境加值${extra}。`
  } else if (c.ti === 1) {
    const n = lastTaxed ? 2 : 1
    state.unrest += n
    tradeMsg.value = `征税：${checkLine(c)}。动荡 +${n}${lastTaxed ? '（上回合曾征税）' : ''}。`
  } else {
    state.unrest += 2
    if (canIgnoreFirst()) { state.ignoreFirstUsed = true; tradeMsg.value = `征税：${checkLine(c)}。动荡 +2（举世艳羡：祸患增加已被忽略）。` }
    else { state.ruin[unrestRuinCat.value] = (state.ruin[unrestRuinCat.value] || 0) + 1; tradeMsg.value = `征税：${checkLine(c)}。动荡 +2，祸患 ${unrestRuinCat.value} +1。` }
  }
  state.marks = state.marks || {}; state.marks.taxed = true
  state.lastUsed.tax = state.turn
  logCalc('商贸阶段·征税', {
    rule: '征税：大成功本回合经济检定 +2；成功 +1，若上回合曾征税动荡 +1；失败动荡 +1（上回合曾征税则 +2）；大失败动荡 +2 并选一项祸患 +1（王国规则 商贸阶段 第1步：征税）。d20 由玩家在桌上掷出后录入。',
    input: { 适用技能: '贸易', 关键属性: '经济', 技能调整值: c.m, 建筑加值: b, 控制DC: c.dc, 无政府: c.anarchy, 上回合曾征税: lastTaxed },
    formula: '检定结果 = d20 + 技能调整值 + 建筑物品加值，对抗控制 DC；自然 20/1 升降一级；无政府再恶化一级',
    steps: { 玩家掷出的d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? taxTier.value : '—', 检定结果: c.mouse ? '—' : c.total },
    output: { 结果: c.tier, 动荡: state.unrest, 祸患: { ...state.ruin } },
  })
  pushLog(tradeMsg.value)
}
// 不征税的替代：尝试一次 DC 11 平值检定，成功则动荡 −1
const skipTaxDice = ref('')
const skipTaxTier = ref('')
function skipTaxFlat() {
  const mouse = isMouse()
  const r = Number(skipTaxDice.value)
  const mt = mouseTierOf(skipTaxTier.value)
  if (mouse ? mt < 0 : (!r || r < 1 || r > 20)) { tradeMsg.value = mouse ? '请先选择鼠鼠平值检定结果。' : '请填入桌上掷出的 d20（1–20）。'; return }
  const ok = mouse ? mt >= 2 : r >= 11
  if (!beginSettle('taxStep')) { tradeMsg.value = '本回合已经做过征税/不征税检定；如需重来，请点「撤销上一次结算」。'; return }
  if (ok) state.unrest = Math.max(0, state.unrest - 1)
  skipTaxDice.value = ''
  skipTaxTier.value = ''
  tradeMsg.value = `不征税，改做平值检定：${flatLine({ mouse, dc: 11, d: r, ok })}${ok ? '，动荡 −1' : '，无变化'}`
  logCalc('商贸阶段·不征税（DC 11 平值检定）', {
    rule: '每个王国回合可以征税一次；若不尝试征税，可改为尝试一次 DC 11 的平值检定，成功则动荡减少 1（王国规则 商贸阶段 第1步：征税）。d20 由玩家在桌上掷出后录入。',
    input: { 平值DC: 11 },
    formula: '平值检定：d20 ≥ 11 即成功（不加任何调整值）',
    steps: { 玩家掷出的d20: mouse ? '—' : r, 鼠鼠结果: mouse ? skipTaxTier.value : '—' },
    output: { 结果: ok ? '成功：动荡 −1' : '失败', 动荡: state.unrest },
  })
  pushLog(tradeMsg.value)
}
function improveLife() {
  const mouse = isMouse()
  const r = Number(improveInput.value)
  if (mouse ? mouseTierOf(improveTier.value) < 0 : !(r >= 1 && r <= 20)) return needTradeRoll()
  const cost = Number(improveCost.value) || 0
  if (cost > state.rp) { tradeMsg.value = '资源点不足。'; return }
  if (!beginSettle('improve')) { tradeMsg.value = '本回合已经做过改善生活；如需重来，请点「撤销上一次结算」。'; return }
  const b = buildingBonus('改善生活')
  const c = baseCheck('政治', '文化', improveInput.value, b, 0, improveTier.value)
  if (!c.valid) { settled.value.improve = false; return needTradeRoll() }
  improveInput.value = ''
  improveTier.value = ''
  state.rp -= cost
  if (c.ti === 3) { state.cultureBonus = 2; tradeMsg.value = `改善生活：花 ${cost} 资源点，${checkLine(c)}。本回合基于文化的检定 +2 环境加值。` }
  else if (c.ti === 2) { state.cultureBonus = 1; tradeMsg.value = `改善生活：花 ${cost} 资源点，${checkLine(c)}。本回合基于文化的检定 +1 环境加值。` }
  else if (c.ti === 1) { state.cultureBonus = 1; state.econBonus = -1; tradeMsg.value = `改善生活：花 ${cost} 资源点，${checkLine(c)}。如同成功（文化 +1），但国库不堪重负，本回合基于经济的检定 −1。` }
  else {
    state.econBonus = -1; state.unrest += 1
    if (canIgnoreFirst()) { state.ignoreFirstUsed = true; tradeMsg.value = `改善生活：花 ${cost} 资源点，${checkLine(c)}。本回合经济检定 −1、动荡 +1（举世艳羡：祸患增加已被忽略）。` }
    else { state.ruin[unrestRuinCat.value] = (state.ruin[unrestRuinCat.value] || 0) + 1; tradeMsg.value = `改善生活：花 ${cost} 资源点，${checkLine(c)}。本回合经济检定 −1、动荡 +1、祸患 ${unrestRuinCat.value} +1。` }
  }
  pushLog(tradeMsg.value)
}
function useTreasury() {
  const mouse = isMouse()
  const r = Number(treasuryInput.value)
  if (mouse ? mouseTierOf(treasuryTier.value) < 0 : !(r >= 1 && r <= 20)) return needTradeRoll()
  if (!beginSettle('treasury')) { tradeMsg.value = '本回合已经尝试过动用国库；如需重来，请点「撤销上一次结算」。'; return }
  const b = buildingBonus('动用国库')
  const c = baseCheck('治国术', '忠诚', treasuryInput.value, b, 0, treasuryTier.value)
  if (!c.valid) { settled.value.treasury = false; return needTradeRoll() }
  const take = Number(treasuryTake.value) || 0
  treasuryInput.value = ''
  treasuryTier.value = ''
  // 一旦成功或大成功，此后所有动用国库尝试结果恶化两级，直到还清欠款
  let ti = c.ti
  const hadDebt = (state.debt || 0) > 0
  if (hadDebt) ti = worsenTier(ti, 2)
  const tier = tierName(ti)
  const line = rollLine({ mouse: c.mouse, dc: c.dc, d: c.r, mod: c.mouse ? b : c.m + b, total: c.total, tier })
  if (ti >= 2) {
    state.rp += take; state.debt += take
    tradeMsg.value = `动用国库：${line}${hadDebt ? '（欠款在身，结果恶化两级）' : ''}，取用 ${take} 资源点。此后动用国库结果恶化两级，直到通过资本投资偿还等额资金（当前欠 ${state.debt}）。`
  } else if (ti === 1) {
    tradeMsg.value = `动用国库：${line}${hadDebt ? '（欠款在身，结果恶化两级）' : ''}。未筹到资金。`
  } else {
    state.unrest += 1
    tradeMsg.value = `动用国库：${line}${hadDebt ? '（欠款在身，结果恶化两级）' : ''}。流言蔓延，动荡 +1。`
  }
  pushLog(tradeMsg.value)
}
// 交易商品（工业·经济，基础检定）：把一种商品储备最多减少 4，换取下个王国回合的额外资源骰
const tradeGoodSel = ref('木材')
const tradeDice = ref('')
const tradeTier = ref('')
const tradeDiplo = ref(false)
function tradeGoods() {
  const g = tradeGoodSel.value
  const n = Math.min(4, state.goods[g] || 0)
  if (n <= 0) { tradeMsg.value = `${g} 没有储备可交易。`; return }
  const mouse = isMouse()
  const d = Number(tradeDice.value)
  if (mouse ? mouseTierOf(tradeTier.value) < 0 : !(d >= 1 && d <= 20)) { tradeMsg.value = mouse ? '交易商品：请先选择鼠鼠检定结果。' : '交易商品：请填入桌上掷出的 d20（1–20）。'; return }
  if (!beginSettle('tradeGoods')) { tradeMsg.value = '本回合已经交易过商品；如需重来，请点「撤销上一次结算」。'; return }
  const b = buildingBonus('交易商品') + (tradeDiplo.value ? 1 : 0)
  const c = baseCheck('工业', '经济', tradeDice.value, b, 0, tradeTier.value)
  if (!c.valid) { settled.value.tradeGoods = false; return needTradeRoll() }
  state.goods[g] -= n
  tradeDice.value = ''
  tradeTier.value = ''
  const lastTraded = (state.lastUsed.trade || 0) === state.turn - 1
  let dice = 0
  let eff = ''
  if (c.ti === 3) { dice = n * 2; eff = `下个王国回合每消耗 1 点得 2 颗额外资源骰（共 ${dice} 颗）` }
  else if (c.ti === 2) { dice = n; eff = `下个王国回合每消耗 1 点得 1 颗额外资源骰（共 ${dice} 颗）` }
  else if (c.ti === 1) { dice = 1; eff = '下个王国回合获得 1 颗额外资源骰' }
  else {
    eff = '未获得额外资源骰（商品仍被消耗）'
    if (lastTraded) { state.unrest += 1; eff += '；上回合曾交易商品，动荡 +1' }
  }
  state.pendingDice += dice
  state.lastUsed.trade = state.turn
  tradeMsg.value = `交易商品·${g}（消耗 ${n}）：${checkLine(c)}；${eff}`
  logCalc('商贸阶段·交易商品', {
    rule: '交易商品：选择一种有储备的商品，储备最多减少 4，然后基础检定（与已建交群体交易 +1环境加值）。大成功：下回合每消耗 1 点得 2 颗额外资源骰；成功：得 1 颗／点；失败：下回合 1 颗；大失败：无额外骰，若上回合交易过则动荡 +1（王国规则 交易商品）。d20 由玩家在桌上掷出后录入。',
    input: { 商品: g, 消耗储备: n, 适用技能: '工业', 关键属性: '经济', 与建交群体交易: tradeDiplo.value, 对抗DC: c.dc },
    formula: '检定结果 = d20 + 技能调整值 + 建筑物品加值，对抗控制 DC',
    steps: { 玩家掷出的d20: mouse ? '—' : c.r, 鼠鼠结果: mouse ? tradeTier.value : '—', 检定结果: mouse ? '—' : c.total },
    output: { 分级: c.tier, 下回合额外资源骰: dice, 商品储备: state.goods[g] },
  })
  pushLog('交易商品：' + tradeMsg.value)
}
// 采购商品（贸易·经济，基础检定）：花费 RP 后按四级成功度获得商品
const buyGood = ref('木材')
const buyExtraGood = ref('木材')
const buyDice = ref('')
const buyTier = ref('')
function buy() {
  const price = buyGood.value === '奢侈品' ? 8 : 4
  const mouse = isMouse()
  const d = Number(buyDice.value)
  if (mouse ? mouseTierOf(buyTier.value) < 0 : !(d >= 1 && d <= 20)) { tradeMsg.value = mouse ? '采购商品：请先选择鼠鼠检定结果。' : '采购商品：请填入桌上掷出的 d20（1–20）。'; return }
  if (state.rp < price) { tradeMsg.value = '资源点不足。'; return }
  if (!beginSettle('buy')) { tradeMsg.value = '本回合已经采购过商品；如需重来，请点「撤销上一次结算」。'; return }
  const b = buildingBonus('采购商品')
  const c = baseCheck('贸易', '经济', buyDice.value, b, 0, buyTier.value)
  if (!c.valid) { settled.value.buy = false; return needTradeRoll() }
  state.rp -= price
  buyDice.value = ''
  buyTier.value = ''
  let eff = ''
  if (c.ti === 3) {
    const g2 = buyExtraGood.value === '奢侈品' ? '木材' : buyExtraGood.value
    const a1 = addGoods(buyGood.value, 4)
    const a2 = addGoods(g2, 2)
    eff = `${buyGood.value} +${a1}，${g2} +${a2}（大成功：所选 4 份 + 其他 2 份，奢侈品除外）`
  } else if (c.ti === 2) eff = `${buyGood.value} +${addGoods(buyGood.value, 2)}`
  else if (c.ti === 1) eff = `${buyGood.value} +${addGoods(buyGood.value, 1)}`
  else eff = '未获得商品'
  tradeMsg.value = `采购商品·${buyGood.value}（花 ${price} 资源点）：${checkLine(c)}；${eff}`
  logCalc('商贸阶段·采购商品', {
    rule: '采购商品：花 RP（奢侈品 8、其他 4）后做一次基础检定。大成功：所选 4 份 + 其他任意类型 2 份（奢侈品除外）；成功：所选 2 份；失败：所选 1 份；大失败：0 份（王国规则 采购商品）。d20 由玩家在桌上掷出后录入。',
    input: { 商品: buyGood.value, 花费RP: price, 其他商品: buyExtraGood.value, 适用技能: '贸易', 对抗DC: c.dc },
    formula: '检定结果 = d20 + 技能调整值 + 建筑物品加值，对抗控制 DC',
    steps: { 玩家掷出的d20: c.mouse ? '—' : c.r, 鼠鼠结果: c.mouse ? buyTier.value : '—', 检定结果: c.mouse ? '—' : c.total },
    output: { 分级: c.tier, 商品储备: { ...state.goods } },
  })
  pushLog('采购商品：' + tradeMsg.value)
}
const pactCount = ref(1)
const pactDC = computed(() => (controlDC.value === '—' ? 14 : controlDC.value) + ((state.lastUsed.pact || 0) === state.turn - 1 ? 5 : 0))
function managePacts() {
  const mouse = isMouse()
  const r = Number(pactInput.value)
  if (mouse ? mouseTierOf(pactTier.value) < 0 : !(r >= 1 && r <= 20)) return needTradeRoll()
  const cost = pactCount.value * 2
  if (state.rp < cost) { tradeMsg.value = '资源点不足。'; return }
  if (!beginSettle('pact')) { tradeMsg.value = '本回合已经管理过贸易协定；如需重来，请点「撤销上一次结算」。'; return }
  const b = buildingBonus('订立贸易协定')
  // 若上一回合曾管理贸易协定，DC +5（原文是加 DC，不是把结果降一级）
  const lastManaged = (state.lastUsed.pact || 0) === state.turn - 1
  const c = baseCheck('贸易', '经济', pactInput.value, b, lastManaged ? 5 : 0, pactTier.value)
  if (!c.valid) { settled.value.pact = false; return needTradeRoll() }
  const ti = c.ti
  pactInput.value = ''
  pactTier.value = ''
  state.rp -= cost
  state.lastUsed.pact = state.turn
  if (ti >= 2) { state.pendingDice += pactCount.value; state.marks = state.marks || {}; state.marks.pact = true; tradeMsg.value = `管理贸易协定：花 ${cost} 资源点，${checkLine(c)}${lastManaged ? '（上回合曾管理，DC +5）' : ''}，下回合额外 ${pactCount.value} 颗资源骰。` }
  else tradeMsg.value = `管理贸易协定：花 ${cost} 资源点，${checkLine(c)}${lastManaged ? '（上回合曾管理，DC +5）' : ''}，未取得额外资源骰。`
  pushLog(tradeMsg.value)
}
const improveCost = ref(4)
const treasuryTake = ref(10)

// --- 活动阶段 ---
// 领导活动上限：首都设有城堡、宫殿或市政厅时每位领导 3 项，否则 2 项
const activityCap = computed(() => {
  const cap = state.towns && state.towns[0]
  const lots = (cap && cap.lots) || []
  return lots.some((x) => x === '城堡' || x === '宫殿' || x === '市政厅') ? 3 : 2
})
const acts = computed(() => state.acts)
// 迁都的需求：所有领导者必须把本回合活动阶段的全部领导活动用于迁都
const capitalAllLeaders = computed(() => state.capitalAttemptTurn === state.turn)

// 活动结算：把王国活动按各自的技能检定真正结算，并接入建筑物品加值
const SKILLS = skillsData.skills || []
const activityIndex = {}
const activityOptions = {}   // 活动名 → 可选技能/属性（多个技能可做的活动，如平息动荡/休整放松）
for (const sk of SKILLS) for (const ac of sk.activities || []) {
  if (!activityIndex[ac.name]) activityIndex[ac.name] = { skill: sk.name, attr: sk.attribute, effect: ac.effect }
  ;(activityOptions[ac.name] = activityOptions[ac.name] || []).push({ skill: sk.name, attr: sk.attribute })
}
const ACT_NAMES = ['平息动荡', '休整放松', '制作奢侈品', '创作杰作', '挽回声誉（腐化）', '挽回声誉（犯罪）', '挽回声誉（衰败）', '挽回声誉（内讧）', '庆祝节日', '提供照料', '雇佣冒险者', '渗透', '占卜', '超自然解法', '创造性解法', '资本投资', '收割作物', '捕鱼', '收集牲畜', '新领导层'].filter((n) => activityIndex[n])
// 每项活动归属活动阶段的哪一步，取自《王国规则》「按步骤列出的活动」。
// 类别同时就是「计入哪一类上限」，所以不再单设一个「计入」下拉，免得同一次选择填两遍
const ACT_STEP = {
  领导: ['平息动荡', '休整放松', '制作奢侈品', '创作杰作', '挽回声誉（腐化）', '挽回声誉（犯罪）', '挽回声誉（衰败）', '挽回声誉（内讧）', '庆祝节日', '提供照料', '雇佣冒险者', '渗透', '占卜', '超自然解法', '创造性解法', '资本投资'],
  区域: ['收割作物', '捕鱼', '收集牲畜'],
  不计: ['新领导层'],
}
const ACT_CATS = Object.keys(ACT_STEP)
const actsOf = (cat) => (ACT_STEP[cat] || []).filter((n) => ACT_NAMES.includes(n))
// 食物产出类区域活动：成功 +1 食物，大成功 1d4、大失败 −1d4（1d4 由玩家掷出后录入）
const FOOD_ACTS = ['收割作物', '捕鱼', '收集牲畜']
// 要求对应技能至少「受训」的活动
const TRAINED_ACTS = ['创作杰作', '挽回声誉（腐化）', '挽回声誉（犯罪）', '挽回声誉（衰败）', '挽回声誉（内讧）', '占卜']
// 各活动的两个骰面输入框标签（null = 不显示）
const ACT_EXTRA_LABELS = {
  平息动荡: ['大成功：1d6 动荡减少量', '大失败：1d4 动荡增加量'],
  制作奢侈品: ['成本资源骰（花等额 RP）', '大成功：1d4 奢侈品'],
  创作杰作: ['大成功：2 颗资源骰总和', '大失败：1d4 动荡'],
  庆祝节日: ['节日开销（1 颗资源骰）', null],
  雇佣冒险者: ['成本资源骰（花等额 RP）', null],
  渗透: ['大成功选动荡时：1d4', null],
  超自然解法: ['研究花费骰总和（成功 1d4／失败 2d6）', null],
  创造性解法: ['研究花费骰总和（成功 1d4／失败 2d6）', null],
  资本投资: ['本次获得的 RP（按对应骰数掷出）', '大失败选掷骰时：获得的 RP'],
  收割作物: ['大成功：1d4 食物', '大失败：1d4 食物损失'],
  捕鱼: ['大成功：1d4 食物', '大失败：1d4（无）'],
  收集牲畜: ['大成功：1d4 食物', '大失败：1d4 食物损失'],
}
const actName = ref(actsOf('领导')[0] || '')
const actSkillPick = ref('')   // 多技能活动时玩家实际使用的技能
const actCat = ref('领导')     // 类别：同时决定可选活动与计入哪一类上限
watch(actCat, (cat) => { actName.value = actsOf(cat)[0] || '' })
const actDC = ref(controlDC.value === '—' ? 14 : controlDC.value)
const actDice = ref('')
const actTier = ref('')
const actOut = ref('')
// 各活动的额外骰面与选择项
const actExtra = ref('')
const actExtra2 = ref('')
const actRuin = ref('腐化')            // 涉及祸患时的目标类别
const actCare = ref('动荡')            // 提供照料·大失败：动荡或某项祸患
const actSurvey = ref(true)            // 渗透：是否调查王国状况
const actSurveyChoice = ref('动荡 −1d4')
const actInvestFail = ref('掷1资源骰获RP并增加等量犯罪')
const actEventPick = ref('')           // 雇佣冒险者的目标持续事件
function repayDebt() {
  const d = state.debt || 0
  if (!d) { tradeMsg.value = '当前没有欠款。'; return }
  state.debt = 0
  tradeMsg.value = `资本投资偿还：从个人财富偿还与 ${d} RP 等额的gp，动用国库的结果恶化已解除。`
  pushLog(tradeMsg.value)
}
const actSkillList = computed(() => activityOptions[actName.value] || [])
const actExtraLabels = computed(() => ACT_EXTRA_LABELS[actName.value] || [null, null])
const actInfo = computed(() => {
  const base = activityIndex[actName.value]
  if (!base) return null
  const opt = actSkillList.value.find((o) => o.skill === actSkillPick.value) || actSkillList.value[0] || base
  return { skill: opt.skill, attr: opt.attr, effect: base.effect }
})
watch(actName, () => { actSkillPick.value = '' })
const actBonus = computed(() => buildingBonus(actName.value))
const actMod = computed(() => (actInfo.value ? kingdomSkillMod(actInfo.value.skill, actInfo.value.attr) + actBonus.value + (actCat.value === '领导' ? (state.activityBoon || 0) + rulerPalaceBonus() : 0) : 0))
// 活动本体 DC（含专属调整与「上回合做过」的 +4），供结算与鼠鼠换算共用
function activityDC(A, baseDC) {
  let dc = baseDC
  if (A.startsWith('挽回声誉')) dc = (controlDC.value === '—' ? 14 : controlDC.value) + 2
  if (A === '雇佣冒险者') {
    const ev = events.find((e) => e.名称 === actEventPick.value)
    const adj = ev ? (Number(String(ev.调整值 || '+0').replace(/[^\-\d]/g, '')) || 0) : 0
    dc = (controlDC.value === '—' ? 14 : controlDC.value) + adj
  }
  const restAgain = A === '休整放松' && (state.lastUsed.rest || 0) === state.turn - 1
  const festAgain = A === '庆祝节日' && (state.lastUsed.festival || 0) === state.turn - 1
  return { restAgain, festAgain, effDC: dc + (restAgain ? 4 : 0) + (festAgain ? 4 : 0) }
}
const actEffDC = computed(() => activityDC(actName.value, Number(actDC.value) || (controlDC.value === '—' ? 14 : controlDC.value)).effDC)
function resolveActivity() {
  const info = actInfo.value
  if (!info) { actOut.value = '请选择活动。'; return }
  const A = actName.value
  // 无政府：只能尝试平息动荡活动
  if (state.unrest >= anarchyThreshold() && A !== '平息动荡') {
    actOut.value = '已进入无政府：只能尝试「平息动荡」活动，其他活动均不可用。'
    return
  }
  // 受训要求
  if (TRAINED_ACTS.includes(A) && !isTrained(info.skill)) {
    actOut.value = `${A} 需要「${info.skill}」熟练度至少为受训（当前：${state.proficiencies[info.skill] || '未受训'}）。`
    return
  }
  // 活动专属前置与冷却
  if (A === '创作杰作' && state.lastUsed.masterpiece === state.turn) { actOut.value = '创作杰作每王国回合只能尝试一次。'; return }
  if (A === '资本投资' && !hasBank()) { actOut.value = '资本投资需要王国中至少有一家银行（到「聚落」页建造银行）。'; return }
  if (A === '超自然解法' && (state.lastUsed.supernatural || 0) >= state.turn) { actOut.value = '超自然解法尚在冷却：大失败后 2 个王国回合内不能再次尝试。'; return }
  if (A.startsWith('挽回声誉')) {
    const cat = (A.match(/（(.+)）/) || [])[1] || '腐化'
    const until = state.lastUsed['rep.' + cat] || 0
    if (state.turn <= until) { actOut.value = `${cat} 的挽回声誉尚在冷却（还需 ${until - state.turn + 1} 个王国回合）。`; return }
  }
  if (A === '雇佣冒险者') {
    if (!actEventPick.value) { actOut.value = '请选择要处理的持续事件。'; return }
    if ((state.hiredBlocked || {})[actEventPick.value]) { actOut.value = `「${actEventPick.value}」已无法再通过雇佣冒险者处理。`; return }
  }
  // 平息动荡：每个王国回合最多一次，且不得连续两个王国回合使用同一技能
  if (A === '平息动荡') {
    const last = state.lastUsed.suppress
    if (last && last.turn === state.turn) { actOut.value = '平息动荡每个王国回合最多尝试一次。'; return }
    if (last && last.turn === state.turn - 1 && last.skill === info.skill) {
      actOut.value = `平息动荡不得连续两个王国回合使用同一技能（上回合已用「${info.skill}」），请改选其他技能。`
      return
    }
  }
  // 活动次数上限：领导（在任领导 × 每人上限，扣除未履职放弃项）、区域 3、市政（聚落数 × 市政规划）
  const leaderCap = leaderActivityCap()
  const cityCap = state.settlements * civicPerSettlement()
  // 迁都的需求：本回合全部领导活动都须用于迁都，故领导活动不再可用
  if (actCat.value === '领导' && capitalAllLeaders.value) {
    actOut.value = '本回合已尝试迁都：所有领导者须把本回合的全部领导活动用于迁都，因此不能再进行其他领导活动。'
    return
  }
  const used = actCat.value === '领导' ? acts.value.leader : actCat.value === '区域' ? acts.value.region : actCat.value === '市政' ? acts.value.city : null
  const cap = actCat.value === '领导' ? leaderCap : actCat.value === '区域' ? 3 : actCat.value === '市政' ? cityCap : null
  if (cap !== null && used >= cap) { actOut.value = `${actCat.value}活动已达上限（${used}/${cap}），不能再尝试。`; return }
  const mouse = isMouse()
  const d = mouse ? 0 : Number(actDice.value)
  if (mouse ? mouseTierOf(actTier.value) < 0 : !(d >= 1 && d <= 20)) {
    actOut.value = mouse ? '请先选择鼠鼠检定结果。' : '请填入桌上掷出的 d20（1–20）。'
    return
  }
  const baseDC = controlDC.value === '—' ? 14 : controlDC.value
  const { restAgain, festAgain, effDC } = activityDC(A, Number(actDC.value) || baseDC)
  // 区域活动：守备官空缺时 -4（战争活动的 -4 在军团页处理）
  const mod = actMod.value + (actCat.value === '区域' ? vacancyActivityMod('region') : 0)
  const total = mouse ? 0 : d + mod
  let ti = mouse ? mouseTierOf(actTier.value) : tierIndex(total, effDC, d)
  const anarchy = state.unrest >= anarchyThreshold()
  if (anarchy) ti = worsenTier(ti, 1)
  const tier = tierName(ti)
  // 王国技能检定大成功 → 声望/恶名 +1
  if (ti === 3) state.fame = Math.min(fameCap(), (state.fame || 0) + 1)
  const ex = Number(actExtra.value)
  const ex2 = Number(actExtra2.value)
  const d4 = (v) => (v >= 1 && v <= 4 ? v : 1)
  let eff = ''

  if (A === '平息动荡') {
    if (ti === 3) {
      if (!(ex >= 1 && ex <= 6)) { actOut.value = '平息动荡·大成功：请填入桌上掷出的 1d6（1–6）作为动荡减少量。'; return }
      state.unrest = Math.max(0, state.unrest - ex); eff = `动荡 −${ex}（1d6）`
    }
    else if (ti === 2) { state.unrest = Math.max(0, state.unrest - 1); eff = '动荡 −1' }
    else if (ti === 1) eff = '未能减少动荡'
    else if (canIgnoreFirst()) { state.ignoreFirstUsed = true; eff = '大失败（举世艳羡：已忽略本次动荡增加）' }
    else { const n = d4(ex2); state.unrest += n; eff = `动荡 +${n}（1d4）；另一选项「两项祸患各 +1」可在下方手动施加` }
  } else if (A === '休整放松') {
    if (ti === 3) { state.unrest = Math.max(0, state.unrest - 1); state.activityBoon = 2; eff = '动荡 −1，且接下来一项领导活动 +2 环境加值' }
    else if (ti === 2) { state.unrest = Math.max(0, state.unrest - 1); eff = '动荡 −1' }
    else if (ti === 1) eff = '休息令人欣慰，但没有实质好处'
    else { state.activityBoon = -2; eff = '接下来一项领导活动承受 −2 环境减值' }
  } else if (FOOD_ACTS.includes(A)) {
    if (ti === 3) eff = `食物 +${addGoods('食物', d4(ex))}（1d4）`
    else if (ti === 2) eff = `食物 +${addGoods('食物', 1)}`
    else if (ti === 1) eff = '未获得食物'
    else if ((state.goods['食物'] || 0) > 0) { const lost = Math.min(d4(ex2), state.goods['食物']); state.goods['食物'] -= lost; eff = `大失败：因变质损失 ${lost} 份食物` }
    else { state.unrest += 1; eff = '大失败：无食物可损失，动荡 +1' }
  } else if (A === '制作奢侈品') {
    if (!(ex >= 1)) { actOut.value = '制作奢侈品：请填入桌上掷出的 1 颗资源骰（作为成本 RP）。'; return }
    if (state.rp < ex) { actOut.value = `资源点不足（需 ${ex}）。`; return }
    state.rp -= ex
    if (ti === 3) eff = `奢侈品 +${addGoods('奢侈品', d4(ex2))}（1d4），成本 ${ex} RP`
    else if (ti === 2) eff = `奢侈品 +${addGoods('奢侈品', 1)}，成本 ${ex} RP`
    else if (ti === 1) eff = `未产出值得一提的货物（成本 ${ex} RP）`
    else { state.ruin[actRuin.value] += 1; eff = `祸患 ${actRuin.value} +1（成本 ${ex} RP）` }
  } else if (A === '创作杰作') {
    state.lastUsed.masterpiece = state.turn
    if (ti === 3) {
      state.pendingFame = (state.pendingFame || 0) + 1
      const rp = ex >= 2 ? ex : 0
      state.rp += rp
      eff = `下个王国回合开始时再获得 1 点声望/恶名；立即获得 ${rp} 资源点（2 颗资源骰）`
    } else if (ti === 2) eff = '创作成功：获得 1 点声望/恶名'
    else if (ti === 1) eff = '创作杰作的尝试失败'
    else if ((state.fame || 0) > 0) { state.fame -= 1; eff = '失败得既戏剧化又丢人：失去 1 点声望/恶名' }
    else { const n = d4(ex2); state.unrest += n; eff = `无声望可失去，动荡 +${n}（1d4）` }
  } else if (A.startsWith('挽回声誉')) {
    const cat = (A.match(/（(.+)）/) || [])[1] || '腐化'
    if (ti === 3) {
      const n = reduceRuin(cat, 2)
      const cut = (state.ruinPenalty[cat] || 0) > 0 ? 1 : 0
      state.ruinPenalty[cat] = Math.max(0, (state.ruinPenalty[cat] || 0) - 1)
      eff = `${cat} −${n}，且该祸患减值 −${cut}`
    } else if (ti === 2) eff = `${cat} −${reduceRuin(cat, 1)}`
    else if (ti === 1) { state.lastUsed['rep.' + cat] = state.turn + 1; eff = `未能减少 ${cat}；下 1 个王国回合内不能对该祸患尝试挽回声誉` }
    else {
      const n = d4(ex)
      state.unrest += n
      state.lastUsed['rep.' + cat] = state.turn + 3
      eff = `动荡 +${n}（1d4），且 3 个王国回合内不能尝试挽回声誉`
    }
  } else if (A === '庆祝节日') {
    state.lastUsed.festival = state.turn
    const cost = ex
    const paid = (ti === 2 || ti === 1) && cost >= 1 && state.rp >= cost
    if (ti === 3) {
      addTempEffect({ label: '庆祝节日（大成功）', scope: '忠诚', value: 2, fromTurn: state.turn, untilTurn: state.turn + 1 })
      eff = '到下个王国回合结束前，基于忠诚的检定 +2'
    } else if (ti === 2 && paid) {
      state.rp -= cost
      addTempEffect({ label: '庆祝节日', scope: '忠诚', value: 1, fromTurn: state.turn, untilTurn: state.turn + 1 })
      eff = `到下个王国回合结束前基于忠诚 +1（开支 ${cost} RP）`
    } else if (ti === 1 && paid) {
      state.rp -= cost
      eff = `节日在寥寥热情中过去（开支 ${cost} RP）`
    } else {
      state.dicePenalty = (state.dicePenalty || 0) + 4
      addTempEffect({ label: '庆祝节日（大失败）', scope: '忠诚', value: -1, fromTurn: state.turn, untilTurn: state.turn + 1 })
      eff = '节庆组织不善：下个回合资源骰总数 −4，且到下个王国回合结束前基于忠诚 −1' + ((ti === 2 || ti === 1) ? '（付不起开支，视为大失败）' : '')
    }
  } else if (A === '提供照料') {
    if (ti === 3) { state.unrest = Math.max(0, state.unrest - 1); eff = `动荡 −1，且祸患 ${actRuin.value} −${reduceRuin(actRuin.value, 1)}` }
    else if (ti === 2) { state.unrest = Math.max(0, state.unrest - 1); eff = '动荡 −1' }
    else if (ti === 1) eff = '未能提供值得一提的照料'
    else if (actCare.value === '动荡') { state.unrest += 1; eff = '动荡 +1' }
    else { state.ruin[actCare.value] += 1; eff = `祸患 ${actCare.value} +1` }
  } else if (A === '雇佣冒险者') {
    const name = actEventPick.value
    if (!(ex >= 1)) { actOut.value = '雇佣冒险者：请填入桌上掷出的资源骰（作为成本 RP）。'; return }
    if (state.rp < ex) { actOut.value = `资源点不足（需 ${ex}）。`; return }
    state.rp -= ex
    if (ti === 3) {
      const i = state.ongoingEvents.findIndex((e) => e.name === name)
      if (i >= 0) state.ongoingEvents.splice(i, 1)
      eff = `已结束持续事件「${name}」（成本 ${ex} RP）`
    } else if (ti === 2) { state.hiredBonus = { name, value: 2 }; eff = `未结束「${name}」，但在下个事件阶段解决它时 +2 环境加值` }
    else if (ti === 1) { state.hiredCost2 = { ...(state.hiredCost2 || {}), [name]: true }; eff = `未能结束「${name}」；再次尝试的成本增至 2 个资源骰` }
    else { state.hiredBlocked = { ...(state.hiredBlocked || {}), [name]: true }; eff = `消息传开：再也无法通过雇佣冒险者结束「${name}」` }
  } else if (A === '渗透') {
    if (!actSurvey.value) eff = '非王国状况目标：具体情报由 GM 裁定（按剧情处理）'
    else if (ti === 3) {
      if (actSurveyChoice.value === '动荡 −1d4') { const n = d4(ex); state.unrest = Math.max(0, state.unrest - n); eff = `动荡 −${n}（1d4）` }
      else eff = `祸患 ${actRuin.value} −${reduceRuin(actRuin.value, 1)}`
    } else if (ti === 2) { state.unrest = Math.max(0, state.unrest - 1); eff = '动荡 −1' }
    else if (ti === 1) eff = '未了解到重要情况'
    else { addTempEffect({ label: '渗透大失败', scope: '全部王国检定', value: -2, fromTurn: state.turn, untilTurn: state.turn + 1 }); eff = '到下个王国回合结束前，所有王国检定承受 −2 环境减值' }
  } else if (A === '占卜') {
    if (ti === 3) { state.divination = { pick: 2, bonus: 2, chooser: 'player' }; eff = '本回合随机事件掷两次、由你选择，且解决该事件的检定 +2' }
    else if (ti === 2) { state.divination = { pick: 1, bonus: 1, chooser: 'player' }; eff = '本回合解决随机事件的检定 +1' }
    else if (ti === 1) eff = '未能占卜出任何助益'
    else { state.divination = { pick: 2, bonus: 0, chooser: 'gm', must: true }; eff = '本回合必定发生一次随机事件，且掷两次由 GM 决定' }
  } else if (A === '超自然解法' || A === '创造性解法') {
    const cost = ex
    if (ti >= 2) {
      if (ti === 2) {
        if (!(cost >= 1)) { actOut.value = `${A}：成功，请填入研究花费（1d4）总和。`; return }
        if (state.rp < cost) { actOut.value = `资源点不足（需 ${cost}）。`; return }
        state.rp -= cost
      }
      state.boon = { kind: A, tier }
      eff = `获得一次「${A}」：本回合内可对任一王国检定取优／以 +2 环境加值重掷（${ti === 3 ? '免费' : `花费 ${cost} RP`}）`
    } else if (ti === 1) {
      if (!(cost >= 2)) { actOut.value = `${A}：失败，请填入研究花费（2d6）总和。`; return }
      if (state.rp < cost) { actOut.value = `资源点不足（需 ${cost}）。`; return }
      state.rp -= cost
      eff = `研究失败，耗费 ${cost} RP`
    } else {
      if (cost >= 2 && state.rp >= cost) state.rp -= cost
      if (A === '超自然解法') { state.lastUsed.supernatural = state.turn + 1; eff = `研究失败（耗费 ${cost >= 2 ? cost : 0} RP），且 2 个王国回合内不能再次尝试超自然解法` }
      else { addTempEffect({ label: '创造性解法大失败', scope: '文化', value: -1, fromTurn: state.turn, untilTurn: state.turn + 1 }); eff = `研究失败（耗费 ${cost >= 2 ? cost : 0} RP），且到下个王国回合结束前基于文化的检定 −1` }
    }
  } else if (A === '资本投资') {
    if (ti >= 1) {
      const n = ex >= 0 ? ex : 0
      state.rp += n
      eff = `投入转化为资源点 +${n}（${ti === 3 ? '大成功：4 颗资源骰' : ti === 2 ? '成功：2 颗资源骰' : '失败：1d4'}）`
    } else if (actInvestFail.value === '掷1资源骰获RP并增加等量犯罪') {
      const n = ex2 >= 0 ? ex2 : (ex >= 0 ? ex : 0)
      state.rp += n; state.ruin['犯罪'] += n
      eff = `大失败：资源点 +${n}，犯罪 +${n}`
    } else { state.ruin['犯罪'] += 1; eff = '大失败：资源点 +0，犯罪 +1' }
  } else if (A === '新领导层') {
    eff = '【需手动结算】到上方「分配领导角色」修改即可。'
  } else {
    // 其余活动给出明确的工作台提示，由玩家按说明手动施加后果（下方「手动施加后果」面板）
    eff = '【需手动结算】按活动说明处理：' + (info.effect || '')
  }
  let usedText = ''
  if (actCat.value === '领导') { acts.value.leader += 1; usedText = `已用领导活动 ${acts.value.leader}/${leaderCap} 项` }
  else if (actCat.value === '区域') { acts.value.region += 1; usedText = `已用区域活动 ${acts.value.region}/3 项` }
  else if (actCat.value === '市政') { acts.value.city += 1; usedText = `已用市政活动 ${acts.value.city}/${cityCap} 项` }
  // 休整放松带来的「下一项领导活动」加值在此消耗
  let boonText = ''
  if (actCat.value === '领导' && (state.activityBoon || 0)) { const v = state.activityBoon; state.activityBoon = 0; boonText = `（消耗休整放松 ${v >= 0 ? '+' : ''}${v} 环境加值）` }
  const b = actBonus.value
  const palaceText = actCat.value === '领导' && rulerPalaceBonus() ? `（含宫殿·统治者 +${rulerPalaceBonus()}）` : ''
  if (A === '休整放松') state.lastUsed.rest = state.turn
  if (A === '平息动荡') state.lastUsed.suppress = { turn: state.turn, skill: info.skill }
  const line = rollLine({ mouse, dc: effDC, d, mod: mouse ? 0 : mod, total, tier })
  actOut.value = `${A}（${info.skill}·${info.attr}）：${line}${b ? `（含建筑加值 +${b}）` : ''}${palaceText}${restAgain ? '（上回合已休整放松，DC +4）' : ''}${festAgain ? '（上回合已庆祝节日，DC +4）' : ''}${anarchy ? '（无政府：结果恶化一级）' : ''}；${eff}${boonText}${usedText ? `；${usedText}` : ''}`
  logCalc('活动阶段·' + A, {
    rule: (info.effect || '') + '；王国活动以一次技能检定对抗控制 DC（王国规则 王国活动）。d20 由玩家在桌上掷出后录入；自然 20/1 升降一级，无政府再恶化一级。',
    input: { 活动: A, 适用技能: info.skill, 关键属性: info.attr, 技能调整值: kingdomSkillMod(info.skill, info.attr), 建筑加值: b, 对抗DC: effDC, 上回合已休整: restAgain, 上回合已庆祝: festAgain, 额外骰面: { 一: actExtra.value || '—', 二: actExtra2.value || '—' }, 选择: { 祸患: actRuin.value, 照料后果: actCare.value, 渗透目标: actSurvey.value ? '王国状况' : '其他目标', 雇佣事件: actEventPick.value } },
    formula: '检定结果 = d20 + 技能调整值（属性调整值 + 熟练加值 + 状态加值）+ 建筑物品加值',
    steps: { 玩家掷出的d20: mouse ? '—' : d, 鼠鼠结果: mouse ? actTier.value : '—', 检定结果: mouse ? '—' : total },
    output: { 分级: tier, 效果: eff },
  })
  pushLog(`活动结算：${A} → ${tier}`)
  actDice.value = ''
  actTier.value = ''
  actExtra.value = ''
  actExtra2.value = ''
}

// 外交活动：订立贸易协定 / 派遣外交使节 / 请求外援 / 效忠誓约，对抗目标群体的谈判 DC
const DIPLO_ACTS = [
  { name: '订立贸易协定', skill: '贸易', attr: '经济', note: '与已建交群体订立贸易协定以增强经济（首次订立会触发对应里程碑）。' },
  { name: '派遣外交使节', skill: '治国术', attr: '忠诚', note: '成功即与该群体建立外交关系（记录在王国卡）。' },
  { name: '请求外援', skill: '治国术', attr: '忠诚', note: '向已建交群体请求外援（具体效果按剧情处理）。' },
  { name: '效忠誓约', skill: '谋略', attr: '忠诚', note: '使自由领地等群体宣誓效忠，从而纳入王国。' },
]
const diploAct = ref('派遣外交使节')
const diploGroup = ref('')
const diploDice = ref('')
const diploTier = ref('')
const diploOut = ref('')
const diploWar = ref(false)     // 目标群体是否与王国处于战争状态（派遣外交使节 −4 且结果恶化一级）
const diploActInfo = computed(() => DIPLO_ACTS.find((a) => a.name === diploAct.value) || DIPLO_ACTS[0])
const diploBaseDC = computed(() => {
  const g = groups.find((x) => x.name === diploGroup.value)
  return (g && g.dc) ? g.dc : (controlDC.value === '—' ? 14 : controlDC.value)
})
// 请求外援的 DC = 对方谈判 DC + 2（完整机制 治国术·请求外援）
const diploDC = computed(() => diploBaseDC.value + (diploAct.value === '请求外援' ? 2 : 0))
function resolveDiplo() {
  const g = groups.find((x) => x.name === diploGroup.value)
  if (!g) { diploOut.value = '请选择目标群体。'; return }
  const mouse = isMouse()
  const d = mouse ? 0 : Number(diploDice.value)
  if (mouse ? mouseTierOf(diploTier.value) < 0 : !(d >= 1 && d <= 20)) {
    diploOut.value = mouse ? '请先选择鼠鼠检定结果。' : '请填入桌上掷出的 d20（1–20）。'
    return
  }
  const info = diploActInfo.value
  const dc = diploDC.value
  const b = buildingBonus(info.name)
  const warPen = info.name === '派遣外交使节' && diploWar.value ? -4 : 0
  const mod = mouse ? 0 : kingdomSkillMod(info.skill, info.attr) + b + warPen
  const total = mouse ? 0 : d + mod
  let ti = mouse ? mouseTierOf(diploTier.value) : tierIndex(total, dc, d)
  if (info.name === '派遣外交使节' && diploWar.value) ti = worsenTier(ti, 1)
  const anarchy = state.unrest >= anarchyThreshold()
  if (anarchy) ti = worsenTier(ti, 1)
  const tier = tierName(ti)
  if (ti === 3) state.fame = Math.min(fameCap(), (state.fame || 0) + 1)
  let eff = ''
  if (ti >= 2) {
    if (info.name === '派遣外交使节') { state.diplomacy[g.name] = true; eff = `已与「${g.name}」建立外交关系` }
    else if (info.name === '订立贸易协定') { state.marks = state.marks || {}; state.marks.pact = true; eff = '贸易协定订立成功（首次订立触发里程碑）' }
    else if (info.name === '效忠誓约') eff = '该群体宣誓效忠，可将其领地纳入王国'
    else eff = ti === 3 ? '获得外援：+4 环境加值，并立即获得 2 颗资源骰的 RP' : '获得外援：+2 环境加值，或掷 1 颗资源骰的 RP（二选一）'
  } else if (ti === 0) eff = '失败且可能招致对方反感（按剧情处理）'
  else eff = info.name === '请求外援' ? '盟友资源未及送达：下个王国回合开始时获得 1d4 RP' : '失败'
  const line = rollLine({ mouse, dc, d, mod: mouse ? b + warPen : mod, total, tier })
  diploOut.value = `${info.name}·${g.name}：${line}${warPen ? '（对交战国 −4 且结果恶化一级）' : ''}${anarchy ? '（无政府：结果恶化一级）' : ''}；${eff}`
  logCalc('外交活动·' + info.name, {
    rule: info.note + '（王国规则 外交关系 / 谈判DC）。d20 由玩家在桌上掷出后录入。',
    input: { 活动: info.name, 目标群体: g.name, 适用技能: info.skill, 关键属性: info.attr, 技能调整值: kingdomSkillMod(info.skill, info.attr), 建筑加值: b, 战争减值: warPen, 谈判DC: dc },
    formula: '检定结果 = d20 + 技能调整值 + 建筑物品加值，对抗谈判 DC；自然 20/1 升降一级',
    steps: { 玩家掷出的d20: mouse ? '—' : d, 鼠鼠结果: mouse ? diploTier.value : '—', 检定结果: mouse ? '—' : total },
    output: { 分级: tier, 效果: eff },
  })
  pushLog(`外交活动：${info.name}（${g.name}）→ ${tier}`)
  diploDice.value = ''
  diploTier.value = ''
}

// --- 事件阶段 ---
const eventRoll = ref(null)
const drawn = ref(null)
const evFilter = ref('全部')
const evInput = ref('')
const evTier = ref('')
const evD100 = ref('')
const evD100b = ref('')   // 占卜：第二次抽取用的 d100
const evPool = computed(() => (evFilter.value === '全部' ? events : events.filter((e) => e.调整值 === evFilter.value)))
// 随机王国事件表的 d% 权重（完整机制 随机王国事件表，合计 100）
const EVENT_WEIGHTS = eventWeights
// 按 d% 权重抽取事件：完整表时直接用 d100 落点；子集时按比例缩放；未录入 d100 则随机
function pickEvent(rollRaw) {
  const pool = evPool.value.length ? evPool.value : events
  const weights = pool.map((e) => EVENT_WEIGHTS[e.名称] || 1)
  const total = weights.reduce((a, b) => a + b, 0)
  const isFull = pool.length === events.length && total === 100
  let roll = Number(rollRaw)
  if (roll >= 1 && roll <= 100 && isFull) { /* 完整表：d100 直接作为落点 */ }
  else if (roll >= 1 && roll <= 100) roll = Math.max(1, Math.ceil((roll / 100) * total))
  else roll = 1 + Math.floor(Math.random() * total)
  let acc = 0
  for (let i = 0; i < pool.length; i++) { acc += weights[i]; if (roll <= acc) return pool[i] }
  return pool[pool.length - 1]
}
// 占卜：本回合抽取两次、由玩家或 GM 二选一时，暂存两个候选
const evChoices = ref([])
function chooseEvent(ev) {
  drawn.value = ev
  state.lastEvent = ev.名称
  evChoices.value = []
  pushLog(`占卜选定事件：${ev.名称}`)
}
function checkEvent() {
  const mouse = isMouse()
  const r = Number(evInput.value)
  const mt = mouseTierOf(evTier.value)
  if (mouse ? mt < 0 : (!r || r < 1 || r > 20)) {
    eventRoll.value = { err: mouse ? '请先选择鼠鼠平值检定结果。' : '请填入桌上掷出的 d20（1–20）。' }
    return
  }
  const dcBefore = state.eventDC
  const div = state.divination
  // 占卜大失败：本回合必定发生一次随机事件
  const triggered = (mouse ? mt >= 2 : r >= dcBefore) || !!(div && div.must)
  const rollLabel = mouse ? `幸运骰 ${luckDie(dcBefore)}-in-6` : `d20 ${r}`
  logCalc('事件阶段·随机事件检定', {
    rule: '尝试一次 DC 16 的平值检定；成功则发生一次随机王国事件，未发生则下个回合该 DC 减少 5，一旦发生即重置为 16。抽取按「随机王国事件表」的 d% 权重，而非等概率（王国规则/完整机制 事件阶段 与 随机王国事件表）。d20 由玩家在桌上掷出后录入。',
    input: { 检定前DC: dcBefore, 抽取范围: evFilter.value, 候选事件数: evPool.value.length, d100: evD100.value || '（未录入，随机）', 占卜: div ? div : '—' },
    formula: '平值检定：d20 ≥ DC 即成功（不加调整值）；命中后按 d% 权重抽取事件',
    steps: { 玩家掷出的d20: mouse ? '—' : r, 鼠鼠结果: mouse ? evTier.value : '—', 抽出事件: '见结果' },
    output: { 是否触发: triggered, '检定后DC': triggered ? 16 : dcBefore - 5 },
  })
  evInput.value = ''
  evTier.value = ''
  if (triggered) {
    if (div && div.pick === 2) {
      const a = pickEvent(evD100.value)
      const b = pickEvent(evD100b.value)
      evChoices.value = [a, b]
      drawn.value = null
      eventRoll.value = { r: rollLabel, label: rollLabel, mouse, ok: true }
      state.eventDC = 16
      pushLog(`事件检定 ${rollLabel}：占卜使本回合掷两次（${a.名称} ／ ${b.名称}），由${div.chooser === 'player' ? '你' : 'GM'}选择其一`)
    } else {
      const ev = pickEvent(evD100.value)
      drawn.value = ev
      state.lastEvent = ev.名称 || ''
      eventRoll.value = { r: rollLabel, label: rollLabel, mouse, ok: true }
      state.eventDC = 16
      pushLog(`事件检定 ${rollLabel}，触发随机事件：${ev.名称}`)
    }
  } else {
    eventRoll.value = { r: rollLabel, label: rollLabel, mouse, ok: false }
    state.eventDC -= 5
    pushLog(`事件检定 ${rollLabel}，本回合无事，下回合 DC 降为 ${state.eventDC}`)
  }
  evD100.value = ''
  evD100b.value = ''
}
// 事件DC = 控制DC + 事件的等级调整值；事件等级 = 王国等级 + 调整值
function eventDCOf(ev) {
  const adj = Number(String(ev && ev.调整值 || '+0').replace(/[^\-\d]/g, '')) || 0
  return { dc: (controlDC.value === '—' ? 14 : controlDC.value) + adj, level: state.level + adj, adj }
}
// 剧情/条件驱动事件：不走随机检定，直接发生
const forceEventName = ref('')
function forceEvent() {
  const ev = events.find((e) => e.名称 === forceEventName.value)
  if (!ev) { return }
  drawn.value = ev
  state.lastEvent = ev.名称
  eventRoll.value = null
  forceEventName.value = ''
  logCalc('事件阶段·剧情事件', {
    rule: '故事/条件驱动事件按规则或剧情直接发生，不经过事件阶段的随机检定；事件等级 = 王国等级 + 调整值，解决检定的 DC = 控制 DC + 调整值（完整机制 王国事件）。',
    input: { 事件: ev.名称, 调整值: ev.调整值, 特质: ev.特质 },
    output: eventDCOf(ev),
  })
  pushLog(`剧情事件发生：${ev.名称}（调整值 ${ev.调整值}）`)
}
// 说明：本系统按用户需求特意改造为「里程碑驱动的王国等级」——达成一项里程碑即直接 +1 级，
// 完全不使用、也不记录 XP（不使用原规则的「1000 XP/级」与各类 XP 来源）。
// 里程碑共 19 项，达成 19 项即可从 1 级升到满级 20 级。
// 除「花费 100 RP」（难以在状态里判定）外，其余里程碑均由 check() 自动触发。
function townRank() {
  // 0 村庄 1 城镇 2 城市 3 大都会（按含建筑的街区数）
  let best = 0
  for (const t of state.towns || []) {
    const l = t.lots || []
    let blocks = 0
    for (let i = 0; i < l.length; i += 4) if (l.slice(i, i + 4).some(Boolean)) blocks++
    const rank = blocks >= 10 ? 3 : blocks >= 5 ? 2 : blocks >= 2 ? 1 : 0
    if (rank > best) best = rank
  }
  return best
}
function claimedCodes() { return Object.keys(state.hexClaimed || {}).filter((k) => state.hexClaimed[k]) }
function hexText(code) { const h = hexes.find((x) => x.code === code); return h ? (h.name + ' ' + (h.resource || '')) : '' }

const MILESTONES = [
  { key: 'm_landmark', label: '占据第一处地标', check: () => claimedCodes().some((c) => /地标/.test(hexText(c))) },
  { key: 'm_sanctuary', label: '占据第一处庇护所', check: () => claimedCodes().some((c) => /庇护所/.test(hexText(c))) },
  { key: 'm_worksite', label: '首次建立工地（伐木场／矿场／采石场）', check: () => (state.worksites || []).length >= 1 },
  { key: 'm_farm', label: '首次成功开垦农田', check: () => (state.farmHexes || []).length >= 1 },
  { key: 'm_leaders', label: '分配全部八个领导角色', check: () => roles.every((r) => state.leaders[r.name]) },
  { key: 'm_size10', label: '王国规模达到 10', check: () => claimedCount() >= 10 },
  { key: 'm_diplo', label: '首次建立外交关系', check: () => Object.values(state.diplomacy || {}).some(Boolean) },
  { key: 'm_town', label: '把村庄扩建为第一座城镇', check: () => townRank() >= 1 },
  { key: 'm_pact', label: '订立第一份贸易协定', check: () => !!(state.marks && state.marks.pact) },
  { key: 'm_quest', label: '完成第一项王国任务', check: () => Object.values(state.questStatus || {}).some((v) => v === '已完成') },
  { key: 'm_special', label: '首次征募一支特种军队', check: () => (state.legions || []).some((l) => l.type === '特种兵') },
  { key: 'm_size25', label: '王国规模达到 25', check: () => claimedCount() >= 25 },
  { key: 'm_rp100', label: '在一个王国回合中花费 100 RP', check: null },
  { key: 'm_battle', label: '首次赢得一场战争遭遇', check: () => !!(state.marks && state.marks.warWon) },
  { key: 'm_capital', label: '首都建成城堡／宫殿／市政厅', check: () => !!((state.towns[0] || {}).lots || []).some((x) => x === '城堡' || x === '宫殿' || x === '市政厅') },
  { key: 'm_city', label: '把城镇扩建为第一座城市', check: () => townRank() >= 2 },
  { key: 'm_size50', label: '王国规模达到 50', check: () => claimedCount() >= 50 },
  { key: 'm_metro', label: '把城市扩建为第一座大都市', check: () => townRank() >= 3 },
  { key: 'm_size100', label: '王国规模达到 100', check: () => claimedCount() >= 100 },
]
const claimedMilestones = computed(() => Object.keys(state.milestones || {}).length)
function claimMilestone(m, byAuto = false) {
  if (state.milestones[m.key]) return
  state.milestones[m.key] = true
  const before = state.level
  if (state.level < 20) { state.level += 1; syncLegionLevels() }
  logCalc('里程碑' + (byAuto ? '·自动达成' : '·手动达成'), {
    rule: '本系统按用户需求改造为里程碑驱动的王国等级：达成一项里程碑即直接提升 1 级，不使用、不记录 XP。',
    input: { 里程碑: m.label, 触发方式: byAuto ? '条件自动触发' : '手动' },
    output: { 达成前等级: before, 达成后等级: state.level },
  })
  pushLog(`里程碑${byAuto ? '自动' : ''}达成：${m.label}（王国等级 ${before} → ${state.level}）`)
}
// 里程碑自动触发：任何相关状态变化后重新检测（幂等，已达成的不再处理）
watchEffect(() => {
  for (const m of MILESTONES) {
    if (!m.check || state.milestones[m.key]) continue
    if (m.check()) claimMilestone(m, true)
  }
})
// --- 持续事件跟踪 ---
function isSustained(ev) { return /持续/.test(ev && ev.特质 ? ev.特质 : '') }
function addOngoing() {
  const ev = drawn.value
  if (!ev) return
  state.ongoingEvents.push({ name: ev.名称, skill: ev.王国技能 || '', resolve: ev.解决 || '', special: ev.特殊 || '' })
  pushLog(`持续事件加入跟踪：${ev.名称}`)
}
function resolveOngoing(i) {
  const e = state.ongoingEvents[i]
  if (!e) return
  state.ongoingEvents.splice(i, 1)
  pushLog(`持续事件已解决：${e.name}`)
}

// --- 事件后果：按事件描述手工施加到王国 ---
const RUIN_CATS = ['腐化', '犯罪', '衰败', '内讧']
const evRuinCat = ref('腐化')
const evRuinN = ref(1)
const evUnrest = ref(0)
const evAttr = ref('文化')
const evAttrN = ref(0)
const evRp = ref(0)
const evFame = ref(0)
const evGood = ref('木材')
const evGoodN = ref(0)
const evOut = ref('')

function applyEventRuin() {
  const n = Number(evRuinN.value) || 0
  if (n <= 0) { evOut.value = '祸患增量需为正数。'; return }
  if (canIgnoreFirst()) {
    state.ignoreFirstUsed = true
    evOut.value = `举世艳羡：忽略本回合首次祸患增加（${evRuinCat.value} +${n}）`
    pushLog(evOut.value); return
  }
  state.ruin[evRuinCat.value] += n
  logCalc('事件后果·增加祸患', {
    rule: '王国事件可使某类祸患增加；举世艳羡（20级）可忽略每回合首次增加（王国规则 祸患）',
    input: { 类别: evRuinCat.value, 增加量: n, 有效阈值: effectiveRuinThreshold(evRuinCat.value) },
    output: { 祸患: state.ruin[evRuinCat.value], 超阈值: state.ruin[evRuinCat.value] > effectiveRuinThreshold(evRuinCat.value) },
  })
  evOut.value = `${evRuinCat.value} +${n} → ${state.ruin[evRuinCat.value]}`
  pushLog('事件后果：' + evOut.value)
}
function settleEventRuin() {
  const cat = evRuinCat.value
  if (state.ruin[cat] > effectiveRuinThreshold(cat)) {
    state.ruin[cat] -= effectiveRuinThreshold(cat)
    state.ruinPenalty[cat] += 1
    logCalc('事件后果·祸患溢出', {
      rule: '某类祸患超过阈值时，点数减去等于阈值的数量，该类祸患减值 +1（王国规则 祸患）',
      input: { 类别: cat, 阈值: effectiveRuinThreshold(cat) },
      formula: '点数 -= 阈值；减值 += 1',
      output: { 结算后点数: state.ruin[cat], 减值: state.ruinPenalty[cat] },
    })
    evOut.value = `${cat} 溢出结算：点数 ${state.ruin[cat]}，减值 −${state.ruinPenalty[cat]}`
  } else evOut.value = `${cat} 未超阈值，无需结算。`
  pushLog('事件后果：' + evOut.value)
}
function applyEventUnrest() {
  const n = Number(evUnrest.value) || 0
  if (!n) { evOut.value = '动荡增量不能为 0。'; return }
  state.unrest = Math.max(0, state.unrest + n)
  logCalc('事件后果·调整动荡', { rule: '王国事件可增减动荡（王国规则 动荡）', input: { 增减: n }, output: { 动荡: state.unrest } })
  evOut.value = `动荡 ${n >= 0 ? '+' : ''}${n} → ${state.unrest}`
  pushLog('事件后果：' + evOut.value)
}
function applyEventAttr() {
  const n = Number(evAttrN.value) || 0
  if (!n) { evOut.value = '属性增量不能为 0。'; return }
  state.attributes[evAttr.value] = Math.max(0, state.attributes[evAttr.value] + n)
  logCalc('事件后果·调整属性', { rule: '王国事件可增减某项王国属性（王国规则 属性）', input: { 属性: evAttr.value, 增减: n }, output: { 新值: state.attributes[evAttr.value] } })
  evOut.value = `${evAttr.value} ${n >= 0 ? '+' : ''}${n} → ${state.attributes[evAttr.value]}`
  pushLog('事件后果：' + evOut.value)
}
function applyEventRp() {
  const n = Number(evRp.value) || 0
  if (!n) { evOut.value = '资源点增量不能为 0。'; return }
  state.rp = Math.max(0, state.rp + n)
  logCalc('事件后果·调整资源点', { rule: '王国事件可增减资源点（王国规则 资源）', input: { 增减: n }, output: { 本期资源点: state.rp } })
  evOut.value = `资源点 ${n >= 0 ? '+' : ''}${n} → ${state.rp}`
  pushLog('事件后果：' + evOut.value)
}
function applyEventGood() {
  const n = Number(evGoodN.value) || 0
  if (!n) { evOut.value = '商品增量不能为 0。'; return }
  state.goods[evGood.value] = Math.max(0, (state.goods[evGood.value] || 0) + n)
  logCalc('事件后果·调整商品', { rule: '王国事件可增减商品（王国规则 商品）', input: { 商品: evGood.value, 增减: n }, output: { 新数量: state.goods[evGood.value] } })
  evOut.value = `${evGood.value} ${n >= 0 ? '+' : ''}${n} → ${state.goods[evGood.value]}`
  pushLog('事件后果：' + evOut.value)
}
function applyEventFame() {
  const n = Number(evFame.value) || 0
  if (!n) { evOut.value = '声望/恶名增量不能为 0。'; return }
  state.fame = Math.max(0, Math.min(fameCap(), (state.fame || 0) + n))
  logCalc('事件后果·调整声望/恶名', { rule: '王国事件与活动可增减声望/恶名，上限由等级决定（王国规则 声望与恶名）', input: { 增减: n, 上限: fameCap() }, output: { 声望: state.fame } })
  evOut.value = `${state.fameKind} ${n >= 0 ? '+' : ''}${n} → ${state.fame}/${fameCap()}`
  pushLog('事件后果：' + evOut.value)
}

// 说明：本系统不使用 XP（见上方里程碑驱动的改造），故不再提供 XP 调整入口。

// --- 持续效果（跨回合）：事件／活动的效果常持续到「下个王国回合结束前」---
const effScope = ref('全部王国检定')
const effValue = ref(-2)
const effFrom = ref(state.turn)
const effUntil = ref(state.turn + 1)
const effLabel = ref('')
function addEffect() {
  const v = Number(effValue.value) || 0
  if (!v) { evOut.value = '持续效果的数值不能为 0。'; return }
  const from = Number(effFrom.value) || state.turn
  const until = Number(effUntil.value) || state.turn
  if (until < from) { evOut.value = '结束回合不能早于起始回合。'; return }
  addTempEffect({ label: effLabel.value, scope: effScope.value, value: v, fromTurn: from, untilTurn: until })
  evOut.value = `已添加持续效果：${effLabel.value ? effLabel.value + ' · ' : ''}${effScope.value} ${v >= 0 ? '+' : ''}${v}（第 ${from}–${until} 回合）`
  effLabel.value = ''
  pushLog('持续效果：' + evOut.value)
}

function levelUp() {
  if (state.level >= 20) return
  state.level += 1
  syncLegionLevels()
  pushLog(`王国等级提升至 ${state.level}（里程碑制·手动提升），军团等级同步提升`)
}
function endTurn() {
  // 一键结束会清掉本期资源点、重置声望、让持续效果过期，先确认
  if (!confirm(`结束第 ${state.turn} 回合？本期资源点 ${state.rp} 将清零、声望重置为 1、持续效果按回合区间过期、活动次数清零。此操作不可撤销。`)) return
  pushLog(`回合结束`)
  state.turn += 1
  pruneTempEffects()                  // 丢弃已过期的持续效果，并清空本回合的占卜／解法好处
  state.rp = 0
  state.bonusDice = state.pendingDice + featBonusDice()
  state.pendingDice = 0
  state.cultureBonus = 0
  state.econBonus = 0
  state.turnAttrPenalty = {}         // 本回合属性环境减值随回合结束清空
  // 回合开始时自动获得 1 点声望；创作杰作大成功等可在此额外 +1
  state.fame = Math.min(fameCap(), 1 + (state.pendingFame || 0))
  state.pendingFame = 0
  state.hiredBonus = null
  state.ignoreFirstUsed = false         // 举世艳羡：每回合可忽略一次，回合重置
  state.leaderSkip = 0
  state.leaderAbsent = {}
  state.armyActs = {}
  state.claimLog = { turn: state.turn, count: 0 }
  state.acts = { leader: 0, region: 0, city: 0 }   // 活动次数按回合清零
  resetSettles()
  rollResult.value = null; unrestRoll.value = ''; payResult.value = ''; eventRoll.value = null; drawn.value = null; tradeMsg.value = ''
  rpInput.value = ''; taxInput.value = ''; taxTier.value = ''; skipTaxDice.value = ''; skipTaxTier.value = ''; improveInput.value = ''; improveTier.value = ''; treasuryInput.value = ''; treasuryTier.value = ''; pactInput.value = ''; pactTier.value = ''; evInput.value = ''; evTier.value = ''; evD100.value = ''; evD100b.value = ''; d10Input.value = ''; payD4Input.value = ''; evOut.value = ''; actDice.value = ''; actTier.value = ''; actOut.value = ''; actExtra.value = ''; actExtra2.value = ''; diploDice.value = ''; diploTier.value = ''
  evChoices.value = []
  phase.value = 0
}
</script>

<template>
  <div class="panel">
    <h2>王国回合 · 第 {{ state.turn }} 回合</h2>
    <div class="row" style="margin-bottom: 12px">
      <div class="field"><label>等级</label><div class="num">{{ state.level }}</div></div>
      <div class="field"><label>控制 DC</label><div class="num">{{ controlDC }}</div></div>
      <div class="field"><label>本期资源点</label><div class="num">{{ state.rp }}</div></div>
      <div class="field"><label>里程碑</label><div class="num">{{ claimedMilestones }} / {{ MILESTONES.length }}</div></div>
      <div class="field"><label>动荡</label><div class="num">{{ state.unrest }}<span class="muted"> （检定 {{ unrestPenalty(state.unrest) }}）</span></div></div>
      <div class="field"><label>资源骰</label><div class="num">{{ rpDice }}{{ die }}</div></div>
      <div class="field"><label>{{ state.fameKind }}<Hint text="回合开始自动 +1；大成功、名声相符的建筑、创作杰作、值得注意的行动可再得。花 1 点可重掷一次王国技能检定，花全部可推迟一次无政府或覆灭的后果；回合结束时作废。" /></label><div class="num">{{ state.fame }}<span class="muted"> / {{ fameCap() }}</span></div></div>
      <div class="field" v-if="vacancyNow.names.length">
        <label>空缺惩罚<Hint text="未被指派或标记为未履职的领导角色会带来惩罚：统治者让所有检定 −1、控制 DC +2、回合开始 1d4 动荡；顾问/使者/财务官/总督让对应属性检定 −1；将军/大法师让战争活动 −4；守备官让区域活动 −4。" /></label>
        <div class="num" style="color: var(--warn)">
          全部检定 {{ vacancyNow.allChecks >= 0 ? '+' : '' }}{{ vacancyNow.allChecks }}
          · 控制 DC {{ vacancyNow.controlDC >= 0 ? '+' : '' }}{{ vacancyNow.controlDC }}
          <span v-if="vacancyNow.war"> · 战争 {{ vacancyNow.war }}</span>
          <span v-if="vacancyNow.region"> · 区域 {{ vacancyNow.region }}</span>
        </div>
      </div>
    </div>
    <p class="muted" v-if="undoSnap" style="margin: -4px 0 10px">
      <button class="act" @click="undoSettle">撤销上一次结算</button>
      <span class="muted">　恢复到点击前的状态</span>
    </p>
    <nav class="steps">
      <button v-for="(p, i) in phases" :key="p" :class="{ active: phase === i }" @click="phase = i">{{ p }}</button>
    </nav>
  </div>

  <!-- 维持 -->
  <div class="panel" v-if="phase === 0">
    <h2>1 分配领导角色<span class="muted">（已任命 {{ investedCount }} / 4 · 空缺 {{ vacancies }} 席<Hint text="只有已任命的角色按其关键属性提供状态加值，同一属性不叠加（8 级 +2、16 级 +3）；每个王国回合开始时可以重新选定要任命的 4 个角色。未指派或标记为未履职的角色承受空缺惩罚；未投入一周休整时间的领导者也可以改为在本回合放弃一项领导活动。" /></span></h2>
    <div class="row">
      <div class="field" v-for="r in roles" :key="r.name">
        <label>
          {{ r.name }}<span class="muted"> · {{ r.attribute }}</span>
          <span class="muted" v-if="r.name === state.civilServiceRole">（文官制度豁免）</span>
        </label>
        <input v-model="state.leaders[r.name]" placeholder="未指派" style="width: 150px" />
        <div class="check" style="margin-top: 4px">
          <input :id="'ti-' + r.name" type="checkbox" :checked="isInvested(r.name)" :disabled="!isInvested(r.name) && investedCount >= 4" @change="toggleInvest(r.name)" />
          <label :for="'ti-' + r.name">任命</label>
        </div>
        <div class="check" style="margin-top: 2px">
          <input :id="'ab-' + r.name" type="checkbox" v-model="state.leaderAbsent[r.name]" :disabled="!state.leaders[r.name]" />
          <label :for="'ab-' + r.name">未履职（按空缺）</label>
        </div>
      </div>
      <div class="field">
        <label>因未履职放弃的领导活动数</label>
        <input type="number" min="0" v-model.number="state.leaderSkip" style="width: 90px" />
      </div>
    </div>
    <div v-if="hasFeat('文官制度')" class="row" style="margin-top: 10px">
      <div class="field">
        <label>文官制度 · 豁免空缺惩罚的角色<Hint text="该角色空缺时不产生空缺惩罚；可在回合开始时用「新领导层」活动更换受支持的角色。" /></label>
        <select v-model="state.civilServiceRole" style="min-width: 160px">
          <option value="">无</option>
          <option v-for="r in roles" :key="r.name">{{ r.name }}</option>
        </select>
      </div>
    </div>

    <h2 style="margin-top: 22px">2 调整动荡<Hint text="动荡变化 = 过度拥挤聚落数 + 战争（+1）+ 持续事件调整。动荡 ≥10 时每回合掷 1d10 计入某项祸患，并做一次 DC 11 平值检定（失败失去一个六角格）；≥20 陷入无政府。" /></h2>
    <div class="row">
      <div class="field"><label>过度拥挤聚落</label><div class="num">{{ crowdedNow }}</div></div>
      <div class="field"><label>战争</label>
        <div class="check" style="padding-top: 7px"><input type="checkbox" v-model="state.war" id="war" /><label for="war">处于战争</label></div>
      </div>
      <div class="field"><label>持续事件调整</label><input type="number" v-model.number="state.sustainedEventMod" /></div>
      <div class="field"><label>合计变化</label><div class="num">{{ unrestDelta >= 0 ? '+' : '' }}{{ unrestDelta }}</div></div>
      <template v-if="state.unrest + unrestDelta >= 10">
        <div class="field"><label>桌上 1d10 祸患增量</label><input type="number" min="1" max="10" v-model="d10Input" style="width: 80px" /></div>
        <div class="field"><label>计入哪项祸患</label><select v-model="unrestRuinCat"><option v-for="c in RUIN_CATS" :key="c">{{ c }}</option></select></div>
        <CheckRoll v-model:dice="unrestFlatD20" v-model:tier="unrestFlatTier" :dc="11" flat label="DC 11 平值检定 d20" width="80px" />
      </template>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.unrest" @click="applyUnrest">结算动荡</button></div>
    </div>
    <div class="row" v-if="rulerVacant" style="margin-top: 8px">
      <div class="field"><label>统治者空缺 · 1d4 动荡</label><input type="number" min="1" max="4" v-model="rulerVacD4" style="width: 80px" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.rulerVac" @click="applyRulerVacancy">计入动荡</button></div>
    </div>
    <p class="muted" v-if="rulerVacOut">{{ rulerVacOut }}</p>
    <p class="muted" v-if="state.unrest >= anarchyThreshold()" style="color: var(--warn)">已进入无政府：只能尝试平息动荡，且所有王国检定结果恶化一级（判定时成功按失败计）。</p>
    <p class="muted" v-if="unrestRoll">{{ unrestRoll }}</p>

    <h2 style="margin-top: 22px">3 资源收集<span class="muted">（{{ rpDice }} 颗 {{ die }}）</span></h2>
    <div class="row">
      <div class="field"><label>桌上掷出的骰面</label><input v-model="rpInput" placeholder="如 3,5,2 或直接填总和" style="width: 200px" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.rp" @click="settleResources">结算资源骰</button></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.worksites" @click="collectWorksites">收集工地商品</button></div>
    </div>
    <p v-if="rollResult && rollResult.err" class="muted" style="margin-top: 10px">{{ rollResult.err }}</p>
    <p v-else-if="rollResult" style="margin-top: 10px">
      <span class="tag">{{ rollResult.out.join(' + ') }}</span> 合计 <b class="num">{{ rollResult.sum }}</b>，已入本期资源点。
    </p>
    <p class="muted" v-if="collectOut">{{ collectOut }}</p>

    <h2 style="margin-top: 22px">4 支付消耗<Hint text="受影响农田的减免需判定「受聚落影响」，本模拟器不从地图推导邻接，故未计入。" /></h2>
    <p class="muted">
      消耗 = 聚落 {{ consumptionParts().settlement }} + 军队 {{ consumptionParts().army }} + 事件调整 {{ consumptionParts().event }} = <b class="num">{{ consumptionValue }}</b> 点<template v-if="state.turn === 1">（第 1 个王国回合消耗为 0）</template>。
    </p>
    <div class="row">
      <div class="field"><label>食物结余</label><div class="num">{{ state.goods.食物 }} 份</div></div>
      <div class="field"><label>事件·消耗调整</label><input type="number" v-model.number="state.eventConsumptionMod" style="width: 80px" /></div>
      <div class="field"><label>桌上 1d4（缺口记动荡时，每点各掷）</label><input type="number" v-model="payD4Input" style="width: 80px" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.pay" @click="payWithFood">用食物付，缺口折资源点</button></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.pay" @click="payWithUnrest">用食物付，缺口记动荡</button></div>
    </div>
    <p class="muted" v-if="payResult">{{ payResult }}</p>
  </div>

  <!-- 商贸 -->
  <div class="panel" v-if="phase === 1">
    <h2>1 征税<span class="muted">治国术／贸易<Hint text="税吏征收资金：成功则本回合基于经济的检定 +1 环境加值，失败则动荡 +1。" /></span></h2>
    <div class="row">
      <CheckRoll v-model:dice="taxInput" v-model:tier="taxTier" :dc="controlDC" label="桌上掷出的 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.taxStep" @click="tax">结算征税检定</button></div>
    </div>
    <div class="row">
      <CheckRoll v-model:dice="skipTaxDice" v-model:tier="skipTaxTier" :dc="11" flat label="跳过征税 · DC 11 平值检定 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.taxStep" @click="skipTaxFlat">结算平值检定（成功动荡 −1）</button></div>
    </div>

    <h2 style="margin-top: 22px">2 批准开支<Hint text="改善生活：花资源点提升市民生活，换取基于文化的检定加值。动用国库：取用现金储备，但此后动用国库的结果恶化两级，直到用资本投资偿还等额资金。" /></h2>
    <div class="row">
      <div class="field"><label>改善生活 · 花资源点</label><input type="number" v-model.number="improveCost" /></div>
      <CheckRoll v-model:dice="improveInput" v-model:tier="improveTier" :dc="controlDC" label="桌上掷出的 d20（文化）" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.improve" @click="improveLife">结算并开支</button></div>
    </div>
    <div class="row" style="margin-top: 10px">
      <div class="field"><label>动用国库 · 取用资源点</label><input type="number" v-model.number="treasuryTake" /></div>
      <CheckRoll v-model:dice="treasuryInput" v-model:tier="treasuryTier" :dc="controlDC" label="桌上掷出的 d20（忠诚）" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.treasury" @click="useTreasury">结算并取用</button></div>
      <div class="field"><label>欠款</label><div class="num">{{ state.debt }}</div></div>
    </div>

    <h2 style="margin-top: 22px">3 动用商品<Hint text="交易商品：把一种商品储备最多减少 4，做一次基础检定（工业／经济），换取下个王国回合的额外资源骰。采购商品：奢侈品 8 资源点、其他 4 资源点，做一次基础检定（贸易／经济）后按成功度获得商品。" /></h2>
    <div class="row">
      <div class="field" v-for="g in GOODS" :key="'gd' + g"><label>{{ g }}</label><div class="num">{{ state.goods[g] }}</div></div>
    </div>
    <div class="row" style="margin-top: 10px">
      <div class="field"><label>交易</label><select v-model="tradeGoodSel"><option v-for="g in GOODS" :key="'tg' + g">{{ g }}</option></select></div>
      <div class="field">
        <label>与建交群体交易</label>
        <div class="check"><input type="checkbox" v-model="tradeDiplo" id="trade-diplo" /><label for="trade-diplo">+1 环境加值</label></div>
      </div>
      <CheckRoll v-model:dice="tradeDice" v-model:tier="tradeTier" :dc="controlDC" label="桌上掷出的 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.tradeGoods" @click="tradeGoods">结算交易</button></div>
    </div>
    <div class="row" style="margin-top: 10px">
      <div class="field"><label>采购</label><select v-model="buyGood"><option v-for="g in GOODS" :key="'bg' + g">{{ g }}</option></select></div>
      <div class="field"><label>大成功另得（非奢侈品）</label><select v-model="buyExtraGood"><option v-for="g in GOODS.filter((x) => x !== '奢侈品')" :key="'bx' + g">{{ g }}</option></select></div>
      <CheckRoll v-model:dice="buyDice" v-model:tier="buyTier" :dc="controlDC" label="桌上掷出的 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.buy" @click="buy">结算采购</button></div>
      <div class="field"><label>下回合额外骰</label><div class="num">{{ state.pendingDice }}</div></div>
    </div>
    <div class="row" style="margin-top: 10px">
      <div class="field"><label>动用国库欠款</label><div class="num">{{ state.debt }}</div></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="!state.debt" @click="repayDebt">用资本投资偿还</button></div>
    </div>

    <details class="more" style="margin-top: 22px">
      <summary>4 管理贸易协定<Hint text="每管理一项花 2 资源点；成功则下个王国回合获得额外资源骰或商品。" /></summary>
      <div class="row" style="margin-top: 8px">
        <div class="field"><label>协定数</label><input type="number" v-model.number="pactCount" /></div>
        <CheckRoll v-model:dice="pactInput" v-model:tier="pactTier" :dc="pactDC" label="桌上掷出的 d20" width="90px" />
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="settled.pact" @click="managePacts">结算并管理</button></div>
      </div>
    </details>

    <p v-if="tradeMsg" style="margin-top: 14px; border-top: 1px solid var(--rule-soft); padding-top: 10px">{{ tradeMsg }}</p>
  </div>

  <!-- 活动 -->
  <div class="panel" v-if="phase === 2">
    <h2>活动结算</h2>
    <div class="row">
      <div class="field">
        <label>类别</label>
        <select v-model="actCat" style="min-width: 110px"><option v-for="c in ACT_CATS" :key="c">{{ c }}</option></select>
      </div>
      <div class="field">
        <label>活动</label>
        <select v-model="actName" style="min-width: 180px"><option v-for="n in actsOf(actCat)" :key="n" :value="n">{{ n }}</option></select>
      </div>
      <div class="field">
        <label>技能 / 属性</label>
        <select v-if="actSkillList.length > 1" v-model="actSkillPick" style="min-width: 170px">
          <option v-for="o in actSkillList" :key="o.skill" :value="o.skill">{{ o.skill }} · {{ o.attr }}</option>
        </select>
        <div v-else class="num muted">{{ actInfo ? actInfo.skill + ' · ' + actInfo.attr : '—' }}</div>
      </div>
      <div class="field"><label>合计调整（含建筑 +{{ actBonus }}）</label><div class="num">{{ actMod >= 0 ? '+' : '' }}{{ actMod }}</div></div>
      <div class="field" v-if="actExtraLabels[0]"><label>{{ actExtraLabels[0] }}</label><input type="number" v-model="actExtra" style="width: 130px" /></div>
      <div class="field" v-if="actExtraLabels[1]"><label>{{ actExtraLabels[1] }}</label><input type="number" v-model="actExtra2" style="width: 110px" /></div>
      <div class="field"><label>DC</label><input type="number" v-model.number="actDC" style="width: 80px" /></div>
      <CheckRoll v-model:dice="actDice" v-model:tier="actTier" :dc="actEffDC" label="桌上掷出的 d20" width="80px" />
      <div class="field"><label>&nbsp;</label><button class="act" @click="resolveActivity">结算活动</button></div>
    </div>
    <div class="row" v-if="actName === '制作奢侈品' || actName === '提供照料' || actName === '渗透' || actName.startsWith('挽回声誉')">
      <div class="field">
        <label>祸患类别</label>
        <select v-model="actRuin"><option v-for="c in RUIN_CATS" :key="'ar' + c">{{ c }}</option></select>
      </div>
      <div class="field" v-if="actName === '提供照料'">
        <label>大失败后果</label>
        <select v-model="actCare"><option>动荡</option><option v-for="c in RUIN_CATS" :key="'ac' + c">{{ c }}</option></select>
      </div>
      <div class="field" v-if="actName === '渗透'">
        <label>渗透目标</label>
        <div class="check"><input type="checkbox" v-model="actSurvey" id="act-survey" /><label for="act-survey">调查王国状况（否则情报由 GM 裁定）</label></div>
      </div>
      <div class="field" v-if="actName === '渗透' && actSurvey">
        <label>大成功选择</label>
        <select v-model="actSurveyChoice"><option>动荡 −1d4</option><option>一项祸患 −1</option></select>
      </div>
      <div class="field" v-if="actName === '雇佣冒险者'">
        <label>持续事件</label>
        <select v-model="actEventPick" style="min-width: 170px"><option value="">选择</option><option v-for="e in state.ongoingEvents" :key="e.name" :value="e.name">{{ e.name }}</option></select>
      </div>
      <div class="field" v-if="actName === '资本投资'">
        <label>大失败选项</label>
        <select v-model="actInvestFail"><option>掷1资源骰获RP并增加等量犯罪</option><option>0 RP 且犯罪 +1</option></select>
      </div>
      <div class="field" v-if="actName.startsWith('挽回声誉')"><label>固定 DC</label><div class="num muted">{{ (controlDC === '—' ? 14 : controlDC) + 2 }}（控制 DC + 2，不受上方 DC 影响）</div></div>
    </div>
    <p class="muted" v-if="actInfo && actInfo.effect">{{ actInfo.effect }}</p>
    <div v-if="actOut" class="notice" :class="{ warn: actOut.includes('【需手动结算】') || actOut.includes('不可用') || actOut.includes('不得') }">{{ actOut }}</div>

    <h2 style="margin-top: 18px">外交活动<span class="muted">（对抗目标群体的谈判 DC）</span></h2>
    <div class="row">
      <div class="field"><label>活动</label><select v-model="diploAct"><option v-for="a in DIPLO_ACTS" :key="a.name">{{ a.name }}</option></select></div>
      <div class="field"><label>目标群体</label><select v-model="diploGroup" style="min-width: 160px"><option value="">选择</option><option v-for="g in groups" :key="g.name" :value="g.name">{{ g.name }}{{ g.dc ? '（DC ' + g.dc + '）' : '' }}</option></select></div>
      <div class="field"><label>谈判 DC</label><div class="num">{{ diploDC }}</div></div>
      <div class="field">
        <label>对交战国</label>
        <div class="check" style="padding-top: 7px"><input type="checkbox" v-model="diploWar" id="diploWar" /><label for="diploWar">目标处于战争状态（仅派遣外交使节：−4 且结果恶化一级）</label></div>
      </div>
      <CheckRoll v-model:dice="diploDice" v-model:tier="diploTier" :dc="diploDC" label="桌上掷出的 d20" width="80px" />
      <div class="field"><label>&nbsp;</label><button class="act" @click="resolveDiplo">结算外交活动</button></div>
    </div>
    <p class="muted">{{ diploActInfo.note }}</p>
    <p class="muted" v-if="diploOut">{{ diploOut }}</p>

    <h2 style="margin-top: 22px">1 领导活动<span class="muted">（上限 {{ leaderActivityCap() }} 项<Hint text="首都设有城堡、宫殿或市政厅时每位领导者 3 项，否则 2 项；再减去维持阶段填写的「因未履职放弃的领导活动数」。" />）</span></h2>
    <p class="muted" v-if="capitalAllLeaders" style="color: var(--warn)">本回合已尝试迁都：按规则全部领导活动须用于迁都，故领导活动已用尽。</p>
    <div class="row">
      <div class="field"><label>已用</label><input type="number" v-model.number="acts.leader" /></div>
    </div>

    <h2 style="margin-top: 22px">2 区域活动<span class="muted">（上限 3 项）</span></h2>
    <div class="row">
      <div class="field"><label>已用</label><input type="number" v-model.number="acts.region" /></div>
    </div>

    <h2 style="margin-top: 22px">3 市政活动<span class="muted">（上限 {{ state.settlements * civicPerSettlement() }} 项<Hint text="每座聚落 1 项；有「市政规划」时每座聚落 2 项；在「聚落」页建造或拆除会自动记一次。" />）</span></h2>
    <div class="row">
      <div class="field"><label>已用</label><input type="number" v-model.number="acts.city" /></div>
    </div>

    <details class="more" style="margin-top: 22px">
      <summary>活动记录<span class="muted">　领导 · 区域 · 市政 · 军队</span></summary>
      <div class="field" style="margin-top: 8px"><label>领导活动</label><textarea v-model="state.notesLeaderActs"></textarea></div>
      <div class="field" style="margin-top: 8px"><label>区域活动</label><textarea v-model="state.notesRegionActs"></textarea></div>
      <div class="field" style="margin-top: 8px"><label>市政活动</label><textarea v-model="state.notesCityActs"></textarea></div>
      <div class="field" style="margin-top: 8px"><label>军队活动（战时才有）</label><textarea v-model="state.notesArmyActs"></textarea></div>
    </details>

    <details class="more">
      <summary>手动施加后果<span class="muted">　手动落账：祸患、动荡、属性、商品、资源点、声望</span></summary>
    <div class="row" style="margin-top: 10px">
      <div class="field">
        <label>祸患</label>
        <select v-model="evRuinCat"><option v-for="c in RUIN_CATS" :key="c">{{ c }}</option></select>
        <input type="number" v-model.number="evRuinN" style="width: 56px" />
        <button class="act" @click="applyEventRuin">增加</button>
        <button class="act" @click="settleEventRuin">结算溢出</button>
      </div>
      <div class="field"><label>动荡</label><input type="number" v-model.number="evUnrest" style="width: 64px" /><button class="act" @click="applyEventUnrest">施加</button></div>
    </div>
    <div class="row">
      <div class="field">
        <label>属性</label>
        <select v-model="evAttr"><option v-for="a in ATTRS" :key="a">{{ a }}</option></select>
        <input type="number" v-model.number="evAttrN" style="width: 64px" /><button class="act" @click="applyEventAttr">施加</button>
      </div>
      <div class="field">
        <label>商品</label>
        <select v-model="evGood"><option v-for="g in GOODS" :key="g">{{ g }}</option></select>
        <input type="number" v-model.number="evGoodN" style="width: 64px" /><button class="act" @click="applyEventGood">施加</button>
      </div>
      <div class="field"><label>资源点</label><input type="number" v-model.number="evRp" style="width: 70px" /><button class="act" @click="applyEventRp">施加</button></div>
      <div class="field"><label>声望/恶名</label><input type="number" v-model.number="evFame" style="width: 64px" /><button class="act" @click="applyEventFame">施加</button></div>
    </div>
    <p class="muted" v-if="evOut">{{ evOut }}</p>
    </details>
  </div>

  <!-- 事件 -->
  <div class="panel" v-if="phase === 3">
    <h2>1 检定随机事件<span class="muted">（当前 DC {{ state.eventDC }}）<Hint text="桌上掷 d20 达到或超过 DC 即触发随机事件；未触发则下回合 DC 降 5，触发后重置为 16。触发时按「随机王国事件表」的 d% 权重抽取（非等概率），请在桌上掷 d100 后录入。" /></span></h2>
    <div class="row" style="margin-bottom: 10px">
      <div class="field">
        <label>抽取范围</label>
        <select v-model="evFilter">
          <option>全部</option><option>-1</option><option>+0</option><option>+1</option><option>+2</option>
        </select>
      </div>
      <div class="field"><label>候选数</label><div class="num">{{ evPool.length }}</div></div>
      <CheckRoll v-model:dice="evInput" v-model:tier="evTier" :dc="state.eventDC" flat label="桌上掷出的 d20" width="90px" />
      <div class="field"><label>桌上掷出的 d100（触发时用）</label><input type="number" min="1" max="100" v-model="evD100" style="width: 90px" /></div>
      <div class="field" v-if="state.divination && state.divination.pick === 2"><label>第二次 d100（占卜）</label><input type="number" min="1" max="100" v-model="evD100b" style="width: 90px" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="checkEvent">结算检定</button></div>
    </div>
    <p class="muted" v-if="state.divination">占卜效果：{{ state.divination.must ? '本回合必定发生一次随机事件；' : '' }}{{ state.divination.pick === 2 ? `掷两次由${state.divination.chooser === 'player' ? '你' : 'GM'}选择其一；` : '' }}{{ state.divination.bonus ? `解决该事件的检定 +${state.divination.bonus}。` : '' }}</p>
    <p class="muted" v-if="eventRoll && eventRoll.err">{{ eventRoll.err }}</p>
    <p v-else-if="eventRoll" style="margin-top: 10px">
      <template v-if="eventRoll.mouse">{{ eventRoll.label }}</template>
      <template v-else>掷出 <b class="num">{{ eventRoll.r }}</b></template>
      · {{ eventRoll.ok ? '触发事件' : '本回合无事' }}
    </p>
    <div v-if="evChoices.length" class="notice" style="margin-top: 12px">
      <p style="margin-bottom: 6px">占卜：本回合掷两次，由{{ state.divination && state.divination.chooser === 'player' ? '你' : 'GM' }}选择其一发生。</p>
      <div class="row">
        <div class="field" v-for="(e, i) in evChoices" :key="'ec' + i">
          <label>{{ e.名称 }}（调整值 {{ e.调整值 }}）</label>
          <button class="act" @click="chooseEvent(e)">选它</button>
        </div>
      </div>
    </div>
    <div v-if="drawn" style="margin-top: 12px">
      <h2>{{ drawn.名称 }}<span class="muted"> · 调整值 {{ drawn.调整值 }} · {{ drawn.特质 }}</span></h2>
      <p class="muted">事件等级 {{ eventDCOf(drawn).level }} · 解决 DC <b class="num">{{ eventDCOf(drawn).dc }}</b>（控制 DC + 调整值 {{ eventDCOf(drawn).adj }}）</p>
      <p class="prose" style="margin-bottom: 6px">{{ drawn.事件 }}</p>
      <p class="muted" v-if="drawn.地点">地点：{{ drawn.地点 }}</p>
      <p class="muted" v-if="drawn.王国技能">适用：{{ drawn.王国技能 }}</p>
      <p class="muted" v-if="drawn.解决">解决：{{ drawn.解决 }}</p>
      <p class="muted" v-if="drawn.特殊">特殊：{{ drawn.特殊 }}</p>
      <p class="muted" v-if="state.divination && state.divination.bonus">占卜：本回合解决该事件的检定 +{{ state.divination.bonus }}。</p>
      <p class="muted" v-if="state.hiredBonus && state.hiredBonus.name === drawn.名称">雇佣冒险者：解决该事件时 +{{ state.hiredBonus.value }} 环境加值。</p>
      <div v-if="drawn.结果" style="margin-top: 8px">
        <p class="muted" style="margin-bottom: 2px"><b>大成功</b>：{{ drawn.结果.大成功 }}</p>
        <p class="muted" style="margin-bottom: 2px"><b>成功</b>：{{ drawn.结果.成功 }}</p>
        <p class="muted" style="margin-bottom: 2px"><b>失败</b>：{{ drawn.结果.失败 }}</p>
        <p class="muted" style="margin-bottom: 2px"><b>大失败</b>：{{ drawn.结果.大失败 }}</p>
      </div>
      <button class="act" v-if="isSustained(drawn)" style="margin-top: 6px" @click="addOngoing">加入进行中事件</button>
    </div>

    <div v-if="state.ongoingEvents && state.ongoingEvents.length" style="margin-top: 16px">
      <p style="font-weight: 600">进行中的事件</p>
      <table>
        <thead><tr><th style="width: 160px">事件</th><th style="width: 170px">适用</th><th>解决条件 / 特殊</th><th style="width: 80px">　</th></tr></thead>
        <tbody>
          <tr v-for="(e, i) in state.ongoingEvents" :key="i">
            <td>{{ e.name }}</td>
            <td class="muted">{{ e.skill || '—' }}</td>
            <td class="muted">{{ e.resolve || e.special || '—' }}</td>
            <td><button class="act" @click="resolveOngoing(i)">已解决</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <details class="more" style="margin-top: 22px">
      <summary>剧情 / 条件驱动事件<span class="muted">　不走随机检定，直接指定</span><Hint text="由其他规则或剧情引出的事件（如开垦大失败→作物歉收、灌溉大失败→瘟疫、放弃六角格失败→擅占者、事件连锁→世仇、请求外援大成功→外交示好／名人来访）在此直接指定发生，随后会显示该事件的完整卡片与 DC。" /></summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>事件</label>
          <select v-model="forceEventName" style="min-width: 200px">
            <option value="">选择事件</option>
            <option v-for="e in events" :key="e.名称" :value="e.名称">{{ e.名称 }}（{{ e.调整值 }}）</option>
          </select>
        </div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="forceEvent">强制发生</button></div>
        <div class="field"><label>上周事件</label><div class="num muted">{{ state.lastEvent || '—' }}</div></div>
      </div>
    </details>

    <details class="more" style="margin-top: 22px">
      <summary>添加持续效果<span class="muted">　如「到下个王国回合结束前，基于忠诚 +2」</span><Hint text="记录跨回合生效的环境加值与减值：范围选属性会并入对应关键属性的王国检定，选「资源骰」会直接改变每回合的资源骰数量。以回合区间判定，过期自动失效。" /></summary>
      <div class="row" style="margin-top: 8px">
        <div class="field"><label>范围</label><select v-model="effScope"><option v-for="s in EFFECT_SCOPES" :key="s">{{ s }}</option></select></div>
        <div class="field"><label>数值（可负）</label><input type="number" v-model.number="effValue" style="width: 80px" /></div>
        <div class="field"><label>起始回合</label><input type="number" v-model.number="effFrom" style="width: 70px" /></div>
        <div class="field"><label>结束回合</label><input type="number" v-model.number="effUntil" style="width: 70px" /></div>
        <div class="field"><label>说明</label><input v-model="effLabel" placeholder="如 渗透大失败" style="width: 150px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="addEffect">添加效果</button></div>
      </div>
    </details>
    <table v-if="(state.tempEffects || []).length" style="margin-top: 12px">
      <thead><tr><th>说明</th><th style="width: 120px">范围</th><th style="width: 70px">数值</th><th style="width: 130px">生效回合</th><th style="width: 70px">　</th></tr></thead>
      <tbody>
        <tr v-for="e in state.tempEffects" :key="e.id">
          <td>{{ e.label || '—' }}</td>
          <td class="muted">{{ e.scope }}</td>
          <td class="num">{{ e.value >= 0 ? '+' : '' }}{{ e.value }}</td>
          <td class="muted">{{ e.fromTurn ?? 0 }} – {{ e.untilTurn ?? '∞' }}<span v-if="state.turn >= (e.fromTurn ?? 0) && state.turn <= (e.untilTurn ?? 99999)" class="tag" style="margin-left: 6px">生效中</span></td>
          <td><button class="act" @click="dropTempEffect(e.id)">删除</button></td>
        </tr>
      </tbody>
    </table>
    <p class="muted" v-else>无持续效果。</p>

    <h2 style="margin-top: 22px">2 事件结算</h2>
    <div class="field"><label>结果</label><textarea v-model="state.notesEvent"></textarea></div>

    <details class="more">
      <summary>手动施加后果<span class="muted">　手动落账：祸患、动荡、属性、商品、资源点</span></summary>
    <div class="row" style="margin-top: 10px">
      <div class="field">
        <label>祸患</label>
        <select v-model="evRuinCat"><option v-for="c in RUIN_CATS" :key="c">{{ c }}</option></select>
        <input type="number" min="1" v-model.number="evRuinN" style="width: 56px" />
        <button class="act" @click="applyEventRuin">增加</button>
        <button class="act" @click="settleEventRuin">结算溢出</button>
      </div>
      <div class="field"><label>动荡</label><input type="number" v-model.number="evUnrest" style="width: 64px" /><button class="act" @click="applyEventUnrest">施加</button></div>
    </div>
    <div class="row">
      <div class="field">
        <label>属性</label>
        <select v-model="evAttr"><option v-for="a in ATTRS" :key="a">{{ a }}</option></select>
        <input type="number" v-model.number="evAttrN" style="width: 64px" /><button class="act" @click="applyEventAttr">施加</button>
      </div>
      <div class="field">
        <label>商品</label>
        <select v-model="evGood"><option v-for="g in GOODS" :key="g">{{ g }}</option></select>
        <input type="number" v-model.number="evGoodN" style="width: 64px" /><button class="act" @click="applyEventGood">施加</button>
      </div>
    </div>
    <div class="row">
      <div class="field"><label>资源点</label><input type="number" v-model.number="evRp" style="width: 70px" /><button class="act" @click="applyEventRp">施加</button></div>
    </div>
    <p class="muted" v-if="evOut">{{ evOut }}</p>
    </details>

    <details class="more" style="margin-top: 22px">
      <summary>3 里程碑与升级<span class="muted">　已达成 {{ claimedMilestones }} / {{ MILESTONES.length }}</span></summary>
      <table style="margin-top: 8px">
        <thead><tr><th>里程碑</th><th style="width: 110px">状态</th></tr></thead>
        <tbody>
          <tr v-for="m in MILESTONES" :key="m.key">
            <td>{{ m.label }}</td>
            <td>
              <span class="muted" v-if="state.milestones[m.key]">已达成</span>
              <span class="muted" v-else-if="m.check">自动触发中</span>
              <button v-else class="act" @click="claimMilestone(m)">达成并升级</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="row" style="margin-top: 14px">
        <div class="field"><label>当前等级</label><div class="num">{{ state.level }} / 20</div></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="state.level >= 20" @click="levelUp">手动提升 1 级</button></div>
      </div>
    </details>
  </div>

  <div class="panel">
    <button class="act" @click="endTurn">结束本回合</button>
    <details v-if="state.log?.length" class="more" style="margin-top: 14px">
      <summary>回合记录<span class="muted">　{{ state.log.length }} 条</span></summary>
      <p class="muted" v-for="(l, i) in state.log" :key="i" style="margin: 4px 0 0">{{ l }}</p>
    </details>
  </div>
</template>

<style scoped>
.steps { display: flex; gap: 20px; }
.steps button { appearance: none; border: 0; background: transparent; padding: 0 0 8px; font: inherit; font-size: 14px; color: var(--ink-2); cursor: pointer; border-bottom: 2px solid transparent; }
.steps button.active { color: var(--ink); font-weight: 600; border-bottom-color: var(--ochre); }
.num { font-variant-numeric: tabular-nums; padding-top: 7px; }
.panel h2 { display: flex; justify-content: space-between; }
textarea { min-height: 62px; }
.notice { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--ochre-soft); background: var(--wash-ochre); border-radius: 4px; }
.notice.warn { border-color: var(--warn); background: var(--wash-warn); color: var(--warn); }
</style>
