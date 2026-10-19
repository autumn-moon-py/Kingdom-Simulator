import test from 'node:test'
import assert from 'node:assert/strict'
import {
  state, tierIndex, tierName, worsenTier, TIERS,
  townTypeOf, settlementConsumption, SETTLEMENT_CONSUMPTION, SETTLEMENT_MAX_BONUS,
  armyUpkeepValue, armyUpkeep, consumptionParts, consumption,
  goodsCapOf, storageBonus, goodsCap,
  isCrowded, crowdedCount, firstBuildScope, claimFirstBuild, buildingBonusList,
  addTempEffect, dropTempEffect, effectSum, skillEffectSum, pruneTempEffects, EFFECT_SCOPES,
  rpDiceCount, isTrained, hasBank, hasPalace, rulerPalaceBonus, leaderStatusBonus,
  vacancyMods, roleVacant, kingdomSkillMod, kingdomControlDC, leaderActivityCap,
  useRegionActivity, regionActivitiesLeft, useClaimAttempt, claimsThisTurn,
  useArmyActivity, armyActivityUsed,
} from '../src/store.js'
import { effectiveRT, gearCount, extraWeaponKinds, gearACBonus, unitTypeOf } from '../src/armyStats.js'
import { mouseDC, luckDie, mouseTierOf, MOUSE_TIERS } from '../src/rules.js'
import events from '../src/data/events.json' with { type: 'json' }
import eventWeights from '../src/data/eventWeights.json' with { type: 'json' }

// 造一份空白聚落地块（48 格 = 12 街区）；filled 为要占用（写入「房屋」，唯一 1 格的住宅建筑）的地块下标
function lots(filled = []) {
  const l = Array(48).fill(null)
  for (const i of filled) l[i] = '房屋'
  return l
}
function resetWorld() {
  state.towns = []
  state.legions = []
  state.hexCount = 1
  state.eventConsumptionMod = 0
  state.tempEffects = []
  state.ruinPenalty = { 腐化: 0, 犯罪: 0, 衰败: 0, 内讧: 0 }
}

test('四级成功度：大成功/成功/失败/大失败', () => {
  assert.equal(tierName(tierIndex(24, 14)), '大成功')
  assert.equal(tierName(tierIndex(14, 14)), '成功')
  assert.equal(tierName(tierIndex(13, 14)), '失败')
  assert.equal(tierName(tierIndex(4, 14)), '大失败')
  assert.deepEqual(TIERS, ['大失败', '失败', '成功', '大成功'])
})

test('自然 20 提升一级、自然 1 降低一级，且不越界', () => {
  assert.equal(tierIndex(5, 50, 20), 1)      // 大失败 → 失败
  assert.equal(tierIndex(24, 14, 1), 2)      // 大成功 → 成功
  assert.equal(tierIndex(0, 0, 20), 3)       // 已是最高，不再超过
  assert.equal(tierIndex(0, 100, 1), 0)      // 已是最低，不再降低
})

test('结果恶化：无政府使结果降一级且不低于大失败', () => {
  assert.equal(worsenTier(3), 2)
  assert.equal(worsenTier(0), 0)
  assert.equal(worsenTier(2, 2), 0)
})

test('鼠鼠检定换算：PF DC → 2d6 DC', () => {
  const map = {
    1: 2, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 4,
    10: 5, 11: 5, 12: 5, 13: 6, 14: 6, 15: 6, 16: 7, 17: 7,
    18: 8, 19: 8, 20: 9, 21: 10, 22: 10, 23: 10, 24: 10, 25: 12,
  }
  for (const [dc, k] of Object.entries(map)) {
    assert.equal(mouseDC(Number(dc)), k, `PF DC ${dc}`)
  }
  assert.equal(mouseDC(30), 12)
})

test('鼠鼠检定换算：基准加值先减再查表', () => {
  assert.equal(mouseDC(14, 3), 5)   // T = 11 → 5
  assert.equal(mouseDC(14, 0), 6)
})

test('平值检定 → 幸运骰 X-in-6', () => {
  assert.equal(luckDie(5), 5)
  assert.equal(luckDie(10), 4)
  assert.equal(luckDie(11), 3)
  assert.equal(luckDie(16), 2)
  assert.equal(luckDie(20), 1)
})

test('鼠鼠结果档可映射为四级成功度', () => {
  assert.deepEqual(MOUSE_TIERS, ['大失败', '失败', '成功', '大成功'])
  assert.equal(mouseTierOf('大成功'), 3)
  assert.equal(mouseTierOf('成功'), 2)
  assert.equal(mouseTierOf('失败'), 1)
  assert.equal(mouseTierOf('大失败'), 0)
  assert.equal(mouseTierOf(''), -1)
})

test('聚落类型按含建筑街区数判定', () => {
  assert.equal(townTypeOf(lots()), '村庄')
  assert.equal(townTypeOf(lots([0, 4])), '城镇')                  // 2 个街区各有建筑
  assert.equal(townTypeOf(lots([0, 4, 8, 12, 16])), '城市')       // 5 个街区
  assert.equal(townTypeOf(lots([0, 4, 8, 12, 16, 20, 24, 28, 32, 36])), '大都会') // 10 个街区
})

test('聚落消耗：基础消耗按类型，建筑可减免且最低 0', () => {
  assert.equal(SETTLEMENT_CONSUMPTION.城市, 4)
  assert.equal(settlementConsumption({ lots: lots([0, 4]) }), 2)                        // 城镇 2
  assert.equal(settlementConsumption({ lots: lots([0, 4]), waterMill: true }), 1)        // 临水磨坊 −1
  assert.equal(settlementConsumption({ lots: lots([0, 4]), infra: ['下水道系统'] }), 1)  // 下水道 −1
  assert.equal(settlementConsumption({ lots: lots([0, 4]), waterMill: true, infra: ['下水道系统', '牲畜栏'] }), 0) // 全减至 0
})

test('军队消耗：取兵种 upkeep，自给自足不计入', () => {
  assert.equal(armyUpkeepValue({ armyKey: '步兵' }), 1)
  assert.equal(armyUpkeepValue({ armyKey: '骑兵' }), 2)
  assert.equal(armyUpkeepValue({ armyKey: '诺门斥候' }), 0)   // 「−1，自给自足」永不计入
  assert.equal(armyUpkeepValue({ name: '未知兵种' }), 1)      // 无数据时按 1
})

test('自给自足军队未被击败时再使王国消耗 −1', () => {
  resetWorld()
  state.legions = [{ armyKey: '诺门斥候', hp: 4, routed: false }]
  assert.equal(armyUpkeep(), -1)
  state.legions = [{ armyKey: '诺门斥候', hp: 4, routed: true }]
  assert.equal(armyUpkeep(), 0)
})

test('王国消耗 = 聚落 + 军队 + 事件调整，且不为负', () => {
  resetWorld()
  state.towns = [{ lots: lots([0, 4]) }]                 // 城镇 2
  state.legions = [{ armyKey: '骑兵', hp: 4 }]           // 骑兵 2
  state.eventConsumptionMod = 1
  assert.equal(consumptionParts().total, 5)
  assert.equal(consumption(), 5)
  resetWorld()
  state.eventConsumptionMod = -9
  assert.equal(consumption(), 0)
})

test('商品储存上限：储存建筑提高对应商品上限', () => {
  resetWorld()
  const base = goodsCap(1)
  state.towns = [{ lots: lots([0]), infra: ['粮仓', '粮仓'] }]
  assert.equal(storageBonus('食物'), 2)
  assert.equal(goodsCapOf('食物'), base + 2)
  assert.equal(goodsCapOf('木材'), base)   // 木材场才加木材
})

test('随机王国事件表权重合计为 100，且覆盖全部事件', () => {
  const sum = Object.values(eventWeights).reduce((a, b) => a + b, 0)
  assert.equal(sum, 100)
  for (const e of events) assert.ok(eventWeights[e.名称] > 0, `事件「${e.名称}」缺少权重`)
  assert.equal(Object.keys(eventWeights).length, events.length)
})

test('过度拥挤：住宅地块数少于含建筑街区数即成立', () => {
  const mk = (entries) => { const l = Array(48).fill(null); for (const [i, v] of Object.entries(entries)) l[i] = v; return l }
  assert.equal(isCrowded({ lots: mk({}) }), false)                            // 无建筑
  assert.equal(isCrowded({ lots: mk({ 0: '杂货铺' }) }), true)                 // 1 街区、非住宅建筑
  assert.equal(isCrowded({ lots: mk({ 0: '房屋' }) }), false)                  // 1 街区、1 住宅
  assert.equal(isCrowded({ lots: mk({ 0: '杂货铺', 4: '房屋' }) }), true)       // 2 街区、仅 1 住宅
  assert.equal(isCrowded({ lots: mk({ 0: '杂货铺', 4: '房屋', 5: '旅店' }) }), false) // 2 街区、2 住宅
  resetWorld()
  state.towns = [{ lots: mk({ 0: '杂货铺' }) }, { lots: mk({ 0: '房屋' }) }]
  assert.equal(crowdedCount(), 1)
})

test('「首次建造」类效果的范围判定与记账', () => {
  assert.equal(firstBuildScope('你首次在任何聚落中建造兵营时，动荡减少1。'), 'ever')
  assert.equal(firstBuildScope('你在每个王国回合中首次建造城堡时，动荡减少1d4。'), 'turn')
  assert.equal(firstBuildScope('你在每座聚落中首次建造石墙时，动荡减少1。'), 'settlement')
  assert.equal(firstBuildScope('下水道系统使该聚落的消耗减少1。'), null)

  resetWorld()
  state.turn = 3
  state.firstBuild = {}
  // ever：只成功一次
  assert.equal(claimFirstBuild('兵营', 'ever', 't1'), true)
  assert.equal(claimFirstBuild('兵营', 'ever', 't2'), false)
  // settlement：每座聚落各一次
  assert.equal(claimFirstBuild('石墙', 'settlement', 't1'), true)
  assert.equal(claimFirstBuild('石墙', 'settlement', 't1'), false)
  assert.equal(claimFirstBuild('石墙', 'settlement', 't2'), true)
  // turn：每回合一次
  assert.equal(claimFirstBuild('城堡', 'turn', 't1'), true)
  assert.equal(claimFirstBuild('城堡', 'turn', 't1'), false)
  state.turn = 4
  assert.equal(claimFirstBuild('城堡', 'turn', 't1'), true)
})

test('瓦砾地块不算建筑、也不提供住宅', () => {
  const mk = (entries) => { const l = Array(48).fill(null); for (const [i, v] of Object.entries(entries)) l[i] = v; return l }
  assert.equal(townTypeOf(mk({ 0: '瓦砾' })), '村庄')                 // 只有瓦砾 → 无建筑街区
  assert.equal(isCrowded(mk({ 0: '瓦砾' })), false)                   // 瓦砾不构成需要住宅的街区
  assert.equal(townTypeOf(mk({ 0: '瓦砾', 4: '房屋' })), '村庄')       // 1 个含建筑街区
  assert.equal(townTypeOf(mk({ 0: '瓦砾', 4: '房屋', 8: '房屋' })), '城镇') // 2 个含建筑街区
})

test('建筑物品加值受聚落「最高物品加值」封顶', () => {
  assert.equal(SETTLEMENT_MAX_BONUS.村庄, 1)
  assert.equal(SETTLEMENT_MAX_BONUS.城市, 2)
  resetWorld()
  // 城市（5 个含建筑街区）内的学院提供「创造性解法 +2」，未超上限
  const city = Array(48).fill(null)
  city[0] = '学院'; city[1] = '学院'
  city[4] = '房屋'; city[8] = '房屋'; city[12] = '房屋'; city[16] = '房屋'
  state.towns = [{ lots: city }]
  assert.equal(townTypeOf(city), '城市')
  const c1 = buildingBonusList().find((x) => x.label.includes('创造性解法'))
  assert.ok(c1 && c1.bonus === 2)
  // 村庄里同样的学院被上限压到 +1
  const village = Array(48).fill(null)
  village[0] = '学院'; village[1] = '学院'
  state.towns = [{ lots: village }]
  assert.equal(townTypeOf(village), '村庄')
  const c2 = buildingBonusList().find((x) => x.label.includes('创造性解法'))
  assert.ok(c2 && c2.bonus === 1)
})

test('跨回合持续效果：按回合区间生效，并入属性检定与资源骰，过期自动清理', () => {
  resetWorld()
  state.turn = 5
  addTempEffect({ label: '庆祝节日', scope: '忠诚', value: 2, fromTurn: 5, untilTurn: 6 })
  assert.equal(effectSum('忠诚'), 2)
  assert.equal(skillEffectSum('忠诚'), 2)
  assert.equal(skillEffectSum('文化'), 0)          // 不作用于其它属性
  state.turn = 7
  assert.equal(effectSum('忠诚'), 0)               // 超出区间即失效
  pruneTempEffects()
  assert.equal(state.tempEffects.length, 0)

  // 「全部王国检定」作用于任意关键属性
  state.turn = 3
  addTempEffect({ label: '渗透大失败', scope: '全部王国检定', value: -2, fromTurn: 3, untilTurn: 4 })
  assert.equal(skillEffectSum('文化'), -2)
  assert.equal(skillEffectSum('经济'), -2)
  assert.equal(effectSum('忠诚'), 0)               // 不进入单属性合计，但会经 skillEffectSum 生效
  assert.ok(EFFECT_SCOPES.includes('全部王国检定'))

  // 资源骰范围直接改变每回合骰数
  resetWorld()
  state.turn = 1
  state.level = 1; state.bonusDice = 0; state.dicePenalty = 0; state.unrest = 0
  const base = rpDiceCount()
  addTempEffect({ label: '节庆失败', scope: '资源骰', value: -4, fromTurn: 1, untilTurn: 2 })
  assert.equal(rpDiceCount(), Math.max(0, base - 4))
  state.tempEffects = []
})

test('就地补给：无聚落格且未驻防时军队消耗 −1', () => {
  resetWorld()
  state.towns = [{ hex: 'GB1', lots: [] }]
  state.legions = [{ armyKey: '步兵', hp: 4, tactics: ['就地补给'], location: 'GB1', fortified: false }]
  assert.equal(armyUpkeep(), 1)     // 该格有聚落 → 不减免
  state.legions = [{ armyKey: '步兵', hp: 4, tactics: ['就地补给'], location: 'GB9', fortified: false }]
  assert.equal(armyUpkeep(), 0)     // 无聚落 → −1
  state.legions = [{ armyKey: '步兵', hp: 4, tactics: ['就地补给'], location: 'GB9', fortified: true }]
  assert.equal(armyUpkeep(), 1)     // 已驻防（获得设防）→ 不减免
  state.legions = [{ armyKey: '步兵', hp: 4, tactics: ['就地补给'], location: '', fortified: false }]
  assert.equal(armyUpkeep(), 1)     // 未记录位置 → 不减免
  state.legions = [{ armyKey: '步兵', hp: 4, tactics: [], location: 'GB9', fortified: false }]
  assert.equal(armyUpkeep(), 1)     // 无该战术
})

test('坚守阵线：溃败阈值等于总生命值的 1/4（向上取整）', () => {
  assert.equal(effectiveRT({ hpMax: 5, rt: 1, tactics: ['坚守阵线'] }), 2)   // ceil(5/4)
  assert.equal(effectiveRT({ hpMax: 8, rt: 2, tactics: ['坚守阵线'] }), 2)
  assert.equal(effectiveRT({ hpMax: 5, rt: 1, tactics: [] }), 1)             // 无战术 → 用兵种 RT
  assert.equal(effectiveRT({ hpMax: 6, rt: null, tactics: [] }), null)
})

test('装备：治疗药水计数、额外武器类型与魔法护甲 AC 加值', () => {
  assert.equal(gearCount({ gear: ['治疗药水', '治疗药水'] }, '治疗药水'), 2)
  assert.equal(gearCount({ gear: [] }, '治疗药水'), 0)
  assert.deepEqual(extraWeaponKinds({ gear: ['额外武器（远程）'] }), ['远程'])
  assert.deepEqual(extraWeaponKinds({ gear: ['魔法护甲'] }), [])
  assert.equal(gearACBonus({ gear: ['上等魔法护甲', '魔法护甲'] }), 3)   // 更强版本覆盖
})

test('资本投资的银行业门槛与受训判定', () => {
  resetWorld()
  assert.equal(hasBank(), false)
  state.towns = [{ hex: 'GB1', lots: ['学院'], infra: ['银行'] }]
  assert.equal(hasBank(), true)
  state.proficiencies = { 艺术: '受训', 贸易: '未受训' }
  assert.equal(isTrained('艺术'), true)
  assert.equal(isTrained('贸易'), false)
})

test('宫殿：只能在首都、首次建造动荡 −10，拥有宫殿时统治者领导检定 +3', () => {
  // 「首次建造」范围：宫殿的「你首次建造宫殿时」按全局一次；大教堂的「每回合你首次建造」按每回合
  assert.equal(firstBuildScope('宫殿只能建在你的首都。你首次建造宫殿时，动荡减少10。'), 'ever')
  assert.equal(firstBuildScope('每回合你首次建造大教堂时，动荡减少4。'), 'turn')
  assert.equal(firstBuildScope('你在每个王国回合中首次建造歌剧院时，动荡减少4。'), 'turn')
  assert.equal(firstBuildScope('你首次在任何聚落中建造兵营时，动荡减少1。'), 'ever')

  resetWorld()
  assert.equal(hasPalace(), false)
  assert.equal(rulerPalaceBonus(), 0)
  // 拥有宫殿但统治者空缺 → 没有 +3
  state.towns = [{ hex: 'GB1', lots: ['宫殿', '宫殿', '宫殿', '宫殿'] }]
  state.leaders = {}
  assert.equal(hasPalace(), true)
  assert.equal(rulerPalaceBonus(), 0)
  // 任命统治者 → +3
  state.leaders = { 统治者: '某人' }
  assert.equal(rulerPalaceBonus(), 3)
  // 迁都后原首都宫殿改为 4 格贵族别院 → 不再有宫殿
  const old = state.towns[0]
  const l = old.lots
  for (let i = 0; i + 3 < l.length; i++) {
    if (l[i] === '宫殿' && l[i + 1] === '宫殿' && l[i + 2] === '宫殿' && l[i + 3] === '宫殿') {
      for (let k = i; k < i + 4; k++) l[k] = '贵族别院'
      break
    }
  }
  assert.equal(hasPalace(), false)
  assert.equal(rulerPalaceBonus(), 0)
})

test('领导角色状态加值：只有「已任命」的角色提供，且同一属性不叠加', () => {
  resetWorld()
  state.level = 1
  state.leaders = { 统治者: '甲', 顾问: '乙', 使者: '丙' }
  state.invested = []
  // 已指派但未任命 → 不给加值（王国规则 第7步：只有四个「授职」的角色提供状态加值）
  assert.equal(leaderStatusBonus('忠诚'), 0)
  assert.equal(leaderStatusBonus('文化'), 0)
  // 任命统治者（关键属性 忠诚）→ 忠诚 +1
  state.invested = ['统治者']
  assert.equal(leaderStatusBonus('忠诚'), 1)
  assert.equal(leaderStatusBonus('文化'), 0)
  // 再任命使者（关键属性同为忠诚）→ 状态加值不叠加，仍为 +1
  state.invested = ['统治者', '使者']
  assert.equal(leaderStatusBonus('忠诚'), 1)
  // 任命顾问（文化）→ 文化 +1
  state.invested = ['统治者', '使者', '顾问']
  assert.equal(leaderStatusBonus('文化'), 1)
  // 资深领导：8 级 +2、16 级 +3
  state.level = 8
  assert.equal(leaderStatusBonus('忠诚'), 2)
  state.level = 16
  assert.equal(leaderStatusBonus('忠诚'), 3)
  state.level = 1
  state.invested = []
  state.leaders = {}
})

// 领导空缺 / 活动记账 / 军队类型：把相关字段恢复成干净状态
function resetKingdom() {
  state.level = 1
  state.turn = 1
  state.leaders = {}
  state.invested = []
  state.leaderAbsent = {}
  state.leaderSkip = 0
  state.acts = { leader: 0, region: 0, city: 0 }
  state.armyActs = {}
  state.claimLog = { turn: 0, count: 0 }
  state.towns = []
  state.attributes = { 文化: 10, 经济: 10, 忠诚: 10, 稳定: 10 }
  state.proficiencies = {}
  state.selectedFeats = []
  state.bonusFeat = ''
  state.civilServiceRole = ''
  state.questBuffs = []
  state.tempEffects = []
  state.turnAttrPenalty = {}
  state.ruin = { 腐化: 0, 犯罪: 0, 衰败: 0, 内讧: 0 }
  state.ruinPenalty = { 腐化: 0, 犯罪: 0, 衰败: 0, 内讧: 0 }
  state.unrest = 0
  state.econBonus = 0
  state.cultureBonus = 0
}

test('领导空缺：8 席全空时四项属性各 −1、全检定 −1、控制 DC +2、战争 −8、区域 −4', () => {
  resetKingdom()
  const v = vacancyMods()
  assert.equal(v.allChecks, -1)
  assert.equal(v.controlDC, 2)
  assert.deepEqual(v.attrs, { 文化: -1, 忠诚: -1, 经济: -1, 稳定: -1 })
  assert.equal(v.war, -8)
  assert.equal(v.region, -4)
  assert.equal(kingdomControlDC(), 16)
  // 农业（稳定）吃到统治者 −1 与总督 −1
  assert.equal(kingdomSkillMod('农业', '稳定'), -2)
})

test('领导空缺：填满角色后归零，标记未履职只惩罚该角色', () => {
  resetKingdom()
  const names = ['统治者', '顾问', '将军', '使者', '大法师', '财务官', '总督', '守备官']
  state.leaders = Object.fromEntries(names.map((n) => [n, '某人']))
  assert.deepEqual(vacancyMods().names, [])
  assert.equal(kingdomControlDC(), 14)
  state.leaderAbsent = { 统治者: true }
  assert.equal(roleVacant('统治者'), true)
  assert.equal(vacancyMods().allChecks, -1)
  assert.equal(vacancyMods().controlDC, 2)
  assert.equal(kingdomControlDC(), 16)
})

test('领导活动上限：8 位领导无市政厅 16 项，有市政厅 24 项，再减主动放弃数', () => {
  resetKingdom()
  const names = ['统治者', '顾问', '将军', '使者', '大法师', '财务官', '总督', '守备官']
  state.leaders = Object.fromEntries(names.map((n) => [n, '某人']))
  assert.equal(leaderActivityCap(), 16)
  state.leaderSkip = 2
  assert.equal(leaderActivityCap(), 14)
  state.leaderSkip = 0
  state.towns = [{ lots: ['市政厅', '房屋', ...Array(46).fill(null)] }]
  assert.equal(leaderActivityCap(), 24)
})

test('区域活动每回合 3 项、军队活动每军 1 次、占据次数按等级封顶', () => {
  resetKingdom()
  assert.equal(regionActivitiesLeft(), 3)
  useRegionActivity()
  assert.equal(regionActivitiesLeft(), 2)

  assert.equal(useArmyActivity('a1'), true)
  assert.equal(useArmyActivity('a1'), false)
  assert.equal(armyActivityUsed('a1'), true)
  assert.equal(useArmyActivity('a2'), true)

  state.turn = 3
  state.level = 1
  assert.equal(useClaimAttempt(), true)
  assert.equal(useClaimAttempt(), false)
  assert.equal(claimsThisTurn(), 1)
})

test('军队类型：基础兵种与特种兵都归到步兵/骑兵/散兵/攻城器械', () => {
  assert.equal(unitTypeOf({ name: '步兵', type: '基础兵种' }), '步兵')
  assert.equal(unitTypeOf({ name: '骑兵', type: '基础兵种' }), '骑兵')
  assert.equal(unitTypeOf({ name: '攻城器械', type: '基础兵种' }), '攻城器械')
  assert.equal(unitTypeOf({ name: '格林格赖普炮手', type: '特种兵' }), '攻城器械')
  assert.equal(unitTypeOf({ name: '蜥蜴人守卫', type: '特种兵' }), '散兵')
  assert.equal(unitTypeOf({ name: '诺门斥候', type: '特种兵' }), '骑兵')
  assert.equal(unitTypeOf({ name: '托克-尼克拉特斥候', type: '特种兵' }), '散兵')
  assert.equal(unitTypeOf({ name: '虎领主狂战士', type: '特种兵' }), '步兵')
})
