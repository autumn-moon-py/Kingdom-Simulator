<script setup>
import { ref, computed } from 'vue'
import { state, pushLog, logCalc, kingdomSkillMod, armyStandardDC, buildingBonus, tierIndex, tierName, kingdomControlDC, useArmyActivity, armyActivityUsed, vacancyActivityMod, isMouse } from '../store.js'
import { mouseTierOf, rollLine, mouseDC } from '../rules.js'
import { statsOf, statusDefaults, signed, num, effectiveRT, unitTypeOf } from '../armyStats.js'
import armies from '../data/armies.json'
import armyGear from '../data/armyGear.json'
import skillsData from '../data/skills.json'
import WarBoard from './WarBoard.vue'
import CheckRoll from './CheckRoll.vue'

const tab = ref('legions')
const q = ref('')

const legionsView = computed(() => state.legions.map((l) => ({ l, s: statsOf(l) })))

const recruitDice = ref('')
const recruitTierPick = ref('')
function canRecruit(a) { return a.level <= state.level }
function recruit(a) {
  if (!canRecruit(a)) { pushLog(`无法组建 ${a.name}：最低等级 ${a.level} 高于王国等级 ${state.level}`); return }
  const mouse = isMouse()
  const d = mouse ? 0 : Number(recruitDice.value)
  if (mouse ? mouseTierOf(recruitTierPick.value) < 0 : !(d >= 1 && d <= 20)) {
    pushLog(mouse ? '征募军队：请先选择鼠鼠检定结果。' : '征募军队：请先填入桌上掷出的 d20（1–20）。')
    return
  }
  const isSpecial = a.type === '特种兵'
  const skill = isSpecial ? '治国术' : '战争'
  const b = buildingBonus('征募军队')
  const mod = mouse ? 0 : kingdomSkillMod(skill, '忠诚') + b
  const dc = num(a.recruitDC) || armyStandardDC()
  const total = mouse ? 0 : d + mod
  let tier
  if (mouse) tier = tierName(mouseTierOf(recruitTierPick.value))
  else if (total >= dc + 10) tier = '大成功'
  else if (total >= dc) tier = '成功'
  else if (total <= dc - 10) tier = '大失败'
  else tier = '失败'
  let result = ''
  if (tier === '大成功' || tier === '成功') {
    const hp = Number(a.hp) || 5
    state.legions.push({
      id: Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36),
      armyKey: a.name, name: a.name, type: a.type || '', unitType: a.unitType || '',
      level: state.level, baseLevel: a.level,
      hpMax: hp, hp, rt: a.rt === null || a.rt === undefined ? null : a.rt,
      scout0: a.scout || '', ac0: a.ac || '', maneuver0: a.maneuver || '', morale0: a.morale || '',
      melee0: a.melee || '', ranged0: a.ranged || '',
      note: '', ...statusDefaults(),
    })
    state.armies = state.legions.length
    if (tier === '大成功') state.legions[state.legions.length - 1].efficient = true
    result = tier === '大成功' ? `征募成功（大成功：该军队处于高效，可立即再尝试一项军队活动，该活动 −5）` : '征募成功'
  } else if (tier === '大失败') {
    state.unrest += 1
    result = '征募失败：动荡 +1，且直到下个王国回合才能再次尝试征募军队'
  } else result = '征募失败'
  logCalc('军团·征募', {
    rule: '征募军队：从平民征募用战争检定、让特种军队效忠用治国检定，对抗该军队征募DC；大成功→征募到且军队高效；成功→征募到；失败→未征募到；大失败→动荡+1且下个王国回合才能再试（王国规则 征募军队 / 军队活动）。d20 由玩家在桌上掷出后录入。',
    input: { 兵种: a.name, 类型: a.type, 适用技能: skill, 技能调整值: kingdomSkillMod(skill, '忠诚'), 建筑加值: b, 征募DC: dc, 王国等级: state.level },
    formula: '检定结果 = d20 + 技能调整值 + 建筑物品加值，对抗征募 DC',
    steps: { 玩家掷出的d20: mouse ? '—' : d, 鼠鼠结果: mouse ? recruitTierPick.value : '—', 检定结果: mouse ? '—' : total },
    output: { 分级: tier, 结果: result, 王国军队数: state.legions.length },
  })
  pushLog(`征募军队：${a.name} → ${tier}（${result}）`)
  recruitDice.value = ''
  recruitTierPick.value = ''
}
function drop(id) {
  const i = state.legions.findIndex((l) => l.id === id)
  if (i < 0) return
  // 解散会连同该军团未转移的装备一起消失，先确认
  if (!confirm(`解散「${state.legions[i].name}」？该军团未转移的装备会一并失去。此操作不可撤销。`)) return
  state.legions.splice(i, 1)
  state.armies = state.legions.length
}
function needMorale(l) {
  const rt = effectiveRT(l)
  return rt !== null && rt !== undefined && l.hp <= rt
}
function bump(l, d) { l.hp = Math.max(0, Math.min(l.hpMax, l.hp + d)) }

const legionChoices = computed(() => {
  const k = q.value.trim()
  return armies.filter((a) => !k || a.name.includes(k))
})

// --- 装备军队（花费结算）---
const gearArmy = ref('')
const gearPiece = ref('')
const gearOut = ref('')
// 把 armyGear 展开成可选档位（魔法护甲/魔法武器各有 3 个等级档）
const gearOptions = computed(() => {
  const out = []
  for (const g of armyGear) {
    if (Array.isArray(g.types) && g.types.length) {
      for (const t of g.types) out.push({ name: t.name, level: t.level, price: t.price, effect: t.effect || '', group: g.name })
    } else {
      out.push({ name: g.name, level: g.level, price: g.price, effect: g.text || '', group: g.name })
    }
  }
  return out
})
const gearArmyObj = computed(() => state.legions.find((l) => l.id === gearArmy.value) || null)
const gearExtraKind = ref('')   // 额外武器：选择配置近战还是远程
const gearDice = ref('')
const gearTierPick = ref('')
const gearSource = ref('购买')  // 购买走贸易检定并花 RP；战利品走战争检定且免费
function priceOf(s) { const m = String(s || '').match(/(\d+)\s*RP/); return m ? Number(m[1]) : 0 }
// 装备所需的最低等级（额外武器/治疗药水为物品1；其余取展开档位的等级）
function gearLevelOf(name) {
  if (/^额外武器/.test(name) || name === '治疗药水') return 1
  const g = gearOptions.value.find((x) => x.name === name)
  return g && g.level != null ? g.level : 1
}
function equipArmy() {
  const a = state.legions.find((l) => l.id === gearArmy.value)
  const g = gearOptions.value.find((x) => x.name === gearPiece.value)
  if (!a || !g) { gearOut.value = '请选择军队与装备。'; return }
  if (g.level != null && a.level != null && a.level < g.level) { gearOut.value = `${g.name} 为 ${g.level} 级装备，高于该军队等级 ${a.level}。`; return }
  if (unitTypeOf(a) === '攻城器械') { gearOut.value = '攻城器械不能装备其他装备（战争机械）。'; return }
  const magic = /魔法/.test(g.name)
  if (magic && gearSource.value === '购买') {
    const rank = state.proficiencies['魔法'] || '未受训'
    if (!['专家', '大师', '传奇'].includes(rank)) { gearOut.value = '购买魔法装备要求王国在魔法技能上至少达到专家熟练度。'; return }
  }
  const mouse = isMouse()
  const gd = mouse ? 0 : Number(gearDice.value)
  if (mouse ? mouseTierOf(gearTierPick.value) < 0 : !(gd >= 1 && gd <= 20)) {
    gearOut.value = mouse ? '请先选择鼠鼠检定结果。' : '请填入桌上掷出的 d20（1–20）。'
    return
  }
  // 先校验，再扣 RP 与军队活动次数，避免校验失败时白扣
  if (g.name === '治疗药水' && (a.gear || []).filter((x) => x === '治疗药水').length >= 3) {
    gearOut.value = '治疗药水一次最多装备 3 份。'; return
  }
  if (g.name === '额外武器') {
    if (!gearExtraKind.value) { gearOut.value = '额外武器需选择配置「近战」还是「远程」。'; return }
    if ((a.gear || []).includes(`额外武器（${gearExtraKind.value}）`)) { gearOut.value = `该军队已配置额外武器（${gearExtraKind.value}）。`; return }
  }
  const cost = gearSource.value === '战利品' ? 0 : priceOf(g.price)
  if (!a.gear) a.gear = []
  // 同类更弱装备被替换时，其花费可从新装备中扣除（王国规则 装备军队）
  const isArmorTier = ['魔法护甲', '高等魔法护甲', '上等魔法护甲'].includes(g.name)
  const isWeaponTier = ['魔法武器', '高等魔法武器', '上等魔法武器'].includes(g.name)
  const refund = isArmorTier ? priceOf(a.gear.find((x) => x.includes('魔法护甲')) || '') : isWeaponTier ? priceOf(a.gear.find((x) => x.includes('魔法武器')) || '') : 0
  const pay = Math.max(0, cost - refund)
  if (pay > state.rp) { gearOut.value = '资源点不足。'; return }
  const alreadyActed = armyActivityUsed(a.id)
  if (alreadyActed && !a.efficient) { gearOut.value = `${a.name} 本回合已经进行过军队活动（每支军队每回合 1 次；只有「高效」可再做第二项）。`; return }
  if (!alreadyActed) useArmyActivity(a.id)
  const isSecond = alreadyActed
  if (isSecond) a.efficient = false
  state.rp -= pay
  // 购买装备走基础贸易检定；分发战利品走基础战争检定且不花 RP
  const skill = gearSource.value === '战利品' ? '战争' : '贸易'
  const attr = skill === '战争' ? '忠诚' : '经济'
  const dc = kingdomControlDC()
  const mod = mouse ? 0 : kingdomSkillMod(skill, attr) + buildingBonus('装备军队') + vacancyActivityMod('war') - (isSecond ? 5 : 0)
  const total = mouse ? 0 : gd + mod
  const tier = mouse ? tierName(mouseTierOf(gearTierPick.value)) : tierName(tierIndex(total, dc, gd))
  const line = rollLine({ mouse, dc, d: gd, mod, total, tier })
  if (tier === '失败' || tier === '大失败') {
    if (tier === '失败') state.rp += pay
    gearOut.value = `装备检定 ${skill}：${line}，装备失败；${tier === '失败' ? `已返还 ${pay} 资源点` : `花费的 ${pay} 资源点不予返还`}`
    logCalc('军队活动·装备军队·失败', {
      rule: '装备军队：购买装备需基础贸易检定，失败返还所花 RP，大失败不返还（王国规则 装备军队）。',
      input: { 军队: a.name, 装备: g.name, 来源: gearSource.value, 技能: skill, 调整值: mod, DC: dc, 已付RP: pay },
      steps: { d20: mouse ? '—' : gd, 鼠鼠结果: mouse ? gearTierPick.value : '—', 检定结果: mouse ? '—' : total },
      output: { 分级: tier, 返还: tier === '失败' ? pay : 0 },
    })
    gearTierPick.value = ''
    pushLog('装备军队失败：' + gearOut.value)
    return
  }
  if (isArmorTier || isWeaponTier) {
    a.gear = a.gear.filter((x) => !(isArmorTier && x.includes('魔法护甲')) && !(isWeaponTier && x.includes('魔法武器')))
    a.gear.push(g.name)
  } else if (g.name === '治疗药水') {
    a.gear.push('治疗药水')
  } else if (g.name === '额外武器') {
    a.gear.push(`额外武器（${gearExtraKind.value}）`)
  } else if (g.name !== '转移装备') {
    a.gear.push(g.name)
  }
  if (tier === '大成功' && !isSecond) a.efficient = true
  gearOut.value = `为「${a.name}」装备 ${g.name === '额外武器' ? `额外武器（${gearExtraKind.value}）` : g.name}（${gearSource.value === '战利品' ? '分发战利品，不花 RP' : `花 ${pay} 资源点${refund ? `，扣抵旧装备 ${refund}` : ''}`}；${line}${isSecond ? '，第二项活动 −5' : ''}${tier === '大成功' && !isSecond ? '，军队变为高效' : ''}）${g.effect ? '；' + g.effect : ''}`
  logCalc('军队活动·装备军队', {
    rule: '装备军队：为军队配置装备，所选装备等级不得高于军队等级；购买走基础贸易检定并花 RP（失败返还、大失败不返还），分发战利品走基础战争检定且免费；魔法装备购买需魔法专家；攻城器械不能装备其他装备；用同类装备替换旧装备时，旧装备的 RP 花费可从新装备花费中扣除。',
    input: { 军队: a.name, 装备: g.name, 来源: gearSource.value, 技能: skill, 调整值: mod, DC: dc, 装备等级: g.level, 价格: g.price, 扣抵: refund },
    output: { 分级: tier, 扣除资源点: pay, 剩余资源点: state.rp, 现有装备: a.gear.slice(), 高效: !!a.efficient },
  })
  gearDice.value = ''
  gearTierPick.value = ''
  pushLog('装备军队：' + gearOut.value)
}

// --- 转移装备（无需活动，但须两军位于同一六角格且接收方等级足以使用）---
const trFrom = ref('')
const trTo = ref('')
const trGear = ref('')
const trOut = ref('')
const trFromObj = computed(() => state.legions.find((l) => l.id === trFrom.value) || null)
const trToObj = computed(() => state.legions.find((l) => l.id === trTo.value) || null)
const trGearList = computed(() => (trFromObj.value ? [...new Set(trFromObj.value.gear || [])] : []))
function transferGear() {
  const a = trFromObj.value
  const b = trToObj.value
  if (!a || !b || a.id === b.id) { trOut.value = '请选择送出与接收两支不同的军队。'; return }
  if (!trGear.value) { trOut.value = '请选择要转移的装备。'; return }
  if (!a.location || a.location !== b.location) { trOut.value = '两支军队必须位于同一六角格（先在两军的「所在六角格」填入相同编号）。'; return }
  const need = gearLevelOf(trGear.value)
  if (b.level != null && b.level < need) { trOut.value = `接收方等级 ${b.level} 不足以使用 ${trGear.value}（需 ${need} 级）。`; return }
  const i = (a.gear || []).indexOf(trGear.value)
  if (i < 0) { trOut.value = '送出方没有该装备。'; return }
  a.gear.splice(i, 1)
  b.gear = [...(b.gear || []), trGear.value]
  trOut.value = `已将「${trGear.value}」从 ${a.name} 转移到 ${b.name}（同格 ${a.location}）。`
  logCalc('军队活动·转移装备', {
    rule: '转移装备：可把装备从一支军队转移到另一支，前提是接收方等级足以使用该装备、且两支军队位于同一六角格；无需花费活动，但必须在线下期间进行（战争规则 军队装备 / 转移装备）',
    input: { 送出方: a.name, 接收方: b.name, 装备: trGear.value, 六角格: a.location, 接收方等级: b.level, 需求等级: need },
    output: { 送出方装备: a.gear.slice(), 接收方装备: b.gear.slice() },
  })
  pushLog('转移装备：' + trOut.value)
}

// --- 军队活动（王国回合的活动阶段执行）---
const armyActs = [
  { key: '训练军队', check: true, skill: '学术', attr: '文化', note: '学术检定对抗军队标准 DC；大成功学会战术并变为高效；成功学会 1 个战术；大失败无收获。' },
  { key: '恢复军队', check: true, skill: '', attr: '', note: '通过基础技能检定移除一种困扰（技能取决于困扰，见下方选择；从击败状态恢复则 DC +5）。大成功减少 2、成功减少 1；大失败动荡 +1，且若恢复的是被击败的军队则它被摧毁。' },
  { key: '驻防军队', check: true, skill: '防御', attr: '稳定', note: '需求：军队与庇护所/聚落/工地同格。庇护所用防御、聚落用政治、工地用工程检定，对抗军队标准 DC（非本国格 DC+5、敌国格 DC+10）。大成功获得设防且消耗降低 2（最低 1），成功获得设防。' },
  { key: '部署军队', check: true, skill: '探索', attr: '经济', note: '探索/航运/魔法检定，移动到目的地。越出王国边界 DC+5、越入敌国边界 DC+10。大成功抵达并变为高效；成功抵达；失败抵达但疲惫 +1（DC 6 平值失败再 HP−1）；大失败未抵达并陷入失散（动荡 +1d4，DC 11 平值失败再 HP−1）。' },
  { key: '进攻奇策', check: true, skill: '谋略', attr: '忠诚', note: '袭击准备：对抗敌军侦察 DC。大成功使本方军队先攻 +2，且由你选定的一支敌军动摇 1；成功使先攻 +2；大失败使敌军先攻 +4。' },
  { key: '解散军队', check: false, skill: '', attr: '', note: '无需检定。军队不再计入王国消耗；解散前可把装备转移给等级足够的同格军队（到「军队装备」页处理）。' },
  { key: '移动军队（记录位置）', check: false, skill: '', attr: '', note: '仅记录军队所在六角格（简化用；正式部署请用「部署军队」）。' },
]
const aaArmy = ref('')
const aaAct = ref('训练军队')
const aaDC = ref(armyStandardDC())
const aaDice = ref('')
const aaTierPick = ref('')
const aaMove = ref('')
const aaOut = ref('')
const aaAffliction = ref('损伤（HP）')
const aaForce = ref(false)      // 强行军
const aaCross = ref('无')       // 越界：无 / 越出王国边界 / 越入敌国边界
// 恢复军队：困扰 → 使用技能
const AFFLICTION_SKILL = { '损伤（HP）': '防御', 动摇: '艺术', 疲惫: '防御', '陷入或受困': '工程', 失散: '探索', 击败: '政治' }
// 王国技能 → 关键属性
const SKILL_ATTR_MAP = Object.fromEntries((skillsData.skills || []).map((s) => [s.name, s.attribute]))
const aaActInfo = computed(() => armyActs.find((a) => a.key === aaAct.value) || armyActs[0])
function aaSelectAct() {
  aaOut.value = ''
  aaDC.value = aaActInfo.value.check ? armyStandardDC() + (aaAct.value === '部署军队' ? (aaCross.value === '越出王国边界' ? 5 : aaCross.value === '越入敌国边界' ? 10 : 0) : 0) : ''
}
function aaRun() {
  const a = state.legions.find((l) => l.id === aaArmy.value)
  const act = aaActInfo.value
  if (!a) { aaOut.value = '请选择军队。'; return }
  // 失散：只能进行恢复
  if (a.misplaced && act.key !== '恢复军队' && act.key !== '解散军队') { aaOut.value = `${a.name} 处于失散：只能进行「恢复军队」活动。`; return }
  if (act.key === '移动军队（记录位置）') {
    a.location = aaMove.value
    aaOut.value = `${a.name} 位置记为 ${a.location || '（空）'}`
    pushLog('军队活动：' + aaOut.value); return
  }
  if (act.key === '解散军队') {
    if (!confirm(`解散「${a.name}」？未转移的装备会一并失去。此操作不可撤销。`)) return
    if (!useArmyActivity(a.id)) { aaOut.value = `${a.name} 本回合已经进行过军队活动。`; return }
    const i = state.legions.findIndex((l) => l.id === a.id)
    if (i >= 0) state.legions.splice(i, 1)
    state.armies = state.legions.length
    aaOut.value = `${a.name} 已解散（不再计入王国消耗；装备若未转移即丢失）`
    pushLog('军队活动：' + aaOut.value); return
  }
  const mouse = isMouse()
  const d = mouse ? 0 : Number(aaDice.value)
  if (mouse ? mouseTierOf(aaTierPick.value) < 0 : !(d >= 1 && d <= 20)) {
    aaOut.value = mouse ? '请先选择鼠鼠检定结果。' : '请填入桌上掷出的 d20（1–20）。'
    return
  }
  // 恢复军队：按困扰决定技能；击败状态 DC +5
  let skill = act.skill, attr = act.attr, dc = Number(aaDC.value), extraNote = ''
  if (act.key === '恢复军队') {
    skill = AFFLICTION_SKILL[aaAffliction.value]; attr = SKILL_ATTR_MAP[skill] || '稳定'
    if (aaAffliction.value === '击败') { dc += 5; extraNote = '（从击败恢复，DC +5）' }
    if (!dc) { aaOut.value = '请填入 DC。'; return }
  } else if (!dc) { aaOut.value = '请填入 DC。'; return }
  const alreadyActed = armyActivityUsed(a.id)
  if (alreadyActed && !a.efficient) { aaOut.value = `${a.name} 本回合已经进行过军队活动（每支军队每回合 1 次；只有「高效」可再做第二项）。`; return }
  if (!alreadyActed) useArmyActivity(a.id)
  let mod = mouse ? 0 : kingdomSkillMod(skill, attr) + vacancyActivityMod('war')
  let forceNote = ''
  if (act.key === '部署军队' && aaForce.value) { if (!mouse) mod += 4; forceNote = '强行军 +4' }
  // 高效：本次检定承受 −5，且消耗高效；第二项活动的结果不能再赋予高效
  let effNote = ''
  const isSecond = alreadyActed
  if (isSecond) { if (!mouse) mod -= 5; effNote = '高效：第二项活动 −5'; a.efficient = false }
  const total = mouse ? 0 : d + mod
  const tier = mouse ? tierName(mouseTierOf(aaTierPick.value)) : tierName(tierIndex(total, dc, d))
  let eff = ''
  if (act.key === '恢复军队') {
    const gain = tier === '大成功' ? 2 : tier === '成功' ? 1 : 0
    const aff = aaAffliction.value
    if (aff === '损伤（HP）') { if (gain) a.hp = Math.min(a.hpMax, a.hp + gain); eff = gain ? `HP +${gain} → ${a.hp}/${a.hpMax}` : '未能恢复' }
    else if (aff === '动摇') { if (gain) a.shaken = Math.max(0, (a.shaken || 0) - gain); eff = gain ? `动摇 −${gain} → ${a.shaken}` : '未能恢复' }
    else if (aff === '疲惫') { if (gain) a.fatigued = Math.max(0, (a.fatigued || 0) - gain); eff = gain ? `疲惫 −${gain} → ${a.fatigued}` : '未能恢复' }
    else if (aff === '陷入或受困') { if (gain) a.trapped = Math.max(0, (a.trapped || 0) - gain); if ((a.trapped || 0) < 4) a.pinned = false; eff = gain ? `受困 −${gain} → ${a.trapped}` : '未能恢复' }
    else if (aff === '失散') { if (tier === '大成功' || tier === '成功') { a.misplaced = false; eff = '已脱离失散（位置由 GM 决定，通常为起点与目的地的中点）' } else eff = '仍处于失散' }
    else if (aff === '击败') {
      if (tier === '大成功' || tier === '成功') { a.hp = Math.max(1, a.hp); eff = `恢复到 ${a.hp} HP，移除击败` }
      else if (tier === '大失败') { a.destroyed = true; a.offBoard = true; eff = '恢复失败：该被击败的军队被摧毁' }
      else eff = '未能恢复'
    }
    if (tier === '大失败' && aff !== '击败') { state.unrest += 1; eff += '；动荡 +1' }
    if (tier === '大失败' && aff === '击败') { state.unrest += 1; eff += '；动荡 +1' }
  } else if (act.key === '训练军队') {
    if (tier === '大成功') { if (!isSecond) a.efficient = true; eff = '可学习 1 个战术' + (isSecond ? '' : '，并变为高效') }
    else if (tier === '成功') eff = '可学习 1 个战术（到「战争遭遇」页添加）'
    else eff = '无收获'
  } else if (act.key === '驻防军队') {
    if (tier === '大成功') { a.fortified = true; eff = '获得设防（直到被部署）；消耗降低 2（最低 1）' }
    else if (tier === '成功') { a.fortified = true; eff = '获得设防（直到被部署）' }
    else eff = '驻防失败'
  } else if (act.key === '部署军队') {
    if (tier === '大成功') { a.location = aaMove.value; if (!isSecond) a.efficient = true; eff = `抵达 ${a.location || '目的地'}${isSecond ? '' : '，并变为高效'}` }
    else if (tier === '成功') { a.location = aaMove.value; eff = `抵达 ${a.location || '目的地'}` }
    else if (tier === '失败') { a.location = aaMove.value; a.fatigued = (a.fatigued || 0) + 1; eff = `抵达 ${a.location || '目的地'}，但疲惫 +1` + (aaForce.value ? '（强行军失败再 +1）' : '') + '；需 DC 6 平值检定，失败 HP −1（手工结算）' }
    else { a.misplaced = true; eff = '未抵达并陷入失散；动荡 +1d4 并需 DC 11 平值检定，失败 HP −1（手工结算）' }
    if (tier === '失败' && aaForce.value) a.fatigued = (a.fatigued || 0) + 1
  } else if (act.key === '进攻奇策') {
    if (tier === '大成功') { a.initBonus = 2; eff = '先攻 +2（已在先攻面板计入），并由你选定一支敌军动摇 +1' }
    else if (tier === '成功') { a.initBonus = 2; eff = '先攻 +2（已在先攻面板计入）' }
    else if (tier === '大失败') eff = '敌军先攻 +4（请在战争遭遇先攻面板为敌军额外加记）'
    else eff = '无事'
  }
  const line = rollLine({ mouse, dc, d, mod, total, tier })
  aaOut.value = `${a.name}·${act.key}${act.key === '恢复军队' ? `（${aaAffliction.value}）` : ''}：${line}${extraNote}；${eff || '无'}${forceNote ? `（${forceNote}）` : ''}${effNote ? `（${effNote}）` : ''}`
  logCalc('军队活动·' + act.key, {
    rule: act.note + '（王国规则 军队活动）。d20 由玩家在桌上掷出后录入。',
    input: { 军队: a.name, 活动: act.key, 困扰: act.key === '恢复军队' ? aaAffliction.value : '—', 适用技能: skill || '无', 技能调整值: mod, 对抗DC: dc, 越界: aaCross.value, 强行军: aaForce.value },
    formula: '检定结果 = d20 + 技能调整值（属性调整值 + 熟练加值 + 状态加值）',
    steps: { 玩家掷出的d20: mouse ? '—' : d, 鼠鼠结果: mouse ? aaTierPick.value : '—', 检定结果: mouse ? '—' : total },
    output: { 分级: tier, 效果: eff || '无' },
  })
  pushLog('军队活动：' + aaOut.value)
  aaDice.value = ''
  aaTierPick.value = ''
}
</script>

<template>
  <div class="panel">
    <h2>军团</h2>
    <nav class="tabs">
      <button :class="{ active: tab === 'legions' }" @click="tab = 'legions'">我的军团</button>
      <button :class="{ active: tab === 'recruit' }" @click="tab = 'recruit'">组建军团</button>
      <button :class="{ active: tab === 'gear' }" @click="tab = 'gear'">军队装备</button>
      <button :class="{ active: tab === 'armyActs' }" @click="tab = 'armyActs'">军队活动</button>
      <button :class="{ active: tab === 'war' }" @click="tab = 'war'">战争遭遇</button>
      <a class="reflink" href="./query.html" target="_blank" rel="noopener">等级表·战术与动作 ↗</a>
    </nav>
  </div>

  <div class="panel" v-if="tab === 'legions'">
    <table v-if="state.legions.length">
      <thead><tr><th>军团</th><th style="width: 44px">等级</th><th style="width: 66px">侦察</th><th style="width: 44px">AC</th><th style="width: 120px">机动／士气</th><th style="width: 150px">近战／远程</th><th style="width: 130px">HP</th><th style="width: 44px">RT</th><th>状态</th><th style="width: 84px">　</th></tr></thead>
      <tbody>
        <tr v-for="row in legionsView" :key="row.l.id">
          <td>{{ row.l.name }}<span class="muted" v-if="row.l.type"> · {{ row.l.type }}</span></td>
          <td class="num">{{ row.l.level }}</td>
          <td class="num">{{ row.s.scout }}</td>
          <td class="num">{{ row.s.ac }}</td>
          <td class="muted">{{ row.s.maneuver }} / {{ row.s.morale }}</td>
          <td class="muted">{{ row.s.melee || '—' }}<br />{{ row.s.ranged || '—' }}</td>
          <td>
            <button class="act mini" @click="bump(row.l, -1)">−</button>
            <span class="num">{{ row.l.hp }}</span>
            <span class="muted"> / {{ row.l.hpMax }}</span>
            <button class="act mini" @click="bump(row.l, 1)">＋</button>
          </td>
          <td class="num">{{ row.l.rt === null ? '—' : row.l.rt }}</td>
          <td>
            <span class="chip" v-if="row.l.routed">溃败</span>
            <span class="chip" v-else-if="row.l.shaken">动摇{{ row.l.shaken }}</span>
            <span class="chip" v-if="row.l.fatigued">疲惫{{ row.l.fatigued }}</span>
            <span class="chip" v-if="row.l.far">远离</span>
            <span class="muted" v-if="!row.l.routed && !row.l.shaken && !row.l.fatigued && !row.l.far">正常</span>
          </td>
          <td><button class="act" @click="drop(row.l.id)">解散</button></td>
        </tr>
      </tbody>
    </table>
    <p class="muted" v-else>还没有军团。到「组建军团」里挑一个。</p>
    <p class="muted" v-if="state.legions.some(needMorale)">有军团的 HP 已到溃败阈值，每轮结束时需掷士气检定（见「战争遭遇」）。</p>
    <p class="muted">数值随王国等级自动派生；当前王国等级 {{ state.level }}。交战、动摇等战场状态在「战争遭遇」里操作。</p>
  </div>

  <div class="panel" v-if="tab === 'recruit'">
    <div class="field" style="margin-bottom: 12px">
      <label>筛选</label>
      <input v-model="q" placeholder="如 步兵、蜥蜴人" style="width: 200px" />
    </div>
    <div class="row" style="margin-bottom: 12px">
      <CheckRoll v-model:dice="recruitDice" v-model:tier="recruitTierPick" :dc="armyStandardDC()" noDc label="桌上掷出的 d20（征募检定）" width="90px" />
      <div class="field"><label>检定口径</label><div class="num muted">基础兵种＝战争；特种兵＝治国术；对抗该兵种征募 DC</div></div>
    </div>
    <table>
      <thead><tr><th style="width: 150px">兵种</th><th style="width: 44px">等级</th><th style="width: 70px">侦察</th><th style="width: 44px">AC</th><th style="width: 120px">机动／士气</th><th style="width: 56px">HP</th><th style="width: 170px">近战／远程</th><th style="width: 90px">征募DC</th><th style="width: 90px">消耗</th><th style="width: 84px">　</th></tr></thead>
      <tbody>
        <template v-for="a in legionChoices" :key="a.name">
          <tr>
            <td>{{ a.name }}<span class="muted"> · {{ a.unitType || a.type }}</span></td>
            <td class="num">{{ a.level }}</td>
            <td class="num">{{ a.scout }}</td>
            <td class="num">{{ a.ac }}</td>
            <td class="muted">{{ a.maneuver }} / {{ a.morale }}</td>
            <td class="num">{{ a.hp }}<span class="muted">（{{ a.rt === null ? '无 RT' : a.rt }}）</span></td>
            <td class="muted">{{ a.melee || '—' }}<br />{{ a.ranged || '—' }}</td>
            <td class="muted">{{ a.recruitDC }}<span v-if="state.ruleset === 'mouse'"> → 2d6 {{ mouseDC(num(a.recruitDC) || armyStandardDC()) }}</span></td>
            <td class="muted">{{ a.upkeep }}</td>
            <td>
              <button class="act" :disabled="!canRecruit(a)" @click="recruit(a)">组建</button>
              <span class="muted" v-if="!canRecruit(a)">等级不足</span>
            </td>
          </tr>
          <tr v-if="a.special || a.extra">
            <td colspan="10" class="muted" style="padding-top: 0">{{ a.special }}{{ a.special && a.extra ? '　' : '' }}{{ a.extra }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>

  <div class="panel" v-if="tab === 'gear'">
    <h2>军队装备</h2>
    <p class="muted">征募时自动配发基础装备。通过「装备军队」活动升级；用同类装备替换旧装备时，旧装备的 RP 花费可从新装备花费中扣除。</p>
    <div class="row" style="margin-bottom: 12px">
      <div class="field"><label>军队</label><select v-model="gearArmy" style="min-width: 160px"><option value="">选择</option><option v-for="l in state.legions" :key="l.id" :value="l.id">{{ l.name }}（{{ l.level }} 级）</option></select></div>
      <div class="field">
        <label>装备<span class="muted" v-if="gearArmyObj">（≤ {{ gearArmyObj.level }} 级）</span></label>
        <select v-model="gearPiece" style="min-width: 220px">
          <option value="">选择</option>
          <option v-for="g in gearOptions" :key="g.name" :value="g.name" :disabled="gearArmyObj && g.level != null && gearArmyObj.level < g.level">{{ g.name }}（{{ g.level != null ? g.level + ' 级，' : '' }}{{ g.price }}）</option>
        </select>
      </div>
      <div class="field" v-if="gearPiece === '额外武器'">
        <label>额外武器类型</label>
        <select v-model="gearExtraKind" style="min-width: 110px"><option value="">选择</option><option>近战</option><option>远程</option></select>
      </div>
      <div class="field">
        <label>来源</label>
        <select v-model="gearSource" style="min-width: 90px"><option>购买</option><option>战利品</option></select>
      </div>
      <CheckRoll v-model:dice="gearDice" v-model:tier="gearTierPick" :dc="kingdomControlDC()" label="桌上掷出的 d20" width="90px" />
      <div class="field"><label>&nbsp;</label><button class="act" @click="equipArmy">结算装备军队</button></div>
    </div>
    <p class="muted" v-if="gearArmyObj">现有装备：{{ (gearArmyObj.gear || []).join('、') || '（无）' }}</p>
    <p class="muted" v-if="gearOut">{{ gearOut }}</p>

    <h2 style="margin-top: 18px">转移装备<span class="muted">（两军同格、接收方等级足够；无需活动）</span></h2>
    <div class="row">
      <div class="field"><label>送出方</label><select v-model="trFrom" style="min-width: 150px"><option value="">选择</option><option v-for="l in state.legions" :key="'tf' + l.id" :value="l.id">{{ l.name }}（{{ l.location || '未定' }}）</option></select></div>
      <div class="field"><label>接收方</label><select v-model="trTo" style="min-width: 150px"><option value="">选择</option><option v-for="l in state.legions" :key="'tt' + l.id" :value="l.id">{{ l.name }}（{{ l.location || '未定' }}）</option></select></div>
      <div class="field">
        <label>装备</label>
        <select v-model="trGear" style="min-width: 180px"><option value="">选择</option><option v-for="g in trGearList" :key="g" :value="g">{{ g }}</option></select>
      </div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="transferGear">转移</button></div>
    </div>
    <p class="muted" v-if="trOut">{{ trOut }}</p>
    <p class="muted">装备条目的完整说明与可选档位见查询页「军队装备」。</p>
  </div>

  <div class="panel" v-if="tab === 'armyActs'">
    <h2>军队活动<span class="muted">（王国回合的活动阶段执行）</span></h2>
    <div class="row">
      <div class="field"><label>军队</label><select v-model="aaArmy" style="min-width: 160px"><option value="">选择</option><option v-for="l in state.legions" :key="l.id" :value="l.id">{{ l.name }}</option></select></div>
      <div class="field"><label>活动</label><select v-model="aaAct" @change="aaSelectAct"><option v-for="a in armyActs" :key="a.key" :value="a.key">{{ a.key }}</option></select></div>
      <div class="field" v-if="aaActInfo.check"><label>DC</label><input type="number" v-model.number="aaDC" style="width: 80px" /></div>
      <CheckRoll v-if="aaActInfo.check" v-model:dice="aaDice" v-model:tier="aaTierPick" :dc="aaDC" label="桌上掷出的 d20" width="80px" />
      <div class="field" v-if="aaAct === '恢复军队'">
        <label>困扰</label>
        <select v-model="aaAffliction"><option>损伤（HP）</option><option>动摇</option><option>疲惫</option><option>陷入或受困</option><option>失散</option><option>击败</option></select>
      </div>
      <div class="field" v-if="aaAct === '部署军队'">
        <label>目的地六角格</label><input v-model="aaMove" placeholder="如 GB1" style="width: 100px" />
      </div>
      <div class="field" v-if="aaAct === '部署军队'">
        <label>越界</label>
        <select v-model="aaCross" @change="aaSelectAct"><option>无</option><option>越出王国边界</option><option>越入敌国边界</option></select>
      </div>
      <div class="field" v-if="aaAct === '部署军队'">
        <label>强行军</label>
        <div class="check"><input type="checkbox" v-model="aaForce" id="aa-force" /><label for="aa-force">+4 环境加值，疲惫 +1（失败 +2）</label></div>
      </div>
      <div class="field" v-if="aaAct === '移动军队（记录位置）'"><label>目标六角格</label><input v-model="aaMove" placeholder="如 GB1" style="width: 100px" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="aaRun">结算活动</button></div>
    </div>
    <p class="muted">{{ aaActInfo.note }}</p>
    <p class="muted" v-if="aaOut">{{ aaOut }}</p>

    <h2 style="margin-top: 20px">军队位置与状态</h2>
    <table v-if="state.legions.length">
      <thead><tr><th>军团</th><th style="width: 130px">所在六角格</th><th style="width: 90px">HP</th><th style="width: 60px">设防</th><th>已学战术</th></tr></thead>
      <tbody>
        <tr v-for="l in state.legions" :key="l.id">
          <td>{{ l.name }}</td>
          <td><input v-model="l.location" style="width: 110px" /></td>
          <td class="num">{{ l.hp }}/{{ l.hpMax }}</td>
          <td>{{ l.fortified ? '是' : '否' }}</td>
          <td class="muted">{{ (l.tactics || []).join('、') || '—' }}</td>
        </tr>
      </tbody>
    </table>
    <p class="muted" v-else>还没有军团。先到「组建军团」建军。</p>
    <p class="muted">装备军队请用「军队装备」页，征募军队请用「组建军团」页。</p>
  </div>

  <WarBoard v-if="tab === 'war'" />
</template>

<style scoped>
.tabs { display: flex; gap: 20px; margin-bottom: 4px; }
.tabs button { appearance: none; border: 0; background: transparent; padding: 0 0 8px; font: inherit; font-size: 14px; color: var(--ink-2); cursor: pointer; border-bottom: 2px solid transparent; }
.tabs button.active { color: var(--ink); font-weight: 600; border-bottom-color: var(--ochre); }
.reflink { margin-left: auto; padding-bottom: 8px; font-size: 13px; color: var(--ink-2); text-decoration: none; }
.reflink:hover { color: var(--ochre); }
.num { font-variant-numeric: tabular-nums; padding: 0 6px; }
.act.mini { padding: 3px 9px; }
button:disabled { color: var(--ink-3); border-color: var(--rule-soft); cursor: not-allowed; }
tr.cur td { background: var(--cover-old); }
select, input { padding: 5px 7px; }
.chip { display: inline-block; font-size: 12px; padding: 1px 6px; margin: 0 6px 2px 0; border: 1px solid var(--rule-soft); border-radius: 3px; background: var(--cover-old); color: var(--ink); }
</style>
