import armiesByLevel from './data/armiesByLevel.json' with { type: 'json' }

// 军队数值派生：军团与敌军共用同一套逻辑。
// 有 baseLevel 时按「基础军队按等级」表派生；baseLevel 为空（自定义）则直接用手填的 *0 字段。
export function num(s) { const m = String(s ?? '').match(/-?\d+/); return m ? Number(m[0]) : 0 }
export function signed(n) { return (n >= 0 ? '+' : '') + n }
export function levelRow(lv) { return armiesByLevel.find((r) => r.level === lv) }
export function rescaleAttack(str, d) {
  if (!str) return ''
  return str.replace(/([+\-]?\d+)/, (m) => signed(Number(m) + d))
}

export function statsOf(a) {
  const b = levelRow(a.baseLevel) || levelRow(a.level)
  const t = levelRow(a.level) || b
  if (!b || !t) {
    return { scout: a.scout0 || '', ac: a.ac0 || '', maneuver: a.maneuver0 || '', morale: a.morale0 || '', melee: a.melee0 || '', ranged: a.ranged0 || '', maxTactics: '—' }
  }
  const manHigh = /高/.test(a.maneuver0 || '')
  const dHigh = num(t.highSave) - num(b.highSave)
  const dLow = num(t.lowSave) - num(b.lowSave)
  return {
    scout: signed(num(a.scout0) + (num(t.scout) - num(b.scout))),
    ac: String(num(a.ac0) + (t.ac - b.ac)),
    maneuver: signed(num(a.maneuver0) + (manHigh ? dHigh : dLow)) + (manHigh ? '（高）' : '（低）'),
    morale: signed(num(a.morale0) + (manHigh ? dLow : dHigh)) + (manHigh ? '（低）' : '（高）'),
    melee: rescaleAttack(a.melee0, num(t.attack) - num(b.attack)),
    ranged: rescaleAttack(a.ranged0, num(t.attack) - num(b.attack)),
    maxTactics: t.maxTactics,
  }
}

// 军队的结构化状态字段默认值
// 交战/距离/动摇/疲惫/受困/被包抄/设防/戒备/动作计数/弹药/战术/装备/开拓者随军/先攻加值/本轮攻击次数
// 另含：损毁(destroyed)、失散(misplaced)、高效(efficient)；击败(defeated)由 HP ≤ 0 派生
export function statusDefaults() {
  return {
    far: false, engagedWith: [], shaken: 0, fatigued: 0, trapped: 0, routed: false,
    flanked: false, fortified: false, guarded: 0, offBoard: false,
    actionsUsed: 0, ammoUsed: 0, tactics: [], gear: [], location: '',
    pcLead: false, initBonus: 0, attackCount: 0, routImmune: false,
    destroyed: false, misplaced: false, efficient: false,
  }
}
// 击败：HP 降到 0 即陷入击败状态
export function isDefeated(a) { return (a && a.hp) <= 0 }

// 军队类型：步兵/骑兵/散兵/攻城器械。
// 数据里的 type 表示「基础兵种/特种兵」，不能直接拿来判兵种；旧存档也没有 unitType，
// 因此优先读 unitType，其次读具体 type，最后按兵种名兜底。
export const UNIT_TYPES = ['步兵', '骑兵', '散兵', '攻城器械']
const SPECIAL_UNIT_TYPES = { 蜥蜴人守卫: '散兵', 诺门斥候: '骑兵' }
export function unitTypeOf(a) {
  if (!a) return ''
  if (UNIT_TYPES.includes(a.unitType)) return a.unitType
  if (UNIT_TYPES.includes(a.type)) return a.type
  const n = String(a.armyKey || a.name || '')
  if (SPECIAL_UNIT_TYPES[n]) return SPECIAL_UNIT_TYPES[n]
  if (/骑兵/.test(n)) return '骑兵'
  if (/斥候/.test(n)) return '散兵'
  if (/炮手|攻城/.test(n)) return '攻城器械'
  return '步兵'
}

// 装备的数值效果：魔法护甲使 AC +1、魔法武器使打击 +1（取下装备名称列表，越强的版本覆盖越弱的）
export function gearACBonus(a) {
  const g = (a && a.gear) || []
  if (g.includes('上等魔法护甲')) return 3
  if (g.includes('高等魔法护甲')) return 2
  if (g.includes('魔法护甲')) return 1
  return 0
}
export function gearAttackBonus(a) {
  const g = (a && a.gear) || []
  if (g.includes('上等魔法武器')) return 3
  if (g.includes('高等魔法武器')) return 2
  if (g.includes('魔法武器')) return 1
  return 0
}

// 有效溃败阈值：坚守阵线（战术）使溃败阈值等于总生命值的 1/4（向上取整），否则用兵种数据块的 RT
export function effectiveRT(a) {
  if (a && (a.tactics || []).includes('坚守阵线')) return Math.ceil((a.hpMax || 0) / 4)
  return a ? a.rt : null
}
// 装备件数（治疗药水可重复携带，一支军队最多 3 份）
export function gearCount(a, name) {
  return ((a && a.gear) || []).filter((x) => x === name).length
}
// 额外武器：记录形如「额外武器（远程）」，返回该军队已配置的额外武器类型
export function extraWeaponKinds(a) {
  const out = []
  for (const g of (a && a.gear) || []) {
    const m = String(g).match(/^额外武器（(近战|远程)）$/)
    if (m) out.push(m[1])
  }
  return out
}
