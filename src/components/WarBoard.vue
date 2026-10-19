<script setup>
import { ref, computed } from 'vue'
import { state, pushLog, logCalc, fameCap, kingdomSkillMod, kingdomControlDC, tierIndex, tierName, anarchyThreshold } from '../store.js'
import { statsOf, num, signed, levelRow, statusDefaults, gearACBonus, gearAttackBonus, isDefeated, effectiveRT, gearCount, unitTypeOf } from '../armyStats.js'
import armies from '../data/armies.json'
import tacticsData from '../data/tactics.json'

const round = ref(1)
const sel = ref('')          // 选中的军队 id
const oppKey = ref('')
const oppLevel = ref('')
const oppCustom = ref('')

// ---- 战场地形与天气（影响机动/侦察/远程打击）----
const battleTerrain = ref({ dark: false, difficult: false, dim: false, wind: '无' })
const WIND_PEN = { 无: 0, 强风: 1, 风暴: 2 }
// 碾压（骑兵的固有首个战术）在「对抗范围攻击与精神攻击」时使机动与士气豁免 −1，
// 骑兵专精且等级 ≥12 时忽略该减值。此处用开关表示本次检定是否属于这类豁免。
const saveVsAoe = ref(false)
const allArmies = () => [...state.legions, ...state.opponents].filter((a) => !a.offBoard)
// 地形/天气对某次检定的调整
function terrainMods(a, kind) {
  const t = battleTerrain.value
  const has = (n) => (a.tactics || []).includes(n)
  const darkvision = has('黑暗视觉')
  const lowlight = has('微光视觉') || darkvision
  let mod = 0
  const notes = []
  if (t.dark && kind === '侦察' && !darkvision) { mod -= 4; notes.push('黑暗/浓雾 −4') }
  if (t.difficult && kind === '机动') {
    const amphib = has('两栖') || has('沼泽居民') || has('水行')
    if (!amphib) { mod -= 2; notes.push('困难地形 −2') }
  }
  if (t.dim) {
    if (kind === '侦察' && !lowlight) { mod -= 2; notes.push('微光/降雨 侦察 −2') }
    if (kind === '机动' && !lowlight) { mod += 1; notes.push('微光/降雨 机动 +1') }
  }
  return { mod, notes }
}
// 隐蔽：黑暗/浓雾使所有军队隐蔽；微光/薄雾/降雨使远离的军队隐蔽；黑暗视觉/微光视觉相应免疫
function isConcealed(a) {
  const has = (n) => (a.tactics || []).includes(n)
  const dv = has('黑暗视觉')
  const ll = has('微光视觉') || dv
  const t = battleTerrain.value
  if (t.dark && !dv) return true
  if (t.dim && !ll && a.far) return true
  return false
}
// 风对远程打击的减值；对远离军队翻倍（战争规则 战场地形特征）
function windPenalty(farTarget) {
  const base = WIND_PEN[battleTerrain.value.wind] || 0
  return farTarget ? base * 2 : base
}

// ---- 先攻：各军队一次侦察检定（d20 外部录入），用于排列行动顺序 ----
const initDice = ref({})
function initMod(a) {
  return num(statsOf(a).scout) + ((a.tactics || []).includes('目光锐利') ? 2 : 0) + (a.initBonus || 0)
}
function initTotal(a) {
  const d = Number(initDice.value[a.id])
  if (!(d >= 1 && d <= 20)) return null
  return d + initMod(a)
}
const initOrder = computed(() => {
  return allArmies()
    .map((a) => ({ a, total: initTotal(a) }))
    .filter((x) => x.total !== null)
    .sort((x, y) => y.total - x.total)
})

// ---- 防御工事（战争规则 防御工事数据表）----
const FORT_TYPES = {
  城堡: { ac: 30, hp: 8, cap: 6 },
  主堡: { ac: 25, hp: 5, cap: 4 },
  塔楼: { ac: 20, hp: 2, cap: 1 },
}
const fortType = ref('城堡')
const fortSide = ref('enemy')
function addFort() {
  const t = FORT_TYPES[fortType.value]
  state.fortifications.push({ id: newId(), name: fortType.value, side: fortSide.value, ac: t.ac, hpMax: t.hp, hp: t.hp, cap: t.cap })
  pushLog(`战场上加入防御工事：${fortType.value}（${fortSide.value === 'ally' ? '我方' : '敌方'}，AC ${t.ac}，HP ${t.hp}）`)
}
// 工事被摧毁：同侧所有设防军队失去设防，且动摇 +1
function destroyFort(f) {
  if (f.destroyed) return
  f.destroyed = true
  f.hp = 0
  const side = f.side === 'ally' ? state.legions : state.opponents
  const hit = side.filter((a) => a.fortified)
  for (const a of hit) { a.fortified = false; a.shaken = (a.shaken || 0) + 1 }
  pushLog(`${f.name} 被摧毁：${hit.length} 支设防军队失去设防并动摇 +1`)
}
function damageFort(f, n) {
  f.hp = Math.max(0, Math.min(f.hpMax, f.hp + n))
  if (f.hp <= 0) destroyFort(f)
  else pushLog(`${f.name} HP ${n > 0 ? '+' : ''}${n} → ${f.hp}/${f.hpMax}`)
}
// 攻城：仅攻城军队可用（攻城器械兵种／拥有爆裂射击／远程武器为攻城器械）
function canSiege(a) {
  return a && (unitTypeOf(a) === '攻城器械' || (a.tactics || []).includes('爆裂射击') || /攻城器械/.test(String(a.ranged0 || '')))
}
function fortsOf(side) { return (state.fortifications || []).filter((f) => !f.destroyed && f.side === side) }
const siegeFort = ref('')
const siegeDice = ref('')
const siegeOut = ref('')
function runSiege() {
  const s = selArmy.value
  if (!s) { siegeOut.value = '请先在态势图选中一支军队。'; return }
  if (!canSiege(s)) { siegeOut.value = '只有攻城军队（攻城器械兵种／爆裂射击战术）才能攻击防御工事。'; return }
  const f = (state.fortifications || []).find((x) => x.id === siegeFort.value)
  if (!f || f.destroyed) { siegeOut.value = '请选择目标防御工事。'; return }
  const d = Number(siegeDice.value)
  if (!(d >= 1 && d <= 20)) { siegeOut.value = '请填入桌上掷出的 d20（1–20）。'; return }
  const { mod, notes } = checkMods(s, '攻击', { ranged: true })
  const total = d + mod
  const tier = tierName(tierIndex(total, f.ac, d))
  let dmg = 0
  if (tier === '大成功') dmg = 2
  else if (tier === '成功' || tier === '失败') dmg = 1   // 交战/压倒性炮击：失败仍造成 1 点
  if (dmg) damageFort(f, -dmg)
  if (tier === '大失败') siegeOut.value = `${s.name} 轰击 ${f.name}：${d}${signed(mod)} = ${total} 对抗 AC ${f.ac} → 大失败，未造成伤害。`
  else siegeOut.value = `${s.name} 轰击 ${f.name}：${d}${signed(mod)} = ${total} 对抗 AC ${f.ac} → ${tier}，造成 ${dmg} 点伤害（HP ${f.hp}/${f.hpMax}）${notes.length ? `（${notes.join('，')}）` : ''}`
  logCalc('战争遭遇·攻城', {
    rule: '攻城军队可以交战／压倒性炮击动作用远程打击损伤防御工事：大成功 2 点、成功 1 点（压倒性炮击失败仍造成 1 点）；工事 HP 归零即被摧毁，其内部设防军队失去设防并动摇 +1（战争规则 防御工事）。d20 由玩家在桌上掷出后录入。',
    input: { 军队: s.name, 工事: f.name, 工事AC: f.ac, 调整值: mod },
    formula: '检定结果 = d20 + 攻击调整值，对抗工事 AC',
    steps: { 玩家掷出的d20: d, 检定结果: total },
    output: { 分级: tier, 工事HP: `${f.hp}/${f.hpMax}`, 是否摧毁: !!f.destroyed },
  })
  siegeDice.value = ''
}
function dropFort(id) {
  const i = (state.fortifications || []).findIndex((f) => f.id === id)
  if (i >= 0) state.fortifications.splice(i, 1)
}

function newId() { return Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36) }

// 我方在 legions，敌方在 opponents；两数组内 id 唯一
function armyOf(id) {
  return state.legions.find((x) => x.id === id) || state.opponents.find((x) => x.id === id) || null
}
const selArmy = computed(() => (sel.value ? armyOf(sel.value) : null))

// ---- 战场态势图布局：我方左列、敌方右列，远离的军队置于顶部“远离带” ----
const NODE_W = 250
const NODE_H = 54
const STEP = 66
const MAIN_TOP = 104
const board = computed(() => {
  const allies = state.legions.filter((a) => !a.offBoard)
  const enemies = state.opponents.filter((e) => !e.offBoard)
  const farA = allies.filter((a) => a.far)
  const nearA = allies.filter((a) => !a.far)
  const farE = enemies.filter((e) => e.far)
  const nearE = enemies.filter((e) => !e.far)
  const W = 920
  const rows = Math.max(nearA.length, nearE.length, 1)
  const H = MAIN_TOP + rows * STEP + 14
  const allyX = 18
  const enemyX = W - NODE_W - 18
  const nodes = {}
  nearA.forEach((a, i) => { nodes[a.id] = { x: allyX, y: MAIN_TOP + i * STEP, ally: true } })
  nearE.forEach((e, i) => { nodes[e.id] = { x: enemyX, y: MAIN_TOP + i * STEP, ally: false } })
  farA.forEach((a, i) => { nodes[a.id] = { x: allyX + i * (NODE_W + 14), y: 40, ally: true } })
  farE.forEach((e, i) => { nodes[e.id] = { x: enemyX - i * (NODE_W + 14), y: 40, ally: false } })
  const lines = []
  for (const a of allies) {
    const na = nodes[a.id]
    if (!na) continue
    for (const id of a.engagedWith || []) {
      const e = enemies.find((x) => x.id === id)
      const ne = e && nodes[e.id]
      if (!ne) continue
      lines.push({ x1: na.x + NODE_W, y1: na.y + NODE_H / 2, x2: ne.x, y2: ne.y + NODE_H / 2 })
    }
  }
  return { W, H, nodes, lines }
})

function select(id) { sel.value = sel.value === id ? '' : id }

// ---- 交战距离 ----
function setFar(a, val) {
  a.far = val
  if (val) {
    // 远离即解除一切交战（双方都要清）
    for (const id of [...(a.engagedWith || [])]) {
      const b = armyOf(id)
      if (b) b.engagedWith = (b.engagedWith || []).filter((x) => x !== a.id)
    }
    a.engagedWith = []
  }
  logCalc('战争遭遇·距离', {
    rule: '战场相对位置：邻近（只能远程打击）、交战（可近战，最多同时与四支交战）、远离（远程打击 −5）。撤退/推进用于改变位置（王国规则 战争遭遇 / 相对位置）',
    input: { 军队: a.name, 设为远离: val },
    steps: { 交战对象数: (a.engagedWith || []).length },
    output: { 当前距离: val ? '远离' : '战场（邻近/交战）' },
  })
  pushLog(`${a.name}：${val ? '撤到远离' : '回到战场'}`)
}
function engaged(a, otherId) { return (a.engagedWith || []).includes(otherId) }
function toggleEngage(a, otherId) {
  const b = armyOf(otherId)
  if (!b) return
  if (engaged(a, otherId)) {
    a.engagedWith = a.engagedWith.filter((x) => x !== otherId)
    b.engagedWith = (b.engagedWith || []).filter((x) => x !== a.id)
    pushLog(`${a.name} 脱离 ${b.name}`)
    return
  }
  if (a.far || b.far) { pushLog('需先「推进」离开远离状态才能交战。'); return }
  if ((a.engagedWith || []).length >= 4 || (b.engagedWith || []).length >= 4) { pushLog('一支军队最多同时与四支军队交战。'); return }
  a.engagedWith = [...(a.engagedWith || []), otherId]
  b.engagedWith = [...(b.engagedWith || []), a.id]
  logCalc('战争遭遇·交战', {
    rule: '交战：一支军队最多可同时与四支军队交战；只有交战时才能对目标使用近战打击（王国规则 战争遭遇 / 相对位置）',
    input: { 军队: a.name, 目标: b.name },
    steps: { 军队交战数: a.engagedWith.length, 目标交战数: b.engagedWith.length },
    output: { 状态: '交战' },
  })
  pushLog(`${a.name} 与 ${b.name} 交战`)
}

// ---- 状态与动作 ----
function addShaken(a, d) {
  a.shaken = Math.max(0, (a.shaken || 0) + d)
  if (a.shaken >= 4) { a.routed = true; disbandArmy(a); pushLog(`${a.name} 动摇达 4，自动溃败并解散（王国 +1d4 动荡，一项祸患 +1，需手工施加）`) }
  else pushLog(`${a.name} 动摇 ${d > 0 ? '+' : ''}${d} → ${a.shaken}`)
  logCalc('战争遭遇·动摇', {
    rule: '动摇：军队士气检定承受等于动摇值的环境减值；受伤害时须通过 DC 11 平值检定否则动摇 +1；动摇达 4 自动溃败（王国规则 战争遭遇 / 动摇）',
    input: { 军队: a.name, 增减: d },
    output: { 动摇: a.shaken, 溃败: !!a.routed },
  })
}
function addFatigue(a, d) {
  a.fatigued = Math.max(0, (a.fatigued || 0) + d)
  if (a.fatigued >= 4) disbandArmy(a)
  pushLog(`${a.name} 疲惫 ${d > 0 ? '+' : ''}${d} → ${a.fatigued}`)
}
function damage(a, d) {
  a.hp = Math.max(0, Math.min(a.hpMax, a.hp + d))
  pushLog(`${a.name} HP ${d > 0 ? '+' : ''}${d} → ${a.hp}/${a.hpMax}`)
  logCalc('战争遭遇·伤害', {
    rule: '军队命中造成 1 点伤害、重击 2 点；HP 只可能因战争动作的结果减少（王国规则 战争遭遇 / 打击规则）',
    input: { 军队: a.name, 变化: d },
    output: { HP: `${a.hp}/${a.hpMax}` },
  })
}
function useAction(a) {
  a.actionsUsed = Math.min(3, (a.actionsUsed || 0) + 1)
  if (a.actionsUsed === 3) pushLog(`${a.name} 本回合三个战争动作已用完`)
}
function resetActions(a) { a.actionsUsed = 0 }
function useAmmo(a, d) {
  a.ammoUsed = Math.max(0, Math.min(rangedMax(a), (a.ammoUsed || 0) + d))
  pushLog(`${a.name} 远程打击已用 ${a.ammoUsed}/${rangedMax(a)}`)
}
const needMorale = computed(() => [...state.legions, ...state.opponents]
  .filter((a) => !a.routImmune && !a.offBoard && !a.destroyed && effectiveRT(a) != null && a.hp <= effectiveRT(a)))

// ---- 溃败检查：每轮结束、每支 HP ≤ RT 的军队各做一次士气检定 ----
const routArmy = ref('')
const routDice = ref('')
const routOut = ref('')
function enemiesOf(a) {
  const pool = sideOf(a) === 'ally' ? state.opponents : state.legions
  return pool.filter((x) => !x.offBoard && !x.destroyed && (x.hp || 0) > 0)
}
function routDC(a) {
  const es = enemiesOf(a)
  if (!es.length) return null
  return 10 + Math.max(...es.map((e) => num(statsOf(e).morale)))
}
function resolveRout() {
  const a = [...state.legions, ...state.opponents].find((x) => x.id === routArmy.value)
  if (!a) { routOut.value = '请选择要检查溃败的军队。'; return }
  const r = Number(routDice.value)
  if (!(r >= 1 && r <= 20)) { routOut.value = '请填入桌上掷出的 d20（1–20）。'; return }
  const dc = routDC(a)
  if (dc == null) { routOut.value = '没有剩余敌军，无需检查溃败。'; return }
  const mod = num(statsOf(a).morale) - (a.shaken || 0) - (a.routed ? 2 : 0) + (a.fortified ? 4 : 0) + (a.pcLead ? 1 : 0)
  const total = r + mod
  const tier = tierName(tierIndex(total, dc, r))
  if (tier === '大成功') { a.routImmune = true; routOut.value = `${a.name}：d20 ${r}${signed(mod)} = ${total} 对抗 DC ${dc} → 大成功，本次遭遇余下时间不再检查溃败` }
  else if (tier === '失败') { shake(a, 1); routOut.value = `${a.name}：d20 ${r}${signed(mod)} = ${total} 对抗 DC ${dc} → 失败，动摇 +1（现 ${a.shaken}）` }
  else if (tier === '大失败') { a.routed = true; routOut.value = `${a.name}：d20 ${r}${signed(mod)} = ${total} 对抗 DC ${dc} → 大失败，溃败` }
  else routOut.value = `${a.name}：d20 ${r}${signed(mod)} = ${total} 对抗 DC ${dc} → 成功，不溃败`
  routDice.value = ''
  logCalc('战争遭遇·溃败检查', {
    rule: '每轮结束时，HP 处于或低于溃败阈值的军队做一次士气检定，DC = 剩余敌军中最高的士气 DC；大成功本次遭遇不再检查，失败动摇 +1，大失败溃败（王国规则 战争遭遇 第3步）。',
    input: { 军队: a.name, 士气调整值: mod, 对抗DC: dc, 动摇: a.shaken || 0, 溃败: !!a.routed },
    steps: { d20: r, 检定结果: total },
    output: { 分级: tier, 免疫: !!a.routImmune },
  })
  pushLog('溃败检查：' + routOut.value)
}

// ---- 动作检定器（d20 由桌上掷出后录入）----
const rKind = ref('机动')
const rDC = ref('')
const rDice = ref('')
const rExtra = ref(0)
const rOut = ref('')
// 建议 DC：攻击→敌军最高有效 AC；机动/士气/侦察→10 + 敌军对应最高调整值（对应规则“对抗剩余敌军中最高士气 DC”等）
const rDCSuggest = computed(() => {
  const a = selArmy.value
  if (!a) return null
  const foes = (state.legions.includes(a) ? state.opponents : state.legions).filter((f) => !f.offBoard)
  if (!foes.length) return null
  if (rKind.value === '攻击') return Math.max(...foes.map((f) => effectiveAC(f)))
  if (rKind.value === '机动') return 10 + Math.max(...foes.map((f) => num(statsOf(f).maneuver)))
  if (rKind.value === '士气') return 10 + Math.max(...foes.map((f) => num(statsOf(f).morale)))
  if (rKind.value === '侦察') return 10 + Math.max(...foes.map((f) => num(statsOf(f).scout)))
  return null
})
function useRDCSuggest() { if (rDCSuggest.value !== null) rDC.value = rDCSuggest.value }
// 远程打击上限：基础 5 次，「弹药增量」每次 +2（可重复选取）
function rangedMax(a) { return 5 + 2 * (a.tactics || []).filter((x) => x === '弹药增量').length }
// 战术被动加值：只映射能对应到现有检定粒度的战术；其余（先攻/地形/多次攻击等）在数据与战术动作里另述
function tacticMods(a, kind, { act = null, ranged = null, target = null } = {}) {
  const has = (n) => (a.tactics || []).includes(n)
  const lvl = a.level || 0
  let mod = 0
  const notes = []
  const ctx = { act, ranged, target }
  // 浴血不倒：HP ≤ 溃败阈值时，攻击/机动/士气 +1（10 级 +2）
  if (has('浴血不倒') && effectiveRT(a) != null && a.hp <= effectiveRT(a) && ['攻击', '机动', '士气'].includes(kind)) {
    const v = lvl >= 10 ? 2 : 1
    mod += v; notes.push(`浴血不倒 +${v}`)
  }
  // 神射手：远程攻击 +1；近战攻击 −2（9 级 −1、15 级 0）
  if (kind === '攻击' && has('神射手')) {
    if (ranged === true) { mod += 1; notes.push('神射手·远程 +1') }
    else if (ranged === false) { const pen = lvl >= 15 ? 0 : lvl >= 9 ? -1 : -2; if (pen) { mod += pen; notes.push(`神射手·近战 ${pen}`) } }
  }
  // 防御战术：为防卫所进行的机动检定（戒备/防御姿态）+1（9 级 +2、17 级 +3）
  if (kind === '机动' && has('防御战术') && act && ['戒备', '防御姿态'].includes(act.key)) {
    const v = lvl >= 17 ? 3 : lvl >= 9 ? 2 : 1
    mod += v; notes.push(`防御战术 +${v}`)
  }
  // 重整（士气）：专注虔诚 +1（9 级 +2、17 级 +3）；坚守阵线（抗溃败）+1
  if (kind === '士气' && act && act.key === '重整') {
    if (has('专注虔诚')) { const v = lvl >= 17 ? 3 : lvl >= 9 ? 2 : 1; mod += v; notes.push(`专注虔诚 +${v}`) }
  }
  // 坚守阵线：抵抗溃败的士气检定 +1（溃败阈值另有 effectiveRT 处理）
  if (kind === '士气' && has('坚守阵线')) { mod += 1; notes.push('坚守阵线·抗溃败 +1') }
  // 伏击：第一轮、且本军尚未攻击过时，对开局即交战的那支敌军第一次攻击 +2 状态加值
  if (kind === '攻击' && round.value === 1 && has('伏击') && ctx.target && a.ambushTarget === ctx.target.id && (a.attackCount || 0) === 0) {
    mod += 2; notes.push('伏击 +2')
  }
  // 碾压（骑兵的固有首个战术）：对步兵／散兵的武器攻击 +1 状态加值；骑兵专精提高到 +2
  if (kind === '攻击' && unitTypeOf(a) === '骑兵' && ctx.target && ['步兵', '散兵'].includes(unitTypeOf(ctx.target))) {
    const v = has('骑兵专精') ? 2 : 1
    mod += v; notes.push(`碾压 +${v}`)
  }
  // 碾压的代价：对抗范围攻击与精神攻击的机动／士气豁免 −1（骑兵专精且 12 级起忽略）
  if ((kind === '机动' || kind === '士气') && unitTypeOf(a) === '骑兵' && saveVsAoe.value) {
    if (!(has('骑兵专精') && lvl >= 12)) { mod -= 1; notes.push('碾压·豁免 −1') }
  }
  // 亡命侧击：以 AC −2 换取攻击 +1，持续到不再处于交战状态
  if (kind === '攻击' && a.reckless && (a.engagedWith || []).length) { mod += 1; notes.push('亡命侧击 +1') }
  return { mod, notes }
}
function checkMods(a, kind, ctx = {}) {
  const s = statsOf(a)
  let mod = 0
  const notes = []
  if (kind === '侦察') mod = num(s.scout)
  else if (kind === '机动') {
    mod = num(s.maneuver)
    if (a.fatigued) { mod -= a.fatigued; notes.push(`疲惫 −${a.fatigued}`) }
    if (a.trapped) { mod -= a.trapped; notes.push(`受困 −${a.trapped}`) }
    if (a.pinned) { notes.push('钉死：不能使用机动动作') }
  } else if (kind === '士气') {
    mod = num(s.morale)
    if (a.shaken) { mod -= a.shaken; notes.push(`动摇 −${a.shaken}`) }
    if (a.routed) { mod -= 2; notes.push('溃败 −2') }
    if (a.fortified) { mod += 4; notes.push('设防 +4') }
    if (a.pcLead) { mod += 1; notes.push('开拓者随军 +1') }
  } else if (kind === '攻击') {
    // 近战取近战加值，远程取远程加值（两者可能不同，如格林格赖普 +19／+18）
    mod = num(ctx && ctx.ranged ? s.ranged : s.melee)
    if (ctx && ctx.ranged) notes.push('远程打击')
    const ga = gearAttackBonus(a)
    if (ga) { mod += ga; notes.push(`魔法武器 +${ga}`) }
  }
  const tr = terrainMods(a, kind)
  mod += tr.mod; notes.push(...tr.notes)
  if (isConcealed(a) && kind === '机动') { mod += 2; notes.push('隐蔽 +2') }
  const tm = tacticMods(a, kind, ctx)
  mod += tm.mod; notes.push(...tm.notes)
  return { mod, notes }
}
// 多重攻击减值：本轮第 2 次攻击 −5、第 3 次 −10（保持压制改为 −4/−8）
function multiAttackPenalty(a) {
  const n = a.attackCount || 0
  if (n <= 0) return 0
  const keep = (a.tactics || []).includes('保持压制')
  if (n === 1) return keep ? -4 : -5
  return keep ? -8 : -10
}
// 有效 AC = 基础 AC + 设防(+4) + 戒备(+2) + 浴血不倒(+1/+2) + 魔法护甲 + 隐蔽(+2) − 被包抄(−2) − 疲惫(等于疲惫值) − 亡命侧击(−2)
function effectiveAC(a) {
  let ac = num(statsOf(a).ac)
  if (a.fortified) ac += 4
  if (a.guarded) ac += 2
  if (a.flanked) ac -= 2
  if (a.fatigued) ac -= a.fatigued
  ac += gearACBonus(a)
  if (isConcealed(a)) ac += 2
  // 亡命侧击：以 AC −2 换取攻击 +1，持续到不再交战
  if (a.reckless && (a.engagedWith || []).length) ac -= 2
  if ((a.tactics || []).includes('浴血不倒') && effectiveRT(a) != null && a.hp <= effectiveRT(a)) ac += (a.level || 0) >= 10 ? 2 : 1
  return ac
}
const rPreview = computed(() => {
  if (!selArmy.value) return null
  const { mod, notes } = checkMods(selArmy.value, rKind.value)
  return { mod, notes }
})
function resolveCheck() {
  const a = selArmy.value
  if (!a) { rOut.value = '请先在态势图上选中一支军队。'; return }
  const d = Number(rDice.value)
  const dc = Number(rDC.value)
  if (!(d >= 1 && d <= 20)) { rOut.value = '请填入桌上掷出的 d20（1–20）。'; return }
  if (!dc) { rOut.value = '请填入对抗 DC。'; return }
  const { mod, notes } = checkMods(a, rKind.value)
  const extra = Number(rExtra.value) || 0
  const total = d + mod + extra
  const label = tierName(tierIndex(total, dc, d))
  rOut.value = `${a.name} · ${rKind.value}检定：${d}${signed(mod)}${extra ? signed(extra) : ''} = ${total} 对抗 DC ${dc} → ${label}${notes.length ? `（${notes.join('，')}）` : ''}`
  logCalc('战争遭遇·动作检定', {
    rule: '战争动作多需一次检定（机动/士气/攻击/侦察），对抗目标 AC 或标准 DC；大成功/成功/失败/大失败按各动作条目处理（王国规则 战术战争动作）。d20 由玩家在桌上掷出后录入。',
    input: { 军队: a.name, 检定类型: rKind.value, 基础调整: mod, 额外调整: extra, 对抗DC: dc, 自动减值说明: notes },
    formula: '检定结果 = d20 + 对应调整值 + 额外调整；≥DC+10 大成功、≥DC 成功、≤DC−10 大失败',
    steps: { 玩家掷出的d20: d, 检定结果: total },
    output: { 结果: label },
  })
  useAction(a)
  pushLog(`动作检定（${a.name}·${rKind.value}）：${total} vs DC ${dc} → ${label}`)
  rDice.value = ''
}

// ---- 战术战争动作：点动作 → 选目标 → 录入桌上 d20 → 按结果结算 ----
function hp(a, n) { a.hp = Math.max(0, Math.min(a.hpMax, a.hp + n)) }
// 动摇或疲惫达到 4 → 立即解散：王国 +1d4 动荡、一项祸患 +1（骰子由玩家在桌上掷出后自行施加）
function disbandArmy(a) {
  if (a.offBoard) return
  a.offBoard = true
  pushLog(`${a.name} 的动摇/疲惫达到 4，立即解散：王国应 +1d4 动荡，并选择一项祸患 +1（到「回合 · 事件后果」施加）`)
}
function shake(a, n) { a.shaken = Math.max(0, (a.shaken || 0) + n); if (a.shaken >= 4) { a.routed = true; disbandArmy(a) } }
function tire(a, n) { a.fatigued = Math.max(0, (a.fatigued || 0) + n); if (a.fatigued >= 4) disbandArmy(a) }
// 受困达 4 → 钉死（被包抄且不能用机动动作）
function trap(a, n) {
  a.trapped = Math.max(0, (a.trapped || 0) + n)
  if (a.trapped >= 4) { a.pinned = true; a.flanked = true; pushLog(`${a.name} 受困达 4，变为钉死（被包抄，且不能使用机动动作）`) }
  else pushLog(`${a.name} 受困 ${n > 0 ? '+' : ''}${n} → ${a.trapped}`)
}
function far(a, v) {
  a.far = v
  if (v) {
    for (const id of [...(a.engagedWith || [])]) { const b = armyOf(id); if (b) b.engagedWith = (b.engagedWith || []).filter((x) => x !== a.id) }
    a.engagedWith = []
  }
}
function engage(s, t) {
  s.far = false; t.far = false
  if (!(s.engagedWith || []).includes(t.id)) s.engagedWith = [...(s.engagedWith || []), t.id]
  if (!(t.engagedWith || []).includes(s.id)) t.engagedWith = [...(t.engagedWith || []), s.id]
}
function disengage(s, t) {
  s.engagedWith = (s.engagedWith || []).filter((x) => x !== t.id)
  t.engagedWith = (t.engagedWith || []).filter((x) => x !== s.id)
}

const ACT_ACTIONS = [
  { key: '推进', cost: 1, target: 'enemy', check: '机动', req: '', txt: '机动检定对抗目标机动 DC。大成功：即便目标远离也与之交战；成功：目标若远离则失去远离，否则与之交战；大失败：推进失败并受困。',
    apply(s, t, tier) {
      if (tier === '大成功') engage(s, t)
      else if (tier === '成功') { if (t.far) far(t, false); else engage(s, t) }
      // 亡命侧击：若本军拥有该战术且已勾选，则在成功与敌交战时启用 AC −2／攻击 +1
      if (tier === '大成功' || tier === '成功') {
        if (useReckless.value && (s.tactics || []).includes('亡命侧击') && (s.engagedWith || []).includes(t.id)) s.reckless = true
      }
    } },
  { key: '交战', cost: 1, target: 'enemy', check: '攻击', attack: true, req: '', txt: '对目标打击。大成功 2 点伤害；成功 1 点伤害。未交战时须改为远程打击。',
    apply(s, t, tier) { if (tier === '大成功') hp(t, -2); else if (tier === '成功') hp(t, -1) } },
  { key: '脱离', cost: 2, target: 'enemy', check: '机动', noEngage: true, req: '自己未交战', txt: '机动检定对抗目标机动 DC。大成功：不再与目标及所有交战对象交战；成功：不再与目标交战；大失败：本回合余下时间不能脱离。',
    apply(s, t, tier) { if (tier === '大成功') { for (const id of [...(s.engagedWith || [])]) { const b = armyOf(id); if (b) disengage(s, b) } } else if (tier === '成功') disengage(s, t) } },
  { key: '戒备', cost: 1, target: 'enemy', check: '机动', req: '', txt: '机动检定。大成功：AC +2 直到下回合；成功：仅对目标 AC +2。此处统一记 AC +2。',
    apply(s, t, tier) { if (tier === '大成功' || tier === '成功') s.guarded = 2 } },
  { key: '重整', cost: 2, target: 'enemy', check: '士气', req: '', txt: '士气检定对抗目标士气 DC。大成功：若已溃败则失去溃败且动摇 −2；成功：动摇 −1；大失败：动摇 +1。',
    apply(s, t, tier) { if (tier === '大成功') { s.routed = false; shake(s, -2) } else if (tier === '成功') shake(s, -1); else if (tier === '大失败') shake(s, 1) } },
  { key: '撤退', cost: 3, target: 'none', check: null, noEngage: true, req: '自己未交战', txt: '无需检定。若已处于远离，则逃离战场（移出遭遇并记为溃败）；否则获得远离状态。',
    apply(s) { if (s.far) { s.routed = true; s.offBoard = true } else far(s, true) } },
  { key: '全力突击', cost: 2, target: 'enemy', check: '攻击', attack: true, tactic: '无情', req: '无情', txt: '近战打击。大成功 3 伤；成功 2 伤；失败仍 1 伤；大失败无伤且被包抄。',
    apply(s, t, tier) { if (tier === '大成功') hp(t, -3); else if (tier === '成功') hp(t, -2); else if (tier === '失败') hp(t, -1); else if (tier === '大失败') s.flanked = true } },
  { key: '战地医疗', cost: 3, target: 'ally', check: '侦察', fixedDC: 25, tactic: '战地救护', req: '战地救护', txt: 'DC 25 侦察检定。大成功：目标恢复 2 HP；成功：恢复 1 HP；大失败：目标疲惫 +1。',
    apply(s, t, tier) { if (tier === '大成功') hp(t, 2); else if (tier === '成功') hp(t, 1); else if (tier === '大失败') tire(t, 1) } },
  { key: '反击', cost: 0, target: 'enemy', check: '攻击', attack: true, tactic: '灵活战术', req: '灵活战术', txt: '以近战打击触发机动动作的敌军。大成功：1 伤且目标动摇 +1；成功：1 伤。',
    apply(s, t, tier) { if (tier === '大成功') { hp(t, -1); shake(t, 1) } else if (tier === '成功') hp(t, -1) } },
  { key: '掩护射击', cost: 2, target: 'enemy', check: '攻击', attack: true, ranged: true, tactic: '神射手', req: '神射手', txt: '远程打击。大成功 2 伤；成功 1 伤；失败仍 1 伤；大失败无。',
    apply(s, t, tier) { if (tier === '大成功') hp(t, -2); else if (tier === '成功') hp(t, -1); else if (tier === '失败') hp(t, -1) } },
  { key: '防御姿态', cost: 2, target: 'enemy', protect: true, check: '机动', tactic: '防御战术', req: '防御战术', txt: '对一支敌军尝试机动检定，以保护一支被包抄的目标友军。大成功：目标友军不再被任何军队包抄；成功：目标友军不再被目标军队包抄；大失败：自己被目标敌军包抄。',
    apply(s, t, tier, protect) { if (tier === '大成功' || tier === '成功') { if (protect) protect.flanked = false } else if (tier === '大失败') s.flanked = true } },
  { key: '下三滥打法', cost: 1, target: 'enemy', check: '攻击', attack: true, tactic: '灵活战术', req: '灵活战术', txt: '对被包抄目标的打击。大成功：目标疲惫 +2；成功：疲惫 +1；大失败：目标疲惫 −1。',
    apply(s, t, tier) { if (tier === '大成功') tire(t, 2); else if (tier === '成功') tire(t, 1); else if (tier === '大失败') tire(t, -1) } },
  { key: '诈退', cost: 0, target: 'enemy', check: '士气', tactic: '灵活战术', req: '灵活战术（一次士气检定成功后触发）', txt: '士气检定对抗目标士气 DC。大成功（或成功）：目标被包抄；大失败：自己被包抄。',
    apply(s, t, tier) { if (tier === '大成功' || tier === '成功') t.flanked = true; else if (tier === '大失败') s.flanked = true } },
  { key: '虚招', cost: 1, target: 'enemy', check: '攻击', tactic: '灵活战术', req: '灵活战术', txt: '大成功（或成功）：目标被包抄；大失败：自己被包抄。',
    apply(s, t, tier) { if (tier === '大成功' || tier === '成功') t.flanked = true; else if (tier === '大失败') s.flanked = true } },
  { key: '包抄', cost: 2, target: 'enemy', check: '机动', tactic: '亡命侧击', noEngage: true, req: '亡命侧击，且自己未交战', txt: '机动检定。大成功：目标被包抄（是否交战由你决定）；成功：目标被包抄并与之交战；大失败：自己被包抄。',
    apply(s, t, tier) { if (tier === '大成功') t.flanked = true; else if (tier === '成功') { t.flanked = true; engage(s, t) } else if (tier === '大失败') s.flanked = true } },
  { key: '压倒性炮击', cost: 2, target: 'enemy', check: '攻击', attack: true, ranged: true, ammoCost: 2, tactic: '爆裂射击', req: '爆裂射击', txt: '远程打击（计 2 次弹药）。大成功 2 伤；成功 1 伤；失败仍 1 伤；大失败无且自己被包抄。',
    apply(s, t, tier) { if (tier === '大成功') hp(t, -2); else if (tier === '成功') hp(t, -1); else if (tier === '失败') hp(t, -1); else if (tier === '大失败') s.flanked = true } },
  { key: '嘲讽', cost: 1, target: 'enemy', check: '士气', tactic: '专注虔诚', req: '专注虔诚', txt: '士气检定对抗目标士气 DC。大成功：目标动摇 +2；成功：动摇 +1；大失败：目标动摇 −1。',
    apply(s, t, tier) { if (tier === '大成功') shake(t, 2); else if (tier === '成功') shake(t, 1); else if (tier === '大失败') shake(t, -1) } },
]

const actKey = ref('')
const actTarget = ref('')
const actProtect = ref('')
const actDice = ref('')
const actOut = ref('')
// 亡命侧击：勾选后，本次「推进」成功与敌交战时启用 AC −2／攻击 +1
const useReckless = ref(false)
const curAct = computed(() => ACT_ACTIONS.find((a) => a.key === actKey.value) || null)
// 防御姿态：需要选择被保护的友军
function allyTargets(act) {
  const s = selArmy.value
  if (!s || !act || !act.protect) return []
  const allies = (sideOf(s) === 'ally' ? state.legions : state.opponents).filter((x) => !x.offBoard)
  return allies.filter((x) => x.id !== s.id)
}

// ---- 已学战术（军队战术）----
const REPEATABLE_TACTICS = ['弹药增量', '坚韧士兵']
const BASE_TYPES = ['步兵', '骑兵', '散兵', '攻城器械']
function parseTacticReq(req) {
  const typesM = String(req || '').match(/特质[:：]([^；;]*)/)
  const types = typesM ? typesM[1].split(/[、,，]/).map((x) => x.trim()).filter(Boolean) : []
  const lvM = String(req || '').match(/战术等级\s*(\d+)/)
  return { types, level: lvM ? Number(lvM[1]) : 0 }
}
function maxTacticsOf(a) { const r = a ? levelRow(a.level) : null; return r ? r.maxTactics : null }
function eligibleTactics(a) {
  if (!a) return []
  return tacticsData.tactics.filter((t) => {
    const { types, level } = parseTacticReq(t.requirement)
    if (a.level != null && a.level < level) return false
    if (unitTypeOf(a) && BASE_TYPES.includes(unitTypeOf(a)) && !types.includes(unitTypeOf(a))) return false
    if ((a.tactics || []).includes(t.name) && !REPEATABLE_TACTICS.includes(t.name)) return false
    return true
  })
}
const addTacticSel = ref('')
function addTactic(a) {
  const name = addTacticSel.value
  if (!name) return
  const max = maxTacticsOf(a)
  if (max !== null && (a.tactics || []).length >= max) { pushLog(`${a.name} 战术数已达上限 ${max}`); return }
  a.tactics = [...(a.tactics || []), name]
  addTacticSel.value = ''
  // 坚韧士兵：把最大生命值 +1（可重复选取，每选取一次 +1）
  if (name === '坚韧士兵') { a.hpMax += 1; a.hp += 1; pushLog(`${a.name} 最大生命值 +1 → ${a.hpMax}`) }
  logCalc('战争遭遇·学习战术', {
    rule: '军队掌握的战术数有上限（「基础军队按等级」表的最大战术数）；军队等级须 ≥ 战术等级、类型须被列为特质，且不能重复拥有同一种战术（弹药增量/坚韧士兵可重复选取）（王国规则 军队战术）',
    input: { 军队: a.name, 战术: name, 军队等级: a.level, 军队类型: unitTypeOf(a) },
    output: { 已学战术: a.tactics.slice(), 上限: max === null ? '—' : max },
  })
  pushLog(`${a.name} 学习战术：${name}`)
}
function removeTactic(a, name) { a.tactics = (a.tactics || []).filter((x) => x !== name) }
function actionBlock(s, act) {
  if (!s || !act) return ''
  if (isDefeated(s)) return '已被击败：不能采取战争动作（只能通过恢复军队活动恢复到 1 HP）'
  if (s.destroyed) return '已损毁：无法恢复，只能以新军队取代'
  if (s.misplaced) return '处于失散：不能采取除恢复之外的任何军队活动'
  if (act.tactic && !(s.tactics || []).includes(act.tactic)) return `需先学习战术「${act.tactic}」`
  if (act.noEngage && (s.engagedWith || []).length) return '需处于未交战状态'
  if (s.pinned && act.check === '机动') return '已钉死，不能使用机动战争动作'
  // 每轮 3 个动作；反应（cost 0）不占动作，仍可在用完后使用
  if (act.cost && (s.actionsUsed || 0) >= 3) return '本回合 3 个战争动作已用完'
  if (act.cost && (s.actionsUsed || 0) + act.cost > 3) return `剩余动作不足（需 ${act.cost}，剩 ${3 - (s.actionsUsed || 0)}）`
  return ''
}
function sideOf(a) { return state.legions.includes(a) ? 'ally' : 'enemy' }
function targetsFor(act) {
  const s = selArmy.value
  if (!s || !act || act.target === 'none') return []
  const allies = (sideOf(s) === 'ally' ? state.legions : state.opponents).filter((x) => !x.offBoard)
  const enemies = (sideOf(s) === 'ally' ? state.opponents : state.legions).filter((x) => !x.offBoard)
  const base = act.target === 'ally' ? allies : enemies
  return base.filter((x) => x.id !== s.id)
}
function pickAction(a) { actKey.value = a.key; actTarget.value = ''; actProtect.value = ''; actDice.value = ''; actOut.value = '' }
// 只把当前真能用的动作摆出来；被规则挡住的（未学战术、已钉死、已溃败…）收进折叠，免得按钮列表大半是灰的
const usableActions = computed(() => ACT_ACTIONS.filter((a) => !actionBlock(selArmy.value, a)))
const blockedActions = computed(() => ACT_ACTIONS.filter((a) => actionBlock(selArmy.value, a)))
function dcFor(act, t) {
  if (act.fixedDC) return act.fixedDC
  if (!t) return null
  if (act.check === '攻击') return effectiveAC(t)
  // 「无情」战术仅在敌军尝试「脱离」时，为其机动 DC 提供 +2（战争规则 无情）
  if (act.check === '机动') return 10 + num(statsOf(t).maneuver) + (act.key === '脱离' && (t.tactics || []).includes('无情') ? 2 : 0)
  if (act.check === '士气') return 10 + num(statsOf(t).morale)
  return null
}
function resolveAction() {
  const s = selArmy.value
  const act = curAct.value
  if (!s || !act) return
  const blk = actionBlock(s, act)
  if (blk) { actOut.value = blk; return }
  const t = act.target === 'none' ? null : armyOf(actTarget.value)
  if (act.target !== 'none' && (!t || t.offBoard)) { actOut.value = '请选择目标。'; return }
  let protect = null
  if (act.protect) {
    protect = armyOf(actProtect.value)
    if (!protect || protect.offBoard) { actOut.value = '请选择要保护的友军。'; return }
  }
  let tier = null, total = null, dc = null, mod = 0, extra = 0
  const notes = []
  if (act.check) {
    const d = Number(actDice.value)
    if (!(d >= 1 && d <= 20)) { actOut.value = '请填入桌上掷出的 d20（1–20）。'; return }
    const eng = act.attack && (s.engagedWith || []).includes(t.id)
    const ranged = act.attack ? (!eng || !!act.ranged) : null
    const cm = checkMods(s, act.check, { act, ranged, target: t })
    mod = cm.mod; notes.push(...cm.notes)
    if (act.attack) {
      const isRanged = !eng || !!act.ranged
      if (isRanged) {
        if ((s.ammoUsed || 0) + (act.ammoCost || 1) > rangedMax(s)) { actOut.value = `弹药不足（已用 ${s.ammoUsed || 0}/${rangedMax(s)}，本次需 ${act.ammoCost || 1}）`; return }
        s.ammoUsed = Math.min(rangedMax(s), (s.ammoUsed || 0) + (act.ammoCost || 1))
        const wp = windPenalty(!!t.far)
        if (wp) { extra -= wp; notes.push(`风 −${wp}`) }
        if (!eng && t.far) { extra -= 5; notes.push('远程打击·目标远离 −5') }
        notes.push('远程打击')
      }
      // 多重攻击减值（反击不计入）
      if (act.key !== '反击') {
        const map = multiAttackPenalty(s)
        if (map) { extra += map; notes.push(`多重攻击 ${map}`) }
      }
    }
    dc = dcFor(act, t)
    total = d + mod + extra
    tier = tierName(tierIndex(total, dc, d))
    actOut.value = `${s.name} · ${act.key}：${d}${signed(mod)}${extra ? signed(extra) : ''} = ${total} 对抗 DC ${dc} → ${tier}${notes.length ? `（${notes.join('，')}）` : ''}`
  }
  if (act.cost) s.actionsUsed = Math.min(3, (s.actionsUsed || 0) + act.cost)
  if (act.attack && act.key !== '反击') s.attackCount = (s.attackCount || 0) + 1
  act.apply(s, t, tier, protect)
  if (!act.check) actOut.value = `${s.name} · ${act.key}：已结算（无需检定）`
  logCalc('战争遭遇·战术动作', {
    rule: '各战争动作的效果按大成功/成功/失败/大失败分级处理（王国规则 战术战争动作）。d20 由玩家在桌上掷出后录入。',
    input: { 军队: s.name, 动作: act.key, 需求: act.req || '无', 目标: t ? t.name : '—', 保护友军: protect ? protect.name : '—', 检定类型: act.check || '无', 基础调整: mod, 额外调整: extra, 对抗DC: dc },
    formula: '结果分级：≥DC+10 大成功、≥DC 成功、≤DC−10 大失败、其余失败；自然 20/1 升降一级',
    steps: act.check ? { 玩家掷出的d20: Number(actDice.value), 检定结果: total } : { 无需检定: true },
    output: { 分级: tier || '—', 消耗动作: act.cost || 0, 军队剩余动作: `${s.actionsUsed || 0}/3` },
  })
  if (act.check) actDice.value = ''
  pushLog(`战术动作（${s.name}·${act.key}）：${tier || '已结算'}`)
}

// ---- 轮次 ----
function nextRound() {
  round.value += 1
  // 被包抄/戒备的持续时间为“到下个回合开始”，故在新一轮开始时清除；多重攻击计数也重置
  for (const a of [...state.legions, ...state.opponents]) { a.actionsUsed = 0; a.flanked = false; a.guarded = 0; a.attackCount = 0 }
  pushLog(`进入战争遭遇第 ${round.value} 轮（动作次数、被包抄、戒备已重置）`)
}

// ---- 敌军录入（自动填数值）----
function addEnemy() {
  const a = armies.find((x) => x.name === oppKey.value)
  if (!a) return
  const lv = Number(oppLevel.value) || a.level
  const hp = Number(a.hp) || 5
  state.opponents.push({
    id: newId(), armyKey: a.name, name: a.name, type: a.type || '', unitType: a.unitType || '',
    level: lv, baseLevel: a.level,
    hpMax: hp, hp, rt: a.rt === null || a.rt === undefined ? null : a.rt,
    scout0: a.scout || '', ac0: a.ac || '', maneuver0: a.maneuver || '', morale0: a.morale || '',
    melee0: a.melee || '', ranged0: a.ranged || '', note: '',
    ...statusDefaults(),
  })
  logCalc('战争遭遇·录入敌军', {
    rule: '敌军使用同兵种数据块；等级高于兵种最低等级时按「基础军队按等级」表提升数值（王国规则 战争遭遇 / 敌方军队）',
    input: { 兵种: a.name, 兵种最低等级: a.level, 采用等级: lv, 生命值: hp, 溃败阈值: a.rt },
    output: { 敌军总数: state.opponents.length },
  })
  oppKey.value = ''; oppLevel.value = ''
}
function addCustomEnemy() {
  const name = oppCustom.value.trim()
  if (!name) return
  state.opponents.push({
    id: newId(), armyKey: '', name, type: '',
    level: null, baseLevel: null,
    hpMax: 4, hp: 4, rt: null,
    scout0: '', ac0: '', maneuver0: '', morale0: '+10', melee0: '', ranged0: '', note: '',
    ...statusDefaults(),
  })
  oppCustom.value = ''
}
function dropArmy(id) {
  const li = state.legions.findIndex((x) => x.id === id)
  if (li >= 0) { state.legions.splice(li, 1); state.armies = state.legions.length }
  const oi = state.opponents.findIndex((x) => x.id === id)
  if (oi >= 0) state.opponents.splice(oi, 1)
  if (sel.value === id) sel.value = ''
}
function clearBoard() {
  for (const a of [...state.legions, ...state.opponents]) {
    // 不把 offBoard 设回 false：已经解散/损毁/失散的军队不能因为重置战场而重新出现
    a.far = false; a.engagedWith = []; a.actionsUsed = 0; a.flanked = false; a.fortified = false; a.guarded = 0; a.attackCount = 0; a.routImmune = false
  }
  round.value = 1
  pushLog('战争遭遇已重置（距离/交战/动作清空，HP、动摇疲惫与离场状态保留）')
}

const flags = (a) => {
  const f = []
  if (a.destroyed) f.push('损毁')
  if (isDefeated(a)) f.push('击败')
  if (a.routed) f.push('溃败')
  if (a.misplaced) f.push('失散')
  if (a.efficient) f.push('高效')
  if (isConcealed(a)) f.push('隐蔽')
  if (a.shaken) f.push('动摇' + a.shaken)
  if (a.fatigued) f.push('疲惫' + a.fatigued)
  if (a.trapped) f.push('受困' + a.trapped)
  if (a.pinned) f.push('钉死')
  if (a.flanked) f.push('被包抄')
  if (a.fortified) f.push('设防')
  if (a.guarded) f.push('戒备+' + a.guarded)
  if (a.reckless && (a.engagedWith || []).length) f.push('亡命侧击')
  if (a.pcLead) f.push('随军')
  return f
}
// 被击败的军队受到伤害时须通过 DC 16 平值检定，否则被摧毁（战争规则 击败）
const defeatDice = ref('')
const defeatOut = ref('')
function defeatDamageCheck() {
  const a = selArmy.value
  if (!a || !isDefeated(a)) { defeatOut.value = '仅对已击败（HP ≤ 0）的军队适用。'; return }
  const r = Number(defeatDice.value)
  if (!(r >= 1 && r <= 20)) { defeatOut.value = '请填入桌上掷出的 d20（1–20）。'; return }
  if (r >= 16) { defeatOut.value = `${a.name}：DC 16 平值检定 ${r} ≥ 16，通过，未被摧毁。` }
  else {
    a.destroyed = true; a.offBoard = true
    defeatOut.value = `${a.name}：DC 16 平值检定 ${r} < 16，失败，军队被摧毁（损毁，装备一并毁坏）。`
  }
  logCalc('战争遭遇·击败受伤', {
    rule: '若一支被击败的军队受到伤害，它必须成功通过一次 DC 16 的平值检定，否则被摧毁（战争规则 军队状态 / 击败）。d20 由玩家在桌上掷出后录入。',
    input: { 军队: a.name, 平值DC: 16 },
    steps: { 玩家掷出的d20: r },
    output: { 结果: r >= 16 ? '通过' : '被摧毁', 损毁: !!a.destroyed },
  })
  defeatDice.value = ''
}

// ---- 第一轮特殊开局：伏击 / 首轮齐射（战争规则 军队战术）----
const ambushTarget = ref('')
function doAmbush(a) {
  if (round.value !== 1) { pushLog('伏击：仅在战争遭遇第一轮可选。'); return }
  const t = armyOf(ambushTarget.value)
  if (!t || t.offBoard) { pushLog('伏击：请先选择一支敌军。'); return }
  const mine = initTotal(a)
  const its = initTotal(t)
  if (mine !== null && its !== null && its >= mine) { pushLog(`伏击：目标 ${t.name} 的先攻（${its}）不低于本军（${mine}），不合条件。`); return }
  a.ambushTarget = t.id
  engage(a, t)
  logCalc('战争遭遇·伏击开局', {
    rule: '伏击（战术8，散兵）：第一轮若你的回合发生在任何敌军回合之前，可选择以交战状态开始，并在第一轮中对该敌军的第一次攻击上获得 +2 状态加值（战争规则 军队战术）',
    input: { 军队: a.name, 目标: t.name, 本军先攻: mine, 目标先攻: its },
    output: { 状态: '开局即交战', 首次攻击加值: 2 },
  })
  pushLog(`${a.name} 以伏击开局，与 ${t.name} 交战（第一轮对其第一次攻击 +2）`)
}
function doVolley(a) {
  if (round.value !== 1) { pushLog('首轮齐射：仅在战争遭遇第一轮可选。'); return }
  far(a, true)
  logCalc('战争遭遇·首轮齐射开局', {
    rule: '首轮齐射（战术8，骑兵/攻城器械/散兵）：第一轮若你的回合发生在任何敌军回合之前，可选择在遭遇开始时与所有敌军保持远距离（战争规则 军队战术）',
    input: { 军队: a.name },
    output: { 状态: '以远离开局' },
  })
  pushLog(`${a.name} 以首轮齐射开局，与所有敌军保持远距离`)
}

// ---- 火焰射击：远程打击成功后，目标做一次对抗攻击 DC 的机动检定，失败则再受 1 点伤害 ----
const flameTarget = ref('')
const flameDice = ref('')
const flameOut = ref('')
function runFlameShot() {
  const s = selArmy.value
  if (!s || !(s.tactics || []).includes('火焰射击')) { flameOut.value = '选中军队需拥有「火焰射击」战术。'; return }
  const t = armyOf(flameTarget.value)
  if (!t || t.offBoard) { flameOut.value = '请选择目标。'; return }
  const d = Number(flameDice.value)
  if (!(d >= 1 && d <= 20)) { flameOut.value = '请填入桌上掷出的 d20（1–20）。'; return }
  const attackDC = 10 + checkMods(s, '攻击', { ranged: true, target: t }).mod
  const tmod = checkMods(t, '机动').mod
  const total = d + tmod
  const passed = total >= attackDC
  if (!passed) hp(t, -1)
  flameOut.value = `${t.name} 机动检定：${d}${signed(tmod)} = ${total} 对抗攻击 DC ${attackDC} → ${passed ? '通过，不额外受伤' : '失败，额外受 1 点伤害'}（HP ${t.hp}/${t.hpMax}）`
  logCalc('战争遭遇·火焰射击', {
    rule: '火焰射击（战术9）：远程打击成功时，目标须对对抗你军队攻击 DC 的机动检定，失败则该打击造成 1 点额外伤害（战争规则 军队战术）。攻击 DC = 10 + 攻击调整值。',
    input: { 军队: s.name, 目标: t.name, 攻击DC: attackDC, 目标机动调整: tmod },
    steps: { 玩家掷出的d20: d, 检定结果: total },
    output: { 结果: passed ? '通过' : '额外 1 点伤害' },
  })
  flameDice.value = ''
}

// ---- 治疗药水：任何机动动作中使用一份，恢复 1 点 HP（最多 3 份，用后不自动补充）----
function usePotion(a) {
  const i = (a.gear || []).lastIndexOf('治疗药水')
  if (i < 0) { pushLog(`${a.name} 没有治疗药水。`); return }
  a.gear.splice(i, 1)
  hp(a, 1)
  logCalc('战争遭遇·使用治疗药水', {
    rule: '治疗药水（物品1）：军队可在任何机动动作中使用一份药水，恢复 1 点 HP；一支军队一次最多装备 3 份，且不会在战争遭遇后自动补充（战争规则 军队装备）',
    input: { 军队: a.name, 使用前HP: a.hp - 1 },
    output: { HP: `${a.hp}/${a.hpMax}`, 剩余药水: gearCount(a, '治疗药水') },
  })
  pushLog(`${a.name} 使用一份治疗药水：HP +1 → ${a.hp}/${a.hpMax}（剩余 ${gearCount(a, '治疗药水')} 份）`)
}

// ---- 遭遇结算：判定胜利 / 判定失败（基础战争/防御检定，d20 外部录入）----
const warSide = ref('胜利')
const warDice = ref('')
const warConc = ref('动摇')
const warD4 = ref('')
const warOut = ref('')
// 战斗中的玩家角色：开拓者与特定单个敌人单挑的结果，使战争遭遇结果提升／降低一级
const pcOutcome = ref('未参与')
const warDC = computed(() => kingdomControlDC())
const warCheck = computed(() => (warSide.value === '胜利'
  ? { skill: '战争', attr: '忠诚', mod: kingdomSkillMod('战争', '忠诚') }
  : { skill: '防御', attr: '稳定', mod: kingdomSkillMod('防御', '稳定') }))
function warSettle() {
  const d = Number(warDice.value)
  const dc = Number(warDC.value)
  if (!(d >= 1 && d <= 20)) { warOut.value = '请填入桌上掷出的 d20（1–20）。'; return }
  const c = warCheck.value
  const total = d + c.mod
  const anarchy = state.unrest >= anarchyThreshold()
  // 战斗中的玩家角色：开拓者战胜其单挑对手 → 遭遇结果提升一级；战败或敌人逃脱 → 降低一级
  let ti = anarchy ? Math.max(0, tierIndex(total, dc, d) - 1) : tierIndex(total, dc, d)
  if (pcOutcome.value === '开拓者胜') ti = Math.min(3, ti + 1)
  else if (pcOutcome.value === '开拓者败或逃脱') ti = Math.max(0, ti - 1)
  const tier = tierName(ti)
  const mine = state.legions.filter((a) => !a.offBoard)
  const damaged = mine.filter((a) => a.hp < a.hpMax)
  const effects = []
  if (warSide.value === '胜利') { state.marks = state.marks || {}; state.marks.warWon = true }
  if (warSide.value === '胜利') {
    if (tier === '大成功') {
      damaged.forEach((a) => hp(a, 1)); if (damaged.length) effects.push(`受损军队各恢复 1 HP（${damaged.length} 支）`)
      state.fame = Math.min(fameCap(), state.fame + 1); effects.push(`${state.fameKind} +1`)
      state.unrest = Math.max(0, state.unrest - 1); effects.push('动荡 −1')
    } else if (tier === '成功') {
      damaged.forEach((a) => hp(a, 1)); effects.push(damaged.length ? `受损军队各恢复 1 HP（${damaged.length} 支）` : '无受损军队')
    } else if (tier === '大失败') {
      damaged.forEach((a) => (warConc.value === '疲惫' ? tire(a, 1) : shake(a, 1)))
      effects.push(damaged.length ? `受损军队各${warConc.value} +1（${damaged.length} 支）` : '无受损军队')
    } else effects.push('无事')
  } else {
    if (tier === '大成功') {
      mine.forEach((a) => { if (a.hp <= 0 || a.routed) { a.hp = 1; a.routed = false } })
      effects.push('被击败的军队恢复到 1 HP 且不再溃败')
      if (damaged[0]) { hp(damaged[0], 1); effects.push(`${damaged[0].name} 恢复 1 HP`) }
    } else if (tier === '成功') {
      if (damaged[0]) { hp(damaged[0], 1); effects.push(`${damaged[0].name} 恢复 1 HP`) }
      state.unrest += 1; effects.push('动荡 +1')
    } else if (tier === '失败') { state.unrest += 1; effects.push('动荡 +1') }
    else if (tier === '大失败') {
      const dd = Number(warD4.value)
      if (!(dd >= 1 && dd <= 4)) { warOut.value = '判定失败·大失败需填入桌上掷出的 1d4（1–4）作为动荡增量。'; return }
      mine.forEach((a) => (warConc.value === '疲惫' ? tire(a, 2) : shake(a, 2)))
      effects.push(`参战军队各${warConc.value} +2`)
      state.unrest += dd; effects.push(`动荡 +${dd}`)
    }
  }
  warOut.value = `${c.skill}检定：${d}${signed(c.mod)} = ${total} 对抗 DC ${dc} → ${tier}；${effects.join('，') || '无额外效果'}`
  logCalc('战争遭遇·' + (warSide.value === '胜利' ? '判定胜利' : '判定失败'), {
    rule: (warSide.value === '胜利'
      ? '判定胜利：掷一次基础战争检定；大成功为每支受损军队恢复 1HP、下回合获得 1 点声望且动荡 −1；成功为每支受损军队恢复 1HP；大失败使受损军队动摇或疲惫 +1'
      : '判定失败：掷一次基础防御检定；大成功让被击败军队恢复到 1HP 并选一支受损军队恢复 1HP；成功恢复 1 支受损军队 1HP 且动荡 +1；失败动荡 +1；大失败使参战军队动摇或疲惫 +2 且动荡 +1d4')
      + '（王国规则 战争遭遇 / 判定胜利或失败）。d20 由玩家在桌上掷出后录入。',
    input: { 适用技能: c.skill, 关键属性: c.attr, 技能调整值: c.mod, 控制DC: dc, 后果类型: warConc.value, 我方在编: mine.length, 受损军队: damaged.length, 玩家角色单挑: pcOutcome.value },
    formula: '检定结果 = d20 + 技能调整值（属性调整值 + 熟练加值 + 状态加值），对抗控制 DC；玩家角色胜则结果 +1 级、败或敌人逃脱则 −1 级',
    steps: { 玩家掷出的d20: d, 检定结果: total },
    output: { 分级: tier, 结算效果: effects },
  })
  pushLog(`遭遇${warSide.value}判定：${tier}（${effects.join('，') || '无'}）`)
  warDice.value = ''
}
</script>

<template>
  <div class="panel">
    <h2>战争遭遇 · 第 {{ round }} 轮<span class="muted">（每轮代表战场上一小时）</span></h2>
    <div class="row" style="margin-bottom: 6px">
      <div class="field"><label>&nbsp;</label><button class="act" @click="nextRound">进入下一轮</button></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="clearBoard">重置距离与交战</button></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="sel = ''">取消选中</button></div>
    </div>
    <p class="muted">点态势图上的军队选中它，再在下方操作距离、交战与状态。邻近＝只能远程打击；交战＝可近战，最多同时与 4 支交战；远离＝远程打击 −5。</p>
    <p v-if="state.ruleset === 'mouse'" class="muted" style="color: var(--warn)">鼠鼠规则没有团战章节，本页仍使用 PF2e 兵棋数值（d20、AC、RT）；王国层的 2d6 换算只作用于活动与事件检定。</p>

    <details class="more">
      <summary>布场：地形 · 先攻 · 开局 · 工事 · 攻城</summary>

      <h2 style="margin-top: 12px">战场地形与天气<span class="muted">（自动计入机动/侦察/远程检定）</span></h2>
      <div class="row">
        <div class="field"><label>黑暗／浓雾</label><div class="check"><input type="checkbox" v-model="battleTerrain.dark" id="tr-dark" /><label for="tr-dark">侦察 −4（黑暗视觉免疫）</label></div></div>
        <div class="field"><label>困难地形</label><div class="check"><input type="checkbox" v-model="battleTerrain.difficult" id="tr-diff" /><label for="tr-diff">机动 −2（两栖/沼泽居民/水行免疫）</label></div></div>
        <div class="field"><label>微光／薄雾／降雨</label><div class="check"><input type="checkbox" v-model="battleTerrain.dim" id="tr-dim" /><label for="tr-dim">机动 +1、侦察 −2（微光/黑暗视觉免疫）</label></div></div>
        <div class="field"><label>风</label><select v-model="battleTerrain.wind"><option>无</option><option>强风</option><option>风暴</option></select></div>
        <div class="field"><label>风·远程减值</label><div class="num muted">强风 −1／风暴 −2（对远离翻倍）</div></div>
      </div>

      <h2 style="margin-top: 16px">先攻检定<span class="muted">（各军队一次侦察检定；目光锐利 +2、进攻奇策 +2 已自动计入）</span></h2>
      <div class="row">
        <div class="field" v-for="a in allArmies()" :key="'init' + a.id">
          <label>{{ a.name }}<span class="muted">（{{ signed(initMod(a)) }}）</span></label>
          <input type="number" min="1" max="20" v-model="initDice[a.id]" placeholder="d20" style="width: 70px" />
        </div>
      </div>
      <p class="muted" v-if="initOrder.length">行动顺序：{{ initOrder.map((x, i) => (i + 1) + '. ' + x.a.name + '（' + x.total + '）').join('　') }}</p>
      <p class="muted" v-else>填入各军队的 d20 后即显示行动顺序。拥有「伏击」的军队可选择以交战状态开始；拥有「首轮齐射」的军队可选择以远离状态开始。</p>

      <h2 style="margin-top: 16px">第一轮特殊开局<span class="muted">（伏击／首轮齐射，仅第 1 轮）</span></h2>
      <div class="row">
        <div class="field">
          <label>伏击目标（先攻低于本军的敌军）</label>
          <select v-model="ambushTarget" style="min-width: 180px">
            <option value="">选择敌军</option>
            <option v-for="e in state.opponents.filter((x) => !x.offBoard)" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </div>
        <div class="field" v-for="a in state.legions.filter((x) => !x.offBoard && (x.tactics || []).includes('伏击'))" :key="'amb' + a.id">
          <label>{{ a.name }}</label><button class="act" @click="doAmbush(a)">以伏击开局</button>
        </div>
        <div class="field" v-for="a in state.legions.filter((x) => !x.offBoard && (x.tactics || []).includes('首轮齐射'))" :key="'vol' + a.id">
          <label>{{ a.name }}</label><button class="act" @click="doVolley(a)">以首轮齐射开局</button>
        </div>
      </div>
      <p class="muted">仅拥有对应战术的军队会在此出现；不是第 1 轮时按钮无效。</p>

      <h2 style="margin-top: 16px">防御工事<span class="muted">（城堡 AC30/HP8/6 支 · 主堡 AC25/HP5/4 支 · 塔楼 AC20/HP2/1 支）</span></h2>
      <div class="row">
        <div class="field"><label>类型</label><select v-model="fortType"><option>城堡</option><option>主堡</option><option>塔楼</option></select></div>
        <div class="field"><label>归属</label><select v-model="fortSide"><option value="enemy">敌方</option><option value="ally">我方</option></select></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="addFort">加入战场</button></div>
      </div>
      <div class="row" v-if="(state.fortifications || []).length">
        <div class="field" v-for="f in state.fortifications" :key="f.id">
          <label>{{ f.name }}（{{ f.side === 'ally' ? '我方' : '敌方' }}）</label>
          <div class="num muted">AC {{ f.ac }} · HP {{ f.hp }}/{{ f.hpMax }} · 容纳 {{ f.cap }} 支<span v-if="f.destroyed"> · 已摧毁</span></div>
          <button class="act mini" @click="damageFort(f, -1)">−1</button>
          <button class="act mini" @click="damageFort(f, 1)">＋1</button>
          <button class="act mini" @click="destroyFort(f)">摧毁</button>
          <button class="act mini" @click="dropFort(f.id)">移出</button>
        </div>
      </div>
      <p class="muted" v-else>战场上还没有防御工事。工事需在王国回合用「驻防军队」活动提前准备；战斗开始后不能再寻求工事庇护。</p>

      <div class="row" v-if="selArmy">
        <div class="field">
          <label>攻城（选中军队：{{ selArmy.name }}）</label>
          <select v-model="siegeFort" style="min-width: 160px">
            <option value="">选择目标工事</option>
            <option v-for="f in fortsOf(sideOf(selArmy) === 'ally' ? 'enemy' : 'ally')" :key="f.id" :value="f.id">{{ f.name }}（AC {{ f.ac }}，HP {{ f.hp }}）</option>
          </select>
        </div>
        <div class="field"><label>桌上掷出的 d20</label><input type="number" min="1" max="20" v-model="siegeDice" style="width: 80px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="runSiege">轰击工事</button></div>
        <div class="field"><label>攻城资格</label><div class="num muted">{{ canSiege(selArmy) ? '可攻城' : '非攻城军队' }}</div></div>
      </div>
      <p class="muted" v-if="siegeOut">{{ siegeOut }}</p>
    </details>

    <div class="boardwrap" v-if="state.legions.length || state.opponents.length">
      <svg :viewBox="`0 0 ${board.W} ${board.H}`" :width="board.W" :height="board.H" class="board">
        <rect x="0" y="0" :width="board.W" :height="board.H" fill="transparent" @click="sel = ''" />
        <text x="18" y="24" class="zone">远离区（远程打击 −5）</text>
        <text x="18" :y="MAIN_TOP - 12" class="zone">战场 · 我方</text>
        <text :x="board.W - 18" :y="MAIN_TOP - 12" class="zone" text-anchor="end">战场 · 敌方</text>
        <line v-for="(ln, i) in board.lines" :key="'l' + i" :x1="ln.x1" :y1="ln.y1" :x2="ln.x2" :y2="ln.y2" class="engage" />
        <g v-for="a in [...state.legions, ...state.opponents].filter((x) => !x.offBoard)" :key="a.id"
           class="node" :class="{ enemy: !state.legions.includes(a), sel: sel === a.id, routed: a.routed, far: a.far }"
           @click.stop="select(a.id)">
          <rect :x="board.nodes[a.id].x" :y="board.nodes[a.id].y" :width="NODE_W" :height="NODE_H" rx="6" />
          <text :x="board.nodes[a.id].x + 10" :y="board.nodes[a.id].y + 21" class="nm">{{ a.name }}</text>
          <text :x="board.nodes[a.id].x + 10" :y="board.nodes[a.id].y + 40" class="st">
            HP {{ a.hp }}/{{ a.hpMax }} · AC {{ statsOf(a).ac }} · 动作 {{ a.actionsUsed }}/3{{ flags(a).length ? ' · ' + flags(a).join(' ') : '' }}
          </text>
        </g>
      </svg>
    </div>
    <p class="muted" v-else>还没有军队。先到「组建军团」建军，或在下面添加敌军。</p>
    <p class="muted" v-if="[...state.legions, ...state.opponents].some((a) => a.offBoard)">已撤离战场：{{ [...state.legions, ...state.opponents].filter((a) => a.offBoard).map((a) => a.name).join('，') }}</p>

    <details class="more">
      <summary>敌军录入</summary>
      <div class="row" style="margin-top: 8px">
        <div class="field">
          <label>从兵种添加（自动填数值）</label>
          <select v-model="oppKey" style="min-width: 200px">
            <option value="">请选择兵种</option>
            <option v-for="a in armies" :key="a.name" :value="a.name">{{ a.name }}（{{ a.type }}，{{ a.level }} 级）</option>
          </select>
        </div>
        <div class="field"><label>采用等级（留空用兵种原级）</label><input type="number" min="1" max="20" v-model="oppLevel" style="width: 80px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="addEnemy">添加敌军</button></div>
        <div class="field"><label>自定义敌军名称</label><input v-model="oppCustom" placeholder="如 野蛮人战团" style="width: 160px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="addCustomEnemy">添加自定义</button></div>
      </div>
    </details>

    <div v-if="selArmy" class="ops">
      <h2 style="margin-top: 18px">选中：{{ selArmy.name }}<span class="muted"> · {{ state.legions.includes(selArmy) ? '我方' : '敌方' }}</span></h2>
      <p class="muted">侦察 {{ statsOf(selArmy).scout }}｜AC {{ statsOf(selArmy).ac }}｜机动 {{ statsOf(selArmy).maneuver }}｜士气 {{ statsOf(selArmy).morale }}｜近战 {{ statsOf(selArmy).melee || '—' }}｜远程 {{ statsOf(selArmy).ranged || '—' }}</p>

      <details class="more">
        <summary>军队属性（改名 · 改级 · 改上限）</summary>
        <div class="opblock" style="margin-top: 8px">
          <label class="lbl">名称</label>
          <input v-model="selArmy.name" style="width: 150px" />
          <template v-if="selArmy.armyKey">
            <label class="lbl">等级</label>
            <input type="number" min="1" max="20" v-model.number="selArmy.level" style="width: 68px" />
          </template>
          <template v-else>
            <label class="lbl">侦察</label><input v-model="selArmy.scout0" style="width: 58px" />
            <label class="lbl">AC</label><input v-model="selArmy.ac0" style="width: 50px" />
            <label class="lbl">机动</label><input v-model="selArmy.maneuver0" style="width: 62px" />
            <label class="lbl">士气</label><input v-model="selArmy.morale0" style="width: 62px" />
          </template>
          <label class="lbl">HP 上限</label><input type="number" v-model.number="selArmy.hpMax" style="width: 58px" />
          <label class="lbl">RT</label><input type="number" v-model.number="selArmy.rt" style="width: 58px" />
        </div>
      </details>

      <div class="opblock">
        <label class="lbl">距离</label>
        <button class="act" :class="{ on: selArmy.far }" @click="setFar(selArmy, !selArmy.far)">{{ selArmy.far ? '当前：远离（点此回到战场）' : '当前：战场（点此撤到远离）' }}</button>

        <label class="lbl">交战（最多 4）</label>
        <template v-if="!selArmy.far">
          <label class="chk" v-for="b in [...state.legions, ...state.opponents].filter(x => x.id !== selArmy.id && (state.legions.includes(selArmy) ? !state.legions.includes(x) : state.legions.includes(x)))" :key="b.id">
            <input type="checkbox" :checked="engaged(selArmy, b.id)" @change="toggleEngage(selArmy, b.id)" />
            {{ b.name }}<span class="muted" v-if="b.far">（远离，需先推进）</span>
          </label>
          <span class="muted">当前 {{ (selArmy.engagedWith || []).length }} 支</span>
        </template>
        <span class="muted" v-else>远离状态无法交战。</span>
      </div>

      <div class="opblock">
        <label class="lbl">动摇</label>
        <button class="act mini" @click="addShaken(selArmy, -1)">−</button>
        <span class="num">{{ selArmy.shaken || 0 }}</span>
        <button class="act mini" @click="addShaken(selArmy, 1)">＋</button>
        <span class="muted" v-if="(selArmy.shaken || 0) >= 4">已达 4，自动溃败</span>

        <label class="lbl">疲惫</label>
        <button class="act mini" @click="addFatigue(selArmy, -1)">−</button>
        <span class="num">{{ selArmy.fatigued || 0 }}</span>
        <button class="act mini" @click="addFatigue(selArmy, 1)">＋</button>

        <label class="lbl">受困</label>
        <button class="act mini" @click="trap(selArmy, -1)">−</button>
        <span class="num">{{ selArmy.trapped || 0 }}</span>
        <button class="act mini" @click="trap(selArmy, 1)">＋</button>
        <span class="muted" v-if="(selArmy.trapped || 0) >= 4">已达 4：钉死</span>

        <label class="lbl">HP</label>
        <button class="act mini" @click="damage(selArmy, -1)">−1</button>
        <button class="act mini" @click="damage(selArmy, -2)">−2</button>
        <button class="act mini" @click="damage(selArmy, 1)">＋1</button>
        <span class="num">{{ selArmy.hp }}/{{ selArmy.hpMax }}</span>
        <span class="muted">RT {{ effectiveRT(selArmy) === null ? '—' : effectiveRT(selArmy) }}{{ (selArmy.tactics || []).includes('坚守阵线') ? '（坚守阵线：HP/4）' : '' }}</span>
        <span class="muted">· 有效 AC {{ effectiveAC(selArmy) }}</span>

        <label class="lbl">治疗药水</label>
        <button class="act mini" :disabled="!gearCount(selArmy, '治疗药水')" @click="usePotion(selArmy)">使用一份（恢复 1 HP）</button>
        <span class="num">{{ gearCount(selArmy, '治疗药水') }} / 3</span>

        <template v-if="isDefeated(selArmy)">
          <label class="lbl">被击败受伤</label>
          <span class="muted">须 DC 16 平值检定</span>
          <input type="number" min="1" max="20" v-model="defeatDice" style="width: 70px" />
          <button class="act" @click="defeatDamageCheck">结算</button>
        </template>

        <label class="lbl">本轮攻击次数</label>
        <span class="num">{{ selArmy.attackCount || 0 }}</span>
        <span class="muted">（多重攻击减值 下次 {{ multiAttackPenalty(selArmy) || 0 }}）</span>
        <button class="act mini" @click="selArmy.attackCount = 0">重置</button>

        <label class="lbl">本回合动作</label>
        <button class="act mini" @click="useAction(selArmy)">用 1</button>
        <button class="act mini" @click="resetActions(selArmy)">重置</button>
        <span class="num">{{ selArmy.actionsUsed || 0 }} / 3</span>

        <label class="lbl">远程弹药</label>
        <button class="act mini" @click="useAmmo(selArmy, 1)">用 1</button>
        <button class="act mini" @click="useAmmo(selArmy, -1)">−</button>
        <span class="num">{{ selArmy.ammoUsed || 0 }} / {{ rangedMax(selArmy) }}</span>

        <label class="lbl">　</label>
        <button class="act" @click="dropArmy(selArmy.id)">移出战场</button>
      </div>

      <details class="more">
        <summary>其他状态</summary>
        <div class="opblock" style="margin-top: 8px">
          <button class="act" :class="{ on: selArmy.routed }" @click="selArmy.routed = !selArmy.routed">溃败</button>
          <button class="act" :class="{ on: selArmy.flanked }" @click="selArmy.flanked = !selArmy.flanked">被包抄</button>
          <button class="act" :class="{ on: selArmy.fortified }" @click="selArmy.fortified = !selArmy.fortified">设防</button>
          <button class="act" :class="{ on: selArmy.pinned }" @click="selArmy.pinned = !selArmy.pinned">钉死</button>
          <button class="act" :class="{ on: selArmy.pcLead }" @click="selArmy.pcLead = !selArmy.pcLead">开拓者随军（士气 +1）</button>
          <button class="act" :class="{ on: selArmy.destroyed }" @click="selArmy.destroyed = !selArmy.destroyed">损毁</button>
          <button class="act" :class="{ on: selArmy.misplaced }" @click="selArmy.misplaced = !selArmy.misplaced">失散</button>
          <button class="act" :class="{ on: selArmy.efficient }" @click="selArmy.efficient = !selArmy.efficient">高效</button>
        </div>
      </details>

      <h2 style="margin-top: 18px">动作检定<span class="muted">（d20 由桌上掷出后录入）</span></h2>
      <div class="row">
        <div class="field">
          <label>检定类型</label>
          <select v-model="rKind"><option>侦察</option><option>机动</option><option>士气</option><option>攻击</option></select>
        </div>
        <div class="field"><label>基础调整（自动）</label><div class="num">{{ rPreview ? signed(rPreview.mod) : '—' }}</div></div>
        <div class="field"><label>额外调整</label><input type="number" v-model.number="rExtra" style="width: 80px" /></div>
        <div class="field">
          <label>对抗范围/精神攻击</label>
          <div class="check"><input type="checkbox" v-model="saveVsAoe" id="save-aoe" /><label for="save-aoe">骑兵碾压：机动/士气豁免 −1（骑兵专精 12 级免疫）</label></div>
        </div>
        <div class="field"><label>对抗 DC</label><input type="number" v-model="rDC" style="width: 80px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="rDCSuggest === null" @click="useRDCSuggest">建议 DC{{ rDCSuggest !== null ? '（' + rDCSuggest + '）' : '' }}</button></div>
        <div class="field"><label>桌上掷出的 d20</label><input type="number" min="1" max="20" v-model="rDice" style="width: 80px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="resolveCheck">结算检定</button></div>
      </div>
      <p class="muted" v-if="rPreview && rPreview.notes.length">自动减值：{{ rPreview.notes.join('，') }}</p>
      <p v-if="rOut" class="muted" style="margin-top: 8px">{{ rOut }}</p>

      <details class="more">
        <summary>已学战术（{{ (selArmy.tactics || []).length }}{{ maxTacticsOf(selArmy) !== null ? ' / ' + maxTacticsOf(selArmy) : '' }}）</summary>
        <div class="opblock" style="margin-top: 8px">
          <span class="chip" v-for="t in selArmy.tactics || []" :key="t">{{ t }}<button class="x" @click="removeTactic(selArmy, t)">×</button></span>
          <span class="muted" v-if="!(selArmy.tactics || []).length">（无）</span>
          <select v-model="addTacticSel" style="min-width: 200px">
            <option value="">选择要学习的战术…</option>
            <option v-for="t in eligibleTactics(selArmy)" :key="t.name" :value="t.name">{{ t.name }}（{{ t.requirement }}）</option>
          </select>
          <button class="act" @click="addTactic(selArmy)">学习</button>
        </div>
      </details>

      <h2 style="margin-top: 18px">战术动作<span class="muted">（点动作 → 选目标 → 录 d20 → 结算）</span></h2>
      <div class="actgrid">
        <button v-for="ac in usableActions" :key="ac.key" class="act" :class="{ on: actKey === ac.key }" @click="pickAction(ac)">
          {{ ac.key }}<span class="muted" v-if="ac.cost"> · {{ ac.cost }}动作</span>
        </button>
      </div>
      <p class="muted" v-if="!usableActions.length">当前没有可用的战术动作。</p>
      <details class="more" v-if="blockedActions.length" style="margin-top: 8px">
        <summary>暂无可用（{{ blockedActions.length }}）</summary>
        <p class="muted" v-for="ac in blockedActions" :key="'bl' + ac.key" style="margin: 6px 0 0">{{ ac.key }}：{{ actionBlock(selArmy, ac) }}</p>
      </details>
      <template v-if="curAct">
        <p class="prose" style="margin: 8px 0">{{ curAct.txt }}<span class="muted" v-if="curAct.req">（需求：{{ curAct.req }}）</span><span class="warn" v-if="actionBlock(selArmy, curAct)">　未满足：{{ actionBlock(selArmy, curAct) }}</span></p>
        <div class="row">
          <div class="field" v-if="curAct.target !== 'none'">
            <label>目标</label>
            <select v-model="actTarget" style="min-width: 180px">
              <option value="">请选择</option>
              <option v-for="x in targetsFor(curAct)" :key="x.id" :value="x.id">{{ x.name }}</option>
            </select>
          </div>
          <div class="field" v-if="curAct.protect">
            <label>保护友军</label>
            <select v-model="actProtect" style="min-width: 180px">
              <option value="">请选择</option>
              <option v-for="x in allyTargets(curAct)" :key="x.id" :value="x.id">{{ x.name }}</option>
            </select>
          </div>
          <div class="field" v-if="curAct.key === '推进' && (selArmy.tactics || []).includes('亡命侧击')">
            <label>亡命侧击</label>
            <div class="check"><input type="checkbox" v-model="useReckless" id="reckless" /><label for="reckless">AC −2 换攻击 +1（持续到不再交战）</label></div>
          </div>
          <div class="field">
            <label>检定</label>
            <div class="num muted">{{ curAct.check ? (curAct.fixedDC ? curAct.check + ' DC ' + curAct.fixedDC : curAct.check + '（对抗目标 DC/AC）') : '无需检定' }}</div>
          </div>
          <div class="field" v-if="curAct.check"><label>桌上掷出的 d20</label><input type="number" min="1" max="20" v-model="actDice" style="width: 80px" /></div>
          <div class="field"><label>&nbsp;</label><button class="act" @click="resolveAction">结算动作</button></div>
        </div>
        <p v-if="actOut" class="muted" style="margin-top: 8px">{{ actOut }}</p>
      </template>

      <h2 v-if="(selArmy.tactics || []).includes('火焰射击')" style="margin-top: 18px">火焰射击追加伤害<span class="muted">（远程打击成功后，目标做对抗攻击 DC 的机动检定）</span></h2>
      <div class="row" v-if="(selArmy.tactics || []).includes('火焰射击')">
        <div class="field">
          <label>目标</label>
          <select v-model="flameTarget" style="min-width: 180px">
            <option value="">请选择</option>
            <option v-for="x in targetsFor({ target: 'enemy' })" :key="x.id" :value="x.id">{{ x.name }}</option>
          </select>
        </div>
        <div class="field"><label>目标桌上掷出的 d20（机动）</label><input type="number" min="1" max="20" v-model="flameDice" style="width: 90px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="runFlameShot">结算追加伤害</button></div>
      </div>
      <p class="muted" v-if="flameOut">{{ flameOut }}</p>
    </div>

    <h2 style="margin-top: 18px">遭遇结算<span class="muted">（基础战争 / 防御检定，d20 桌上掷出后录入）</span></h2>
    <div class="row">
      <div class="field"><label>结果</label><select v-model="warSide"><option>胜利</option><option>失败</option></select></div>
      <div class="field"><label>适用检定</label><div class="num muted">{{ warCheck.skill }}（{{ warCheck.attr }}）{{ signed(warCheck.mod) }} · 控制 DC {{ warDC }}</div></div>
      <div class="field"><label>状态类型</label><select v-model="warConc"><option>动摇</option><option>疲惫</option></select></div>
      <div class="field">
        <label>玩家角色单挑</label>
        <select v-model="pcOutcome"><option>未参与</option><option>开拓者胜</option><option>开拓者败或逃脱</option></select>
      </div>
      <div class="field"><label>桌上掷出的 d20</label><input type="number" min="1" max="20" v-model="warDice" style="width: 80px" /></div>
      <div class="field"><label>1d4（仅失败·大失败）</label><input type="number" min="1" max="4" v-model="warD4" style="width: 70px" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="warSettle">结算遭遇</button></div>
    </div>
    <p v-if="warOut" class="muted" style="margin-top: 8px">{{ warOut }}</p>

    <h2 style="margin-top: 18px">需检查溃败的军队</h2>
    <p class="muted" v-if="needMorale.length">{{ needMorale.map((a) => `${a.name}（HP ${a.hp} ≤ RT ${effectiveRT(a)}）`).join('，') }}</p>
    <p class="muted" v-else>没有军队处于溃败阈值或以下。</p>
    <div class="row" v-if="needMorale.length" style="margin-top: 8px">
      <div class="field">
        <label>结算哪支</label>
        <select v-model="routArmy" style="min-width: 160px">
          <option value="">选择</option>
          <option v-for="a in needMorale" :key="a.id" :value="a.id">{{ a.name }}（HP {{ a.hp }} ≤ RT {{ effectiveRT(a) }}）</option>
        </select>
      </div>
      <div class="field"><label>桌上掷出的士气 d20</label><input type="number" min="1" max="20" v-model="routDice" style="width: 90px" /></div>
      <div class="field"><label>&nbsp;</label><button class="act" @click="resolveRout">结算溃败检查</button></div>
    </div>
    <p class="muted" v-if="routOut">{{ routOut }}</p>

    <p class="muted">战争流程、地形与状态的完整规则见查询页「战争关键规则」。</p>
  </div>
</template>

<style scoped>
.boardwrap { overflow-x: auto; border: 1px solid var(--rule-soft); border-radius: 6px; background: var(--wash-ochre); }
.board { display: block; }
.board text { font-family: inherit; }
.board .zone { fill: var(--ink-2); font-size: 12px; }
.board .engage { stroke: var(--warn); stroke-width: 2; stroke-dasharray: 4 3; }
.node rect { fill: var(--cover-old); stroke: var(--rule-soft); stroke-width: 1; cursor: pointer; }
.node.enemy rect { fill: var(--wash-damage); }
.node.sel rect { stroke: var(--ochre); stroke-width: 2.5; }
.node.routed rect { opacity: 0.55; }
.node.far rect { fill: var(--rule-soft); }
.node .nm { font-size: 13px; font-weight: 600; fill: var(--ink); pointer-events: none; }
.node .st { font-size: 12px; fill: var(--ink-2); pointer-events: none; }
.ops { margin-top: 6px; }
.opblock { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; padding: 8px 10px; border: 1px solid var(--rule-soft); border-radius: 6px; }
.opblock .lbl { font-size: 12px; color: var(--ink-2); min-width: 84px; }
.chk { font-size: 13px; margin-right: 10px; }
.actgrid { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.actgrid .act { padding: 4px 9px; }
.chip { display: inline-flex; align-items: center; font-size: 12px; padding: 1px 4px 1px 6px; border: 1px solid var(--rule-soft); border-radius: 3px; background: var(--cover-old); }
.chip .x { appearance: none; border: 0; background: transparent; color: var(--ink-2); cursor: pointer; font: inherit; padding: 0 3px; margin-left: 4px; }
.chip .x:hover { color: var(--warn); }
.warn { color: var(--warn); }
.act.on { border-color: var(--ochre); color: var(--ochre); background: var(--cover-old); }
.act.mini { padding: 3px 9px; }
.num { font-variant-numeric: tabular-nums; padding: 0 4px; }
select, input { padding: 5px 7px; }
</style>
