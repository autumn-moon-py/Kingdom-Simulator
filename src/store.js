import { reactive, watch } from 'vue'
import armiesData from './data/armies.json' with { type: 'json' }
import buildingsData from './data/buildings.json' with { type: 'json' }
import armiesByLevel from './data/armiesByLevel.json' with { type: 'json' }
import roles from './data/roles.json' with { type: 'json' }
import levels from './data/levels.json' with { type: 'json' }
import quests from './data/quests.json' with { type: 'json' }

const KEY = 'kingdom-sim-v1'
const BAK = 'kingdom-sim-v1.bak'           // 上一版自动备份
const BAK_TIME = 'kingdom-sim-v1.bak.time' // 备份写入时间

const ATTRS = ['文化', '经济', '忠诚', '稳定']
const GOODS = ['食物', '木材', '矿石', '石材', '奢侈品']
// 属性 ↔ 祸患类别（文化→腐化、经济→犯罪、稳定→衰败、忠诚→内讧）
const ATTR_RUIN = { 文化: '腐化', 经济: '犯罪', 稳定: '衰败', 忠诚: '内讧' }

function defaults() {
  return {
    name: '失窃之地王国',
    ruleset: 'pf2e',        // 'pf2e' | 'mouse'：鼠鼠模式只改判定录入，不改资源与等级
    mouseBase: 0,           // 鼠鼠检定换算用的基准加值（检定转换.md，默认 0）
    level: 1,
    hexCount: 1,
    turn: 1,
    attributes: { 文化: 10, 经济: 10, 忠诚: 10, 稳定: 10 },
    treasury: 0,
    goods: { 食物: 0, 木材: 0, 矿石: 0, 石材: 0, 奢侈品: 0 },
    unrest: 0,
    ruin: { 腐化: 0, 犯罪: 0, 衰败: 0, 内讧: 0 },
    ruinThreshold: { 腐化: 10, 犯罪: 10, 衰败: 10, 内讧: 10 },
    ruinPenalty: { 腐化: 0, 犯罪: 0, 衰败: 0, 内讧: 0 },
    fame: 0,
    fameKind: '声望',
    charter: '',
    heartland: '',
    government: '',
    trainedSkills: [],
    proficiencies: {},
    bonusFeat: '',
    selectedFeats: [],
    civilServiceRole: '',
    boostsUsed: 0,
    skillIncreasesUsed: 0,
    ruinThresholdExtra: {},
    ignoreFirstUsed: false,
    dicePenalty: 0,
    questStatus: {},
    questAcked: {},
    questAwarded: {},
    questBuffs: [],
    diplomacy: {},
    worksites: [],
    farmHexes: [],          // 农田以六角格编号列表存档（如 ["GB1","GB2"]）
    // 回合用
    leaders: {},
    invested: [],            // 已任命的 4 个领导角色（建国第 7 步选定；每个王国回合开始可重选）
    founded: false,          // 是否已完成建国流程（用于首次引导）
    founding: {              // 建国向导的中间状态，便于中途刷新后续做
      step: 1,
      charterFree: '',
      govFree: '',
      extraBoosts: ['', ''],
      investedSkills: ['', '', '', ''],
    },
    heartlandHex: '',        // 建国第 3 步选定的腹地六角格
    settlements: 1,
    towns: [],
    armies: 0,
    legions: [],
    opponents: [],
    war: false,
    sustainedEventMod: 0,    // 持续事件带来的「动荡」调整
    eventConsumptionMod: 0,  // 王国事件对「消耗」的调整（独立于动荡）
    rp: 0,
    bonusDice: 0,
    pendingDice: 0,
    debt: 0,
    cultureBonus: 0,
    econBonus: 0,
    turnAttrPenalty: {},     // 本回合属性环境减值（如动用国库失败使忠诚/经济 −1），回合结束清空
    lastUsed: {},            // 各活动最近一次的回合号（用于「上回合曾做某事」类规则）
    eventDC: 16,
    lastEvent: '',
    ongoingEvents: [],
    milestones: {},
    marks: {},
    log: [],
    firstBuild: {},          // 建筑「首次建造」类效果的记账：{ 名称: { ever, turn, towns } }
    // 地图与格子
    hexClaimed: {},
    hexNotes: {},
    pins: {},
    hexRoads: {},            // 已修筑道路的六角格
    hexFortified: {},        // 已设防的六角格
    hexIrrigated: {},        // 已灌溉的六角格
    fortifications: [],      // 战争遭遇中的防御工事
    lastCapitalMove: 0,      // 上次迁都成功的回合（至少 3 个王国回合内不能再次迁都）
    capitalAttemptTurn: 0,   // 本回合是否尝试过迁都（需求：所有领导者把全部领导活动用于此项）
    leaderSkip: 0,           // 本回合因领导者未投入一周休整而放弃的领导活动数
    leaderAbsent: {},        // 本回合标记为「未履职」的领导角色（按空缺惩罚处理）
    armyActs: {},            // 军队活动记账：{ 军队 id: 回合号 }
    claimLog: { turn: 0, count: 0 }, // 本回合已尝试占据六角格的次数
    pendingBuilds: [],       // 已付费但建造失败的建筑，下回合可免费续建
    tempEffects: [],         // 跨回合持续效果（如「到下个王国回合结束前，基于忠诚的检定 +2」）
    divination: null,        // 占卜：本回合随机事件抽取与解决检定的特殊处理
    boon: null,              // 超自然／创造性解法：本回合一次「重掷或取优」的好处
    hiredBlocked: {},        // 雇佣冒险者：已被大失败封死的持续事件名
    hiredCost2: {},          // 雇佣冒险者：失败后成本升至 2 颗资源骰的持续事件名
    hiredBonus: null,        // 雇佣冒险者成功：下个事件阶段解决该事件的 +2 环境加值
    activityBoon: 0,         // 休整放松带来的、作用于「下一项领导活动」的环境加值
    pendingFame: 0,          // 到下个王国回合开始时额外获得的声望/恶名点
    // 本回合已用活动数；放 state 里才不会切页签就清零，聚落页建建筑也能记进市政活动
    acts: { leader: 0, region: 0, city: 0 },
  }
}

// 补齐军队的结构化状态字段；旧存档只有一个 state 枚举，据此折算到动摇/疲惫/溃败
function withStatus(a, oldState) {
  if (a.shaken === undefined) {
    a.shaken = oldState === '动摇' ? 1 : 0
    a.fatigued = oldState === '疲惫' ? 1 : 0
    a.routed = oldState === '溃败'
  }
  a.far = a.far === true
  if (!Array.isArray(a.engagedWith)) a.engagedWith = []
  if (typeof a.trapped !== 'number') a.trapped = 0
  a.flanked = a.flanked === true
  a.fortified = a.fortified === true
  a.guarded = a.guarded || 0
  a.offBoard = a.offBoard === true
  a.actionsUsed = a.actionsUsed || 0
  a.ammoUsed = a.ammoUsed || 0
  if (!Array.isArray(a.tactics)) a.tactics = []
  if (!Array.isArray(a.gear)) a.gear = []
  a.pcLead = a.pcLead === true
  a.initBonus = a.initBonus || 0
  a.attackCount = a.attackCount || 0
  a.destroyed = a.destroyed === true
  a.misplaced = a.misplaced === true
  a.efficient = a.efficient === true
  if (typeof a.location !== 'string') a.location = ''
  delete a.state
  return a
}

// 旧存档里的军团只存了展示值；补上 armyKey 与基准值，使其能随等级派生
function migrateLegion(l) {
  if (l.armyKey) return withStatus(l, l.state)
  const a = armiesData.find((x) => x.name === l.name)
  return withStatus({
    id: l.id || Date.now().toString(36),
    armyKey: l.name, name: l.name, type: l.type || '',
    level: l.level || 1, baseLevel: a ? a.level : (l.level || 1),
    hpMax: l.hpMax, hp: l.hp, rt: l.rt === undefined ? null : l.rt,
    scout0: a ? a.scout : (l.scout || ''), ac0: a ? a.ac : (l.ac || ''),
    maneuver0: a ? a.maneuver : (l.maneuver || ''), morale0: a ? a.morale : (l.morale || ''),
    melee0: a ? a.melee : (l.melee || ''), ranged0: a ? a.ranged : (l.ranged || ''),
    note: l.note || '',
  }, l.state)
}

// 敌军与军团同构：优先用兵种数据块派生；自定义敌军则保留手填的 *0 字段（baseLevel 为空 → 不随级派生）
function migrateOpponent(o) {
  if (o.armyKey !== undefined) return withStatus(o, o.state)
  const a = armiesData.find((x) => x.name === o.name)
  return withStatus({
    id: o.id || Date.now().toString(36),
    armyKey: a ? a.name : '', name: o.name || '敌军', type: '',
    level: a ? a.level : null, baseLevel: a ? a.level : null,
    hpMax: o.hpMax, hp: o.hp, rt: o.rt === undefined ? null : o.rt,
    scout0: a ? a.scout : '', ac0: a ? a.ac : (o.ac || ''),
    maneuver0: a ? a.maneuver : '', morale0: a ? a.morale : (o.morale || ''),
    melee0: a ? a.melee : '', ranged0: a ? a.ranged : '',
    note: '',
  }, o.state)
}

// 把一份已解析的存档合并到当前默认结构上，补齐缺失字段并迁移旧格式
function mergeSaved(saved) {
  const base = defaults()
  return {
    ...base,
    ...saved,
    attributes: { ...base.attributes, ...(saved.attributes || {}) },
    goods: { ...base.goods, ...(saved.goods || {}) },
    ruin: { ...base.ruin, ...(saved.ruin || {}) },
    ruinThreshold: { ...base.ruinThreshold, ...(saved.ruinThreshold || {}) },
    ruinPenalty: { ...base.ruinPenalty, ...(saved.ruinPenalty || {}) },
    trainedSkills: saved.trainedSkills || [],
    proficiencies: saved.proficiencies || {},
    selectedFeats: saved.selectedFeats || [],
    civilServiceRole: saved.civilServiceRole || '',
    founding: { ...base.founding, ...(saved.founding || {}) },
    ruinThresholdExtra: saved.ruinThresholdExtra || {},
    questStatus: saved.questStatus || {},
    questAcked: saved.questAcked || {},
    questAwarded: saved.questAwarded || {},
    questBuffs: saved.questBuffs || [],
    diplomacy: saved.diplomacy || {},
    worksites: saved.worksites || [],
    lastUsed: saved.lastUsed || {},
    farmHexes: Array.isArray(saved.farmHexes) ? saved.farmHexes : [],
    leaders: saved.leaders || {},
    towns: saved.towns || [],
    legions: (saved.legions || []).map(migrateLegion),
    opponents: (saved.opponents || []).map(migrateOpponent),
    hexClaimed: saved.hexClaimed || {},
    hexNotes: saved.hexNotes || {},
    pins: saved.pins || {},
    ongoingEvents: saved.ongoingEvents || [],
    milestones: saved.milestones || {},
    marks: saved.marks || {},
    log: saved.log || [],
    firstBuild: saved.firstBuild || {},
    hexRoads: saved.hexRoads || {},
    hexFortified: saved.hexFortified || {},
    hexIrrigated: saved.hexIrrigated || {},
    fortifications: saved.fortifications || [],
    tempEffects: saved.tempEffects || [],
    hiredBlocked: saved.hiredBlocked || {},
    hiredCost2: saved.hiredCost2 || {},
    acts: { leader: 0, region: 0, city: 0, ...(saved.acts || {}) },
    leaderAbsent: saved.leaderAbsent || {},
    armyActs: saved.armyActs || {},
    claimLog: saved.claimLog || { turn: 0, count: 0 },
    pendingBuilds: saved.pendingBuilds || [],
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return mergeSaved(JSON.parse(raw))
  } catch (e) { /* 读取失败就用默认值 */ }
  return defaults()
}

export const state = reactive(load())

// 自动保存：写入前把「上一版」留成一份滚动备份，供出错后回滚
let skipBackupOnce = false
watch(state, () => {
  try {
    if (!skipBackupOnce) {
      const prev = localStorage.getItem(KEY)
      if (prev) { localStorage.setItem(BAK, prev); localStorage.setItem(BAK_TIME, String(Date.now())) }
    }
    skipBackupOnce = false
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch (e) { /* 忽略写入失败 */ }
}, { deep: true })

// 多标签页同步：查询页（query.html）与主页面共用同一份 localStorage。
// 任一页写入后，其他页重读该键，避免两边互相覆盖（重读不再产生新备份）。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return
    try {
      skipBackupOnce = true
      Object.assign(state, mergeSaved(JSON.parse(e.newValue)))
    } catch (err) { /* 忽略跨页同步失败 */ }
  })
}

// 上一版备份的概要（回合/等级/时间），供界面显示
export function backupInfo() {
  try {
    const raw = localStorage.getItem(BAK)
    if (!raw) return null
    const d = JSON.parse(raw)
    return { turn: d.turn, level: d.level, time: Number(localStorage.getItem(BAK_TIME)) || null }
  } catch (e) { return null }
}

// 回滚到上一版备份；回滚本身不会再覆盖备份，因此可以反复尝试
export function restoreBackup() {
  const raw = localStorage.getItem(BAK)
  if (!raw) return false
  try {
    const merged = mergeSaved(JSON.parse(raw))
    skipBackupOnce = true
    Object.assign(state, merged)
    return true
  } catch (e) { return false }
}

// 规模跟随已占据的六角格
watch(() => claimedCount(), (n) => {
  if (n > 0 && n !== state.hexCount) state.hexCount = n
})

// ---- 王国任务与外交（主页面与查询页共用） ----
function questBuildingCount(name) {
  let n = 0
  for (const t of state.towns || []) for (const x of t.lots || []) if (x === name) n++
  return n
}
// 任务的触发条件是否已满足（多个条件之间为「或」）
export function questCondMet(c) {
  if (c.kind === 'level') return state.level >= c.value
  if (c.kind === 'turn') return state.turn >= c.value
  if (c.kind === 'building') return questBuildingCount(c.name) >= (c.count || 1)
  if (c.kind === 'worksite') return (state.worksites || []).some((w) => w.type === c.name)
  if (c.kind === 'hexregion') return Object.keys(state.hexClaimed || {}).some((k) => state.hexClaimed[k] && regionOf(k) === c.code)
  return false
}
export function questReady(t) {
  return (t.trigger || []).length > 0 && t.trigger.some(questCondMet)
}
export function questTriggerText(t) {
  if (!(t.trigger || []).length) return '手动（剧情触发）'
  return t.trigger.map((c) => {
    if (c.kind === 'level') return `等级 ≥ ${c.value}`
    if (c.kind === 'turn') return `第 ${c.value} 个王国回合起`
    if (c.kind === 'building') return `建成 ${c.name}${c.count > 1 ? ' ×' + c.count : ''}`
    if (c.kind === 'worksite') return `建立 ${c.name}`
    if (c.kind === 'hexregion') return `占据 ${c.code} 区域六角格`
    return '?'
  }).join(' 或 ')
}
export function questRewardText(t) {
  const r = t.reward
  if (!r) return '—'
  const head = r.amount ? `${r.amount} ${r.unit || ''}` : (r.kind ? `[${r.kind}]` : '')
  return [head, r.detail].filter(Boolean).join(' ')
}
export const QUEST_STATES = ['未开始', '进行中', '已完成']
export function setQuest(name, v) {
  state.questStatus[name] = v
  if (v === '已完成') pushLog(`王国任务完成：${name}`)
}
export function publishQuest(name) {
  state.questStatus[name] = '进行中'
  state.questAcked = state.questAcked || {}
  state.questAcked[name] = true
  pushLog(`王国任务发布：${name}`)
}
// 应用任务奖励：加值类写入 questBuffs（由 kingdomSkillMod 计入），其余给予手工处理提示
export function applyQuestReward(t) {
  const r = t.reward
  if (!r) return
  const n = Number((String(r.duration || '').match(/(\d+)\s*个王国回合/) || [])[1] || 3)
  if (r.kind === '加值') {
    state.questBuffs = state.questBuffs || []
    state.questBuffs.push({
      from: t.name, skill: r.skill, attr: r.attr, bonus: r.bonus,
      untilTurn: state.turn + n - 1, note: r.detail,
    })
    pushLog(`任务奖励已应用：${t.name} → ${r.skill || r.attr} +${r.bonus}（至第 ${state.turn + n - 1} 回合）`)
  } else {
    pushLog(`任务奖励（需手工处理）：${t.name} → ${[r.amount ? r.amount + (r.unit || '') : '', r.detail].filter(Boolean).join(' ')}`)
  }
  state.questAwarded = state.questAwarded || {}
  state.questAwarded[t.name] = true
}
// 可发布的任务：触发条件已满足、尚未发布、也未被忽略
export function questsReady() {
  return quests.filter((t) => questReady(t) &&
    !(state.questAcked && state.questAcked[t.name]) &&
    (state.questStatus[t.name] || '未开始') === '未开始')
}
export function toggleDip(name) {
  const now = !state.diplomacy[name]
  state.diplomacy[name] = now
  if (now) pushLog(`与「${name}」建立外交关系`)
}

export { ATTRS, GOODS }

// 鼠鼠模式：判定由桌上 2d6/3d6 产生，界面只录结果档
export function isMouse() {
  return state.ruleset === 'mouse'
}

export function attrMod(v) {
  return Math.floor((v - 10) / 2)
}

export function diceCount(level, bonus = 0, penalty = 0) {
  return Math.max(0, level + 4 + bonus - penalty)
}

export function rpDiceCount() {
  return Math.max(0, state.level + 4 + state.bonusDice + unrestPenalty(state.unrest) - (state.dicePenalty || 0) + effectSum('资源骰'))
}

export function dieType(hexCount) {
  if (hexCount <= 9) return 'd4'
  if (hexCount <= 24) return 'd6'
  if (hexCount <= 49) return 'd8'
  if (hexCount <= 99) return 'd10'
  return 'd12'
}
export function dieSides(hexCount) {
  return { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12 }[dieType(hexCount)]
}

export function goodsCap(hexCount) {
  if (hexCount <= 9) return 4
  if (hexCount <= 24) return 8
  if (hexCount <= 49) return 12
  if (hexCount <= 99) return 16
  return 20
}

// 商品储存上限：基础值由规模决定；粮仓／铸造厂／木材场／石匠铺／安全仓库各使对应商品上限 +1
export const STORAGE_BUILDINGS = { 食物: '粮仓', 矿石: '铸造厂', 木材: '木材场', 石材: '石匠铺', 奢侈品: '安全仓库' }
export function storageBonus(good) {
  const name = STORAGE_BUILDINGS[good]
  if (!name) return 0
  let n = 0
  for (const t of state.towns || []) {
    for (const x of [...(t.lots || []), ...(t.infra || [])]) if (x === name) n++
  }
  return n
}
export function goodsCapOf(good) {
  return goodsCap(state.hexCount) + storageBonus(good)
}

export function unrestPenalty(unrest) {
  if (unrest >= 15) return -4
  if (unrest >= 10) return -3
  if (unrest >= 5) return -2
  if (unrest >= 1) return -1
  return 0
}

// ---- 检定成功度：PF2 四级 + 自然 20/1 升降一级 ----
export const TIERS = ['大失败', '失败', '成功', '大成功']
export function tierIndex(total, dc, natural) {
  let t
  if (total >= dc + 10) t = 3
  else if (total >= dc) t = 2
  else if (total <= dc - 10) t = 0
  else t = 1
  if (natural === 20) t = Math.min(3, t + 1)
  if (natural === 1) t = Math.max(0, t - 1)
  return t
}
export function tierName(t) { return TIERS[Math.max(0, Math.min(3, t))] }
// 结果恶化 n 级（无政府：所有王国检定结果恶化一级）
export function worsenTier(t, n = 1) { return Math.max(0, t - n) }

// ---- 跨回合持续效果 ----
// 许多王国活动/事件的效果是「到某个王国回合结束前」才生效或持续，例如
// 渗透大失败（到下个回合结束前所有王国检定 −2）、庆祝节日（到下个回合结束前基于忠诚 +1/+2）等。
// 这里统一记录为 tempEffects，由所在的回合区间决定是否生效。
export const EFFECT_SCOPES = ['全部王国检定', '文化', '经济', '忠诚', '稳定', '资源骰']
let effectSeq = 0
export function addTempEffect({ label, scope, value, fromTurn, untilTurn }) {
  state.tempEffects.push({
    id: 'e' + Date.now().toString(36) + (effectSeq++).toString(36),
    label: label || '', scope, value: Number(value) || 0,
    fromTurn: fromTurn ?? state.turn, untilTurn: untilTurn ?? state.turn,
  })
}
export function dropTempEffect(id) {
  state.tempEffects = (state.tempEffects || []).filter((x) => x.id !== id)
}
function activeEffects() {
  return (state.tempEffects || []).filter(
    (e) => state.turn >= (e.fromTurn ?? 0) && state.turn <= (e.untilTurn ?? Infinity),
  )
}
// 指定范围的持续效果合计（不含「全部王国检定」）
export function effectSum(scope) {
  let s = 0
  for (const e of activeEffects()) if (e.scope === scope) s += Number(e.value) || 0
  return s
}
// 作用于某关键属性检定的持续效果合计（含「全部王国检定」）
export function skillEffectSum(attr) {
  let s = effectSum('全部王国检定')
  for (const e of activeEffects()) if (e.scope === attr) s += Number(e.value) || 0
  return s
}
// 回合结束清理：丢弃已过期的持续效果
export function pruneTempEffects() {
  state.tempEffects = (state.tempEffects || []).filter((e) => state.turn <= (e.untilTurn ?? Infinity))
  state.divination = null
  state.boon = null
}
// 是否受训（部分活动要求熟练度至少为受训）
export function isTrained(skill) {
  return (state.proficiencies[skill] || '未受训') !== '未受训'
}
// 王国中是否已有银行（资本投资的门槛：需身处含银行的聚落影响范围内）
export function hasBank() {
  return (state.towns || []).some((t) => [...(t.lots || []), ...(t.infra || [])].includes('银行'))
}
// 王国中是否已有宫殿（15级建筑，只能建在首都）
export function hasPalace() {
  return (state.towns || []).some((t) => [...(t.lots || []), ...(t.infra || [])].includes('宫殿'))
}
// 一旦拥有宫殿，担任「统治者」领导角色的开拓者在结算领导活动的检定上 +3 物品加值（王国规则 宫殿）
export function rulerPalaceBonus() {
  return hasPalace() && (state.leaders || {})['统治者'] ? 3 : 0
}

// ---- 聚落消耗 ----
// 瓦砾地块不算作「建筑」，也不提供住宅
const RUBBLE = '瓦砾'
export function isBuildingLot(v) { return !!v && v !== RUBBLE }
// 聚落类型按「含建筑的街区数」判定（村庄／城镇／城市／大都会）
export function townTypeOf(lots) {
  const l = lots || []
  let blocks = 0
  for (let i = 0; i < l.length; i += 4) if (l.slice(i, i + 4).some(isBuildingLot)) blocks++
  return blocks >= 10 ? '大都会' : blocks >= 5 ? '城市' : blocks >= 2 ? '城镇' : '村庄'
}
// 聚落基础消耗：村庄 1 / 城镇 2 / 城市 4 / 大都会 6（完整机制 聚落类型表）
export const SETTLEMENT_CONSUMPTION = { 村庄: 1, 城镇: 2, 城市: 4, 大都会: 6 }
// 聚落「最高物品加值」：建筑提供的物品加值合计不得超过该值（完整机制 聚落类型表）
export const SETTLEMENT_MAX_BONUS = { 村庄: 1, 城镇: 1, 城市: 2, 大都会: 3 }
// 带「住宅」特质的建筑（用于过度拥挤判定）
const RESIDENTIAL_NAMES = new Set(buildingsData.filter((b) => String(b.特质 || '').includes('住宅')).map((b) => b.名称))
// 过度拥挤：聚落所需住宅地块数 = 含建筑的街区数；住宅不足即为过度拥挤（每回合 +1 动荡）
export function isCrowded(t) {
  const lots = (t && t.lots) || []
  let blocks = 0
  let houses = 0
  for (let i = 0; i < lots.length; i += 4) {
    const block = lots.slice(i, i + 4)
    if (block.some(isBuildingLot)) blocks++
    for (const x of block) if (isBuildingLot(x) && RESIDENTIAL_NAMES.has(x)) houses++
  }
  return houses < blocks
}
export function crowdedCount() {
  return (state.towns || []).filter(isCrowded).length
}
// 建筑「首次建造」类效果的适用范围：任何聚落（全局一次）／每座聚落一次／每个王国回合一次
export function firstBuildScope(text) {
  const t = String(text || '')
  if (/首次在任何聚落/.test(t)) return 'ever'
  if (/每座聚落中首次/.test(t)) return 'settlement'
  if (/每个王国回合|一个王国回合|每回合/.test(t)) return 'turn'
  if (/首次建造/.test(t)) return 'ever'   // 如宫殿「你首次建造宫殿时」
  return null
}
// 判断本次建造是否应结算该建筑的「首次」类效果（并按范围记账）
export function claimFirstBuild(name, scope, townId) {
  const rec = (state.firstBuild[name] = state.firstBuild[name] || {})
  if (scope === 'ever') {
    if (rec.ever) return false
    rec.ever = true
    return true
  }
  if (scope === 'settlement') {
    const towns = (rec.towns = rec.towns || {})
    if (towns[townId]) return false
    towns[townId] = true
    return true
  }
  if (rec.turn === state.turn) return false
  rec.turn = state.turn
  return true
}
// 单座聚落消耗 = 基础消耗 − 建筑减免（磨坊需临水，手工标记 waterMill；下水道系统／牲畜栏各 −1），最低 0
export function settlementConsumption(t) {
  const base = SETTLEMENT_CONSUMPTION[townTypeOf(t && t.lots)] || 1
  const built = [...((t && t.lots) || []), ...((t && t.infra) || [])]
  let cut = 0
  if (t && t.waterMill) cut += 1
  if (built.includes('下水道系统')) cut += 1
  if (built.includes('牲畜栏')) cut += 1
  return Math.max(0, base - cut)
}
// 军队消耗：取 armies.json 的 upkeep；「自给自足」军队不计消耗，且未被击败时再使王国消耗 −1
export function armyUpkeepValue(a) {
  const base = armiesData.find((x) => x.name === a.armyKey) || armiesData.find((x) => x.name === a.name)
  if (!base) return 1
  const s = String(base.upkeep || '0')
  if (/自给自足/.test(s)) return 0
  const m = s.match(/-?\d+/)
  return m ? Number(m[0]) : 0
}
export function armyUpkeep() {
  let sum = 0
  for (const a of state.legions || []) {
    sum += armyUpkeepValue(a)
    const base = armiesData.find((x) => x.name === a.armyKey)
    if (base && /自给自足/.test(String(base.upkeep || '')) && !a.routed && (a.hp || 0) > 0) sum -= 1
    // 就地补给（战术）：维持阶段位于不含聚落的六角格且未驻防时，自身消耗减少 1
    if ((a.tactics || []).includes('就地补给') && a.location && !a.fortified && !(state.towns || []).some((t) => t.hex === a.location)) sum -= 1
  }
  return sum
}
// 王国消耗 = 各聚落消耗总和 + 各军队消耗总和 + 王国事件调整
// 注：农田减免需判定「受聚落影响」，当前不从地图像素推导邻接，故暂不计入（见 UI 提示）。
export function consumptionParts() {
  const settlement = (state.towns || []).reduce((s, t) => s + settlementConsumption(t), 0)
  const army = armyUpkeep()
  const event = state.eventConsumptionMod || 0
  return { settlement, army, event, total: Math.max(0, settlement + army + event) }
}
export function consumption() {
  return consumptionParts().total
}

export function pushLog(text) {
  state.log.unshift(`第 ${state.turn} 回合 · ${text}`)
  if (state.log.length > 60) state.log.length = 60
}

// 计算日志：把每次判定的规则依据、输入、公式、过程、结果打到控制台，
// 便于事后对照原规则复核系统设计是否贴合。tag 用于在控制台里定位。
export function logCalc(tag, d = {}) {
  if (typeof console === 'undefined') return
  try {
    console.groupCollapsed(`[王国规则计算] ${tag}`)
    if (d.rule) console.log('规则依据：' + d.rule)
    if (d.input !== undefined) console.log('输入：', d.input)
    if (d.formula) console.log('公式：' + d.formula)
    if (d.steps !== undefined) console.log('过程：', d.steps)
    if (d.output !== undefined) console.log('结果：', d.output)
    console.groupEnd()
  } catch (e) { /* 控制台不可用时静默 */ }
}

// 规模由已占据的六角格推出（地图页签勾选、或扩张活动纳入）
export function claimedCount() {
  return Object.keys(state.hexClaimed).filter((k) => state.hexClaimed[k]).length
}

// ---- 由「王国进阶能力」与「王国专长」派生出的修正层 ----
// 专长是否已选（政体授予的奖励专长也算）
export function hasFeat(name) {
  return (state.selectedFeats || []).includes(name) || state.bonusFeat === name
}

// 拓张专家（4级）：占据六角格的技能检定 +2 环境加值
export function claimEnvBonus() {
  return state.level >= 4 ? 2 : 0
}

// 市政规划（12级）：指定的一座聚落可作两项市政活动
export function civicPerSettlement() {
  return state.level >= 12 ? 2 : 1
}

// 建造建筑／拆除都属活动阶段第 3 步的市政活动：一次尝试占一个名额（规则按「尝试」计）
export function useCivicActivity() {
  state.acts.city += 1
  return state.acts.city
}

// 区域活动：每回合最多 3 项，跨页签共用同一份计数
export function regionActivitiesLeft() {
  return Math.max(0, 3 - (state.acts.region || 0))
}
export function useRegionActivity() {
  state.acts.region = (state.acts.region || 0) + 1
  return state.acts.region
}

// 军队活动：每支军队每回合 1 次；按回合号记账，切页签不会丢
export function armyActivityUsed(id) {
  return (state.armyActs || {})[id] === state.turn
}
export function useArmyActivity(id) {
  state.armyActs = state.armyActs || {}
  if (armyActivityUsed(id)) return false
  state.armyActs[id] = state.turn
  return true
}

// 占据六角格：1 级每回合 1 次，4 级 2 次，9 级 3 次（独立于区域活动 3 项的总上限）
export function claimsThisTurn() {
  const log = state.claimLog || {}
  return log.turn === state.turn ? (log.count || 0) : 0
}
export function useClaimAttempt() {
  if (claimsThisTurn() >= claimLimit()) return false
  state.claimLog = {
    turn: state.turn,
    count: claimsThisTurn() + 1,
  }
  return true
}

// 举世艳羡（20级）：声望/恶名上限 +1
export function fameCap() {
  return 3 + (state.level >= 20 ? 1 : 0)
}

// 忍耐无政府（专长）：动荡达到 24 才陷入无政府，否则 20
export function anarchyThreshold() {
  return hasFeat('忍耐无政府') ? 24 : 20
}

// 勉强应付（专长）：两项祸患阈值 +1、另一项 +2，记录在 ruinThresholdExtra
export function effectiveRuinThreshold(cat) {
  return (state.ruinThreshold[cat] || 10) + ((state.ruinThresholdExtra || {})[cat] || 0)
}

// 内部交易（专长）：每个王国回合开始时获得 1 个奖励资源骰
export function featBonusDice() {
  return hasFeat('内部交易') ? 1 : 0
}

// 一些专长直接作用于技能检定
export function skillFeatBonus(skillName, attr) {
  let b = 0
  if (hasFeat('实用魔法') && skillName === '魔法') b += 1
  if (hasFeat('鼓舞人心的娱乐') && attr === '文化' && state.unrest >= 1) b += 2
  return b
}

// 举世艳羡（20级）：每回合首次将获得动荡或祸患时忽略
export function canIgnoreFirst() {
  return state.level >= 20 && !state.ignoreFirstUsed
}

// 每回合可做的占据次数：1 级 1 次，4 级 2 次，9 级 3 次
export function claimLimit() {
  if (state.level >= 9) return 3
  if (state.level >= 4) return 2
  return 1
}

// 王国升级时每支军队也升一级：军团等级跟随王国等级，数值由「基础军队按等级」表派生
export function syncLegionLevels() {
  for (const l of state.legions) l.level = state.level
}

// ---- 建筑加值 ----
// 建筑的「物品加值」形如「动用国库+1物品加值」「庆祝节日+2物品加值，以及为平息动荡所作的战争检定+2物品加值」；
// 解析成 { 名称, 加值 }，同一名称取最高值（物品加值不叠加）。
function parseItemBonuses(text) {
  const out = []
  for (let frag of String(text || '').split(/[，,；;]|以及/)) {
    frag = frag.replace(/（见[^）]*）/g, '').replace(/物品加值.*/, '').trim()
    const m = frag.match(/^(.*?)[+＋]\s*(\d+)\s*$/)
    if (!m) continue
    for (const n of m[1].split(/[、,，与和或]/).map((s) => s.replace(/^以及|^并/, '').trim()).filter(Boolean)) {
      out.push({ label: n, bonus: Number(m[2]) })
    }
  }
  return out
}

// 单座聚落内建筑提供的物品加值：同名取最高，且合计不超过该聚落的「最高物品加值」
function settlementBonusMap(t) {
  const cap = SETTLEMENT_MAX_BONUS[townTypeOf(t && t.lots)] || 1
  const agg = {}
  for (const name of [...((t && t.lots) || []), ...((t && t.infra) || [])]) {
    if (!name) continue
    const b = buildingsData.find((x) => x.名称 === name)
    if (!b) continue
    for (const { label, bonus } of parseItemBonuses(b.物品加值)) agg[label] = Math.max(agg[label] || 0, bonus)
  }
  for (const k of Object.keys(agg)) agg[k] = Math.min(agg[k], cap)
  return agg
}

// 汇总已建成建筑提供的物品加值（各聚落内先按「最高物品加值」封顶，再跨聚落取最高）
export function buildingBonusList() {
  const agg = {}
  for (const t of state.towns || []) {
    const local = settlementBonusMap(t)
    for (const [label, bonus] of Object.entries(local)) agg[label] = Math.max(agg[label] || 0, bonus)
  }
  return Object.entries(agg).map(([label, bonus]) => ({ label, bonus })).sort((a, b) => b.bonus - a.bonus)
}

// 查询某项王国活动可用的建筑物品加值（按名称包含匹配）
export function buildingBonus(q) {
  const key = String(q)
  let best = 0
  for (const b of buildingBonusList()) {
    if (b.label.includes(key) || key.includes(b.label)) best = Math.max(best, b.bonus)
  }
  return best
}

// 新建聚落（首都、建立聚落活动、直接添加都走这里；48 地块 = 12 个街区）
export function createTown(name, hex = '') {
  const t = { id: Date.now().toString(36), name, hex, lots: Array(48).fill(null), infra: [], damagedLots: [] }
  state.towns.push(t)
  state.settlements = state.towns.length
  return t
}

// 领导角色的状态加值：只有「已任命」的角色才按其关键属性提供该加值（同一属性不叠加）
// 建国第 7 步选出 4 个任命角色；每个王国回合开始时可以重新选定（王国规则 · 领导角色）
export function leaderStatusBonus(attr) {
  const invested = state.invested || []
  const filled = roles.some((r) => r.attribute === attr && invested.includes(r.name))
  return filled ? (state.level >= 16 ? 3 : state.level >= 8 ? 2 : 1) : 0
}

// ---- 领导角色空缺惩罚 ----
// 未被指派的角色，以及本回合标记为「未履职」的角色，都按空缺处理（王国规则 领导角色）
export function roleVacant(name) {
  // 文官制度：指定的领导角色空缺时不产生空缺惩罚
  if (state.civilServiceRole === name) return false
  if (!(state.leaders || {})[name]) return true
  return !!(state.leaderAbsent || {})[name]
}
export function vacancyMods() {
  const out = { allChecks: 0, controlDC: 0, war: 0, region: 0, attrs: {}, names: [] }
  for (const r of roles) {
    if (!roleVacant(r.name)) continue
    const e = r.vacancyEffect || {}
    out.names.push(r.name)
    out.allChecks += e.allChecks || 0
    out.controlDC += e.controlDC || 0
    out.war += e.war || 0
    out.region += e.region || 0
    if (e.attr) out.attrs[e.attr] = (out.attrs[e.attr] || 0) + (e.attrChecks || 0)
  }
  return out
}
// 战争活动／区域活动的专属空缺减值（-4），由对应活动组件调用
export function vacancyActivityMod(kind) {
  const v = vacancyMods()
  return kind === 'war' ? v.war : kind === 'region' ? v.region : 0
}
// 本回合领导活动上限：每位已指派的领导者 2 项（首都含城堡/宫殿/市政厅时 3 项），
// 再减去因未投入一周休整而主动放弃的活动数
export function leaderActivityCap() {
  const capital = (state.towns || [])[0]
  const seat = capital && [...(capital.lots || []), ...(capital.infra || [])]
    .some((x) => x === '城堡' || x === '宫殿' || x === '市政厅')
  const filled = Object.values(state.leaders || {}).filter(Boolean).length
  return Math.max(0, filled * (seat ? 3 : 2) - (state.leaderSkip || 0))
}

// 王国技能检定调整值 = 属性调整值 + 熟练加值 + 领导状态加值 + 专长加值 − 动荡状态减值 − 对应祸患物品减值
export function kingdomSkillMod(skillName, attr) {
  const PROFB = { 未受训: 0, 受训: 2, 专家: 4, 大师: 6, 传奇: 8 }
  const rank = state.proficiencies[skillName] || '未受训'
  const prof = rank === '未受训' ? 0 : state.level + PROFB[rank]
  const status = leaderStatusBonus(attr)
  const unrest = unrestPenalty(state.unrest)                        // 动荡：状态减值，作用于所有王国检定
  const ruinCat = ATTR_RUIN[attr]
  const ruin = ruinCat ? (state.ruinPenalty[ruinCat] || 0) : 0       // 祸患：物品减值，作用于相关属性检定
  // 任务奖励带来的临时加值（按技能或属性匹配，untilTurn 到期失效）
  const qbuff = (state.questBuffs || [])
    .filter((x) => (x.skill ? x.skill === skillName : x.attr === attr) && (x.untilTurn == null || state.turn <= x.untilTurn))
    .reduce((s, x) => s + (x.bonus || 0), 0)
  // 征税成功 → 本回合基于经济检定 +1 环境加值；改善生活成功 → 本回合基于文化检定 +1（回合结束时重置）
  const turnBonus = attr === '经济' ? (state.econBonus || 0) : attr === '文化' ? (state.cultureBonus || 0) : 0
  const turnPenalty = -((state.turnAttrPenalty || {})[attr] || 0)
  const lasting = skillEffectSum(attr)   // 跨回合持续效果（含「全部王国检定」）
  const vac = vacancyMods()
  const vacancy = vac.allChecks + (vac.attrs[attr] || 0)
  return attrMod(state.attributes[attr] || 10) + prof + status + skillFeatBonus(skillName, attr) + turnBonus + turnPenalty + lasting + unrest - ruin + qbuff + vacancy
}

// 从建筑的「效果」文本里解析可机械化的自动效果（建造时动荡减少等）
export function buildingAutoEffects(text) {
  const t = String(text || '')
  const out = []
  const u = t.match(/动荡减少\s*(\d+)(?!\d*d)/)
  if (u) out.push({ type: 'unrest', value: -Number(u[1]), label: `动荡 ${-Number(u[1])}` })
  else if (/动荡减少\s*\d*d\d+/.test(t)) out.push({ type: 'unrestDice', label: '建造时减少动荡（掷骰，需手工施加）' })
  const ra = t.match(/(腐化|犯罪|衰败|内讧)\s*增加\s*(\d+)/)
  if (ra) out.push({ type: 'ruinAdd', cat: ra[1], value: Number(ra[2]), label: `${ra[1]} +${ra[2]}` })
  const rs = t.match(/祸患减少\s*(\d+)/)
  if (rs) out.push({ type: 'ruinSub', value: Number(rs[1]), label: `祸患 −${rs[1]}` })
  const up = t.match(/消耗减少\s*(\d+)/)
  if (up) out.push({ type: 'upkeep', value: -Number(up[1]), label: `消耗 ${-Number(up[1])}` })
  return out
}

// 六角格编号的区域前缀（如 GB20 → GB），用于任务触发等的区域判定
export function regionOf(code) { const m = String(code).match(/^[A-Z]+/); return m ? m[0] : '' }

// 当前王国等级对应的标准 DC（用于军队自身检定等）
export function armyStandardDC() {
  const row = armiesByLevel.find((r) => r.level === state.level)
  return row ? row.standardDC : 15
}

// 当前王国等级的控制 DC（用于「基础检定」，如基础战争/防御检定、王国活动）
export function kingdomControlDC() {
  const row = levels.find((l) => l.level === state.level)
  return (row ? row.controlDC : 14) + vacancyMods().controlDC
}

export function roll(n, sides) {
  const out = []
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * sides))
  return out
}
export function d20() { return 1 + Math.floor(Math.random() * 20) }
export function flatCheck(dc) { const r = d20(); return { roll: r, ok: r >= dc } }

export function resetAll() {
  Object.assign(state, defaults())
}
