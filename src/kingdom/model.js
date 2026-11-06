// 王国经营的数据模型与纯逻辑：不依赖 Vue，便于单元测试。
// 建筑与效果全部走数据表，界面改表即时生效；存档只保存这张表和当前局面。

export const VERSION = 2

export const BUILDING_TIERS = [
  { id: 'village', label: '村庄' },
  { id: 'town', label: '城镇' },
  { id: 'city', label: '城市' },
]

export const SETTLEMENT_TYPES = {
  village: { id: 'village', label: '村庄', slots: 4, basePop: 20, tiers: ['village'], next: 'town' },
  town: { id: 'town', label: '城镇', slots: 8, basePop: 30, tiers: ['village', 'town'], next: 'city' },
  city: { id: 'city', label: '城市', slots: 12, basePop: 45, tiers: ['village', 'town', 'city'], next: null },
}

// 调节旋钮：只改结算口径，不动建筑定义本身
export const COMPACT_SLOTS = { village: 3, town: 6, city: 9 }

export const GROWTH_RATES = {
  slow: { id: 'slow', label: '慢速', divisor: 8, costMultiplier: 1.5 },
  normal: { id: 'normal', label: '标准', divisor: 6, costMultiplier: 1 },
  fast: { id: 'fast', label: '快速', divisor: 4, costMultiplier: 0.75 },
}

export function defaultOptions() {
  return { growth: 'normal', compactSlots: false, singleResource: false, pressure: false }
}

export const EFFECT_KINDS = [
  { id: 'population', label: '人口', hint: '加定居点人口，同时影响税收与劳力骰。' },
  { id: 'labor', label: '劳力骰', hint: '给全王国加劳力骰，每颗 d6。' },
  { id: 'incomeP', label: 'p收入', hint: '给国库加 p。' },
  { id: 'incomeMaterial', label: '物资收入', hint: '给物资池加物资。' },
  { id: 'slots', label: '槽位', hint: '加减定居点的槽位上限。' },
  { id: 'note', label: '说明', hint: '只展示，不参与数值计算。' },
]

const EFFECT_IDS = {
  population: 'population',
  labor: 'labor',
  p: 'p',
  material: 'material',
  slots: 'slots',
  note: 'note',
}

export function defaultEffectDefs() {
  return [
    { id: EFFECT_IDS.population, label: '人口', unit: '人', kind: 'population' },
    { id: EFFECT_IDS.labor, label: '劳力骰', unit: '颗', kind: 'labor' },
    { id: EFFECT_IDS.p, label: 'p', unit: 'p', kind: 'incomeP' },
    { id: EFFECT_IDS.material, label: '物资', unit: '物资', kind: 'incomeMaterial' },
    { id: EFFECT_IDS.slots, label: '槽位', unit: '槽', kind: 'slots' },
    { id: EFFECT_IDS.note, label: '说明', unit: '', kind: 'note' },
  ]
}

export function defaultBuildingDefs() {
  return [
    {
      id: 'house', name: '民居', tier: 'village', slots: 1, labor: 3, p: 20, materials: 0,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [{ type: EFFECT_IDS.population, value: 5 }],
    },
    {
      id: 'farm', name: '产地', tier: 'village', slots: 1, labor: 3, p: 10, materials: 0,
      limitPerSettlement: 0, requiresWater: false, description: '建时选农田、林场或矿场',
      effects: [{ type: EFFECT_IDS.material, value: 2 }],
    },
    {
      id: 'market', name: '市集', tier: 'village', slots: 1, labor: 4, p: 30, materials: 0,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [{ type: EFFECT_IDS.p, value: 10 }],
    },
    {
      id: 'road', name: '道路', tier: 'village', slots: 1, labor: 4, p: 15, materials: 0,
      limitPerSettlement: 1, requiresWater: false, description: '每定居点限1条',
      effects: [{ type: EFFECT_IDS.labor, value: 1 }],
    },
    {
      id: 'workshop', name: '作坊', tier: 'town', slots: 1, labor: 5, p: 20, materials: 2,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [{ type: EFFECT_IDS.p, value: 15 }],
    },
    {
      id: 'school', name: '学堂', tier: 'town', slots: 1, labor: 6, p: 40, materials: 2,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [{ type: EFFECT_IDS.labor, value: 1 }],
    },
    {
      id: 'dock', name: '码头', tier: 'town', slots: 1, labor: 5, p: 30, materials: 2,
      limitPerSettlement: 0, requiresWater: true, description: '需临水',
      effects: [{ type: EFFECT_IDS.p, value: 20 }],
    },
    {
      id: 'town_hall', name: '镇公所', tier: 'town', slots: 2, labor: 8, p: 80, materials: 3,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [
        { type: EFFECT_IDS.population, value: 10 },
        { type: EFFECT_IDS.labor, value: 1 },
      ],
    },
    {
      id: 'grand_market', name: '大市集', tier: 'city', slots: 2, labor: 8, p: 100, materials: 4,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [{ type: EFFECT_IDS.p, value: 30 }],
    },
    {
      id: 'university', name: '大学', tier: 'city', slots: 2, labor: 10, p: 120, materials: 5,
      limitPerSettlement: 1, requiresWater: false, description: '每定居点限1座',
      effects: [{ type: EFFECT_IDS.labor, value: 2 }],
    },
    {
      id: 'theater', name: '剧院', tier: 'city', slots: 2, labor: 8, p: 80, materials: 4,
      limitPerSettlement: 1, requiresWater: false, description: '每定居点限1座',
      effects: [
        { type: EFFECT_IDS.population, value: 10 },
        { type: EFFECT_IDS.p, value: 15 },
      ],
    },
    {
      id: 'palace', name: '宫殿', tier: 'city', slots: 3, labor: 12, p: 200, materials: 8,
      limitPerSettlement: 1, requiresWater: false, description: '每定居点限1座',
      effects: [
        { type: EFFECT_IDS.population, value: 20 },
        { type: EFFECT_IDS.p, value: 20 },
        { type: EFFECT_IDS.labor, value: 2 },
      ],
    },
  ].map((def) => ({ alias: '', ...def }))
}

function capitalSettlement() {
  return {
    id: 'capital',
    name: '首都',
    alias: '',
    type: 'village',
    water: true,
    hexes: [],
    buildings: [{ id: 'capital_house', defId: 'house' }],
  }
}

export function defaultKingdomState() {
  return {
    version: VERSION,
    treasury: 60,
    materials: 4,
    laborPoints: 0,
    options: defaultOptions(),
    settlements: [capitalSettlement()],
    buildingDefs: defaultBuildingDefs(),
    effectDefs: defaultEffectDefs(),
    log: [{ id: 'log_start', text: '开局：首都一处村庄，国库60p，物资4。劳力骰数量仅作提示，外部掷好后填入点数。' }],
  }
}

let idSeq = 0
export function makeId(prefix = 'id') {
  idSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const numOf = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
const intOf = (v, fallback, min = 0) => Math.max(min, Math.floor(numOf(v, fallback)))
const textOf = (v, fallback = '') => (typeof v === 'string' ? v : fallback)

function uniqueId(list, id, prefix) {
  const seen = new Set(list.map((x) => x.id))
  let next = id && !seen.has(id) ? id : makeId(prefix)
  while (seen.has(next)) next = makeId(prefix)
  return next
}

export function normalizeOptions(raw) {
  const base = defaultOptions()
  if (!isObj(raw)) return base
  return {
    growth: GROWTH_RATES[raw.growth] ? raw.growth : base.growth,
    compactSlots: raw.compactSlots === true,
    singleResource: raw.singleResource === true,
    pressure: raw.pressure === true,
  }
}

export function normalizeEffectDefs(raw) {
  if (!Array.isArray(raw)) return defaultEffectDefs()
  const out = []
  for (const item of raw) {
    if (!isObj(item)) continue
    const kind = EFFECT_KINDS.some((k) => k.id === item.kind) ? item.kind : 'note'
    out.push({
      id: uniqueId(out, textOf(item.id), 'fx'),
      label: textOf(item.label, '效果'),
      unit: textOf(item.unit, ''),
      kind,
    })
  }
  return out
}

function normalizeEffects(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!isObj(item)) continue
    const type = textOf(item.type)
    if (!type) continue
    out.push({ type, value: numOf(item.value, 0) })
  }
  return out
}

export function normalizeBuildingDefs(raw) {
  if (!Array.isArray(raw)) return defaultBuildingDefs()
  const out = []
  for (const item of raw) {
    if (!isObj(item)) continue
    const tier = BUILDING_TIERS.some((t) => t.id === item.tier) ? item.tier : 'village'
    out.push({
      id: uniqueId(out, textOf(item.id), 'def'),
      name: textOf(item.name, '未命名建筑'),
      alias: textOf(item.alias, ''),
      tier,
      slots: intOf(item.slots, 1, 1),
      labor: intOf(item.labor, 0, 0),
      p: intOf(item.p, 0, 0),
      materials: intOf(item.materials, 0, 0),
      limitPerSettlement: intOf(item.limitPerSettlement, 0, 0),
      requiresWater: item.requiresWater === true,
      description: textOf(item.description, ''),
      effects: normalizeEffects(item.effects),
    })
  }
  return out
}

function normalizeBuildings(raw, buildingDefs) {
  if (!Array.isArray(raw)) return []
  const known = new Set(buildingDefs.map((d) => d.id))
  const out = []
  for (const item of raw) {
    if (!isObj(item)) continue
    const defId = textOf(item.defId)
    if (!known.has(defId)) continue
    out.push({
      id: uniqueId(out, textOf(item.id), 'b'),
      defId,
    })
  }
  return out
}

function normalizeSettlements(raw, buildingDefs) {
  if (!Array.isArray(raw)) return [capitalSettlement()]
  const out = []
  for (const item of raw) {
    if (!isObj(item)) continue
    const type = SETTLEMENT_TYPES[item.type] ? item.type : 'village'
    // 旧存档用单值 hex，新存档允许多个关联格
    const hexes = Array.isArray(item.hexes)
      ? [...new Set(item.hexes.filter((h) => typeof h === 'string' && h))]
      : (typeof item.hex === 'string' && item.hex ? [item.hex] : [])
    out.push({
      id: uniqueId(out, textOf(item.id), 's'),
      name: textOf(item.name, `定居点${out.length + 1}`),
      alias: textOf(item.alias, ''),
      type,
      water: item.water === true,
      hexes,
      buildings: normalizeBuildings(item.buildings, buildingDefs),
    })
  }
  return out.length ? out : [capitalSettlement()]
}

function normalizeLog(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!isObj(item) || typeof item.text !== 'string' || !item.text) continue
    out.push({
      id: textOf(item.id, makeId('log')),
      text: item.text,
    })
  }
  return out.slice(-200)
}

export function normalizeKingdomState(raw) {
  if (!isObj(raw)) return defaultKingdomState()
  const fallback = defaultKingdomState()
  const effectDefs = normalizeEffectDefs(raw.effectDefs)
  const buildingDefs = normalizeBuildingDefs(raw.buildingDefs)
  return {
    version: VERSION,
    treasury: intOf(raw.treasury, fallback.treasury, 0),
    materials: intOf(raw.materials, fallback.materials, 0),
    laborPoints: intOf(raw.laborPoints, 0, 0),
    options: normalizeOptions(raw.options),
    settlements: normalizeSettlements(raw.settlements, buildingDefs),
    buildingDefs,
    effectDefs,
    log: normalizeLog(raw.log),
  }
}

export function settlementType(type, options) {
  const base = SETTLEMENT_TYPES[type] || SETTLEMENT_TYPES.village
  if (!options || !options.compactSlots) return base
  return { ...base, slots: COMPACT_SLOTS[base.id] || base.slots }
}

// 定居点显示名：别名并列，和建筑别名保持一致
export function settlementLabel(settlement) {
  if (!settlement) return ''
  const name = settlement.name || '未命名定居点'
  return settlement.alias ? `${name}（${settlement.alias}）` : name
}

export function tierLabel(tier) {
  const hit = BUILDING_TIERS.find((t) => t.id === tier)
  return hit ? hit.label : tier
}

export function effectKindOf(state, typeId) {
  const hit = (state.effectDefs || []).find((e) => e.id === typeId)
  return hit ? hit.kind : null
}

export function defById(state, id) {
  return (state.buildingDefs || []).find((d) => d.id === id) || null
}

export function settlementById(state, id) {
  return state.settlements.find((s) => s.id === id) || null
}

// 建筑显示名：有别名时并列，便于对照原始规则里的叫法
export function defLabel(def) {
  if (!def) return ''
  const name = def.name || '未命名建筑'
  return def.alias ? `${name}（${def.alias}）` : name
}

export function settlementStats(state, settlement) {
  const type = settlementType(settlement.type, state.options)
  let popEffect = 0
  let laborBonus = 0
  let buildingP = 0
  let buildingMaterials = 0
  let slotEffect = 0
  let used = 0

  for (const building of settlement.buildings) {
    const def = defById(state, building.defId)
    if (!def) continue
    used += Number(def.slots) || 0
    for (const effect of def.effects) {
      const kind = effectKindOf(state, effect.type)
      if (!kind || kind === 'note') continue
      const value = numOf(effect.value, 0)
      if (kind === 'population') popEffect += value
      else if (kind === 'labor') laborBonus += value
      else if (kind === 'incomeP') buildingP += value
      else if (kind === 'incomeMaterial') buildingMaterials += value
      else if (kind === 'slots') slotEffect += value
    }
  }

  const population = Math.max(0, type.basePop + popEffect)
  const capacity = Math.max(0, Math.round(type.slots + slotEffect))
  const free = Math.max(0, capacity - used)
  const tax = Math.floor(population / 2)
  return {
    type,
    population,
    tax,
    buildingP,
    incomeP: tax + buildingP,
    materials: buildingMaterials,
    laborBonus,
    capacity,
    used,
    free,
    totalCount: settlement.buildings.length,
    full: capacity > 0 && used >= capacity,
  }
}

export function kingdomStats(state) {
  const rows = state.settlements.map((s) => settlementStats(state, s))
  const totalPopulation = rows.reduce((sum, r) => sum + r.population, 0)
  const growth = GROWTH_RATES[state.options?.growth] || GROWTH_RATES.normal
  const baseLaborDice = Math.min(12, Math.max(3, Math.floor(totalPopulation / growth.divisor)))
  const laborBonus = rows.reduce((sum, r) => sum + r.laborBonus, 0)
  const laborDice = Math.max(0, baseLaborDice + laborBonus)
  return {
    totalPopulation,
    baseLaborDice,
    laborBonus,
    laborDice,
    tax: rows.reduce((sum, r) => sum + r.tax, 0),
    buildingP: rows.reduce((sum, r) => sum + r.buildingP, 0),
    incomeP: rows.reduce((sum, r) => sum + r.incomeP, 0),
    materials: rows.reduce((sum, r) => sum + r.materials, 0),
  }
}

export function allowedDefs(state, settlement) {
  const type = settlementType(settlement.type)
  return state.buildingDefs.filter((def) => type.tiers.includes(def.tier))
}

export function countBuildingInstances(state, defId) {
  return state.settlements.reduce(
    (sum, s) => sum + s.buildings.filter((b) => b.defId === defId).length,
    0,
  )
}

export function countEffectUsage(state, effectId) {
  return state.buildingDefs.reduce(
    (sum, d) => sum + d.effects.filter((e) => e.type === effectId).length,
    0,
  )
}

// 实际建造费：成长速度改 p 成本，单资源模式去掉劳力与物资
export function buildCost(state, def) {
  if (!def) return { labor: 0, p: 0, materials: 0 }
  const growth = GROWTH_RATES[state.options?.growth] || GROWTH_RATES.normal
  const p = Math.ceil((Number(def.p) || 0) * growth.costMultiplier)
  if (state.options?.singleResource) return { labor: 0, p, materials: 0 }
  return {
    labor: Math.max(0, Number(def.labor) || 0),
    p,
    materials: Math.max(0, Number(def.materials) || 0),
  }
}

export function canBuild(state, settlementId, defId) {
  const settlement = settlementById(state, settlementId)
  if (!settlement) return { ok: false, reason: '没有这处定居点' }
  const def = defById(state, defId)
  if (!def) return { ok: false, reason: '没有这项建筑' }
  if (!settlementType(settlement.type, state.options).tiers.includes(def.tier)) {
    return { ok: false, reason: `这座定居点还不能建${tierLabel(def.tier)}档建筑` }
  }
  if (def.requiresWater && !settlement.water) {
    return { ok: false, reason: `${def.name}需要临水` }
  }
  const same = settlement.buildings.filter((b) => b.defId === defId).length
  if (def.limitPerSettlement > 0 && same >= def.limitPerSettlement) {
    return { ok: false, reason: `${def.name}每定居点限${def.limitPerSettlement}座` }
  }
  const st = settlementStats(state, settlement)
  if (def.slots > st.free) {
    return { ok: false, reason: `槽位不足：需要${def.slots}槽，只剩${st.free}槽` }
  }
  const cost = buildCost(state, def)
  const missing = []
  if (state.laborPoints < cost.labor) missing.push(`劳力${cost.labor - state.laborPoints}`)
  if (state.treasury < cost.p) missing.push(`${cost.p - state.treasury}p`)
  if (state.materials < cost.materials) missing.push(`物资${cost.materials - state.materials}`)
  if (missing.length) return { ok: false, reason: `还缺${missing.join('、')}` }
  return { ok: true, reason: '' }
}

export function canUpgrade(state, settlementId) {
  const settlement = settlementById(state, settlementId)
  if (!settlement) return { ok: false, reason: '没有这处定居点' }
  const st = settlementStats(state, settlement)
  const type = settlementType(settlement.type)
  if (!st.full) return { ok: false, reason: '槽位还没填满' }
  if (!type.next) return { ok: false, reason: '已是最高档' }
  return { ok: true, reason: '' }
}

export function upgradeSettlement(state, settlementId) {
  const check = canUpgrade(state, settlementId)
  if (!check.ok) return check
  const settlement = settlementById(state, settlementId)
  const from = settlementType(settlement.type)
  settlement.type = from.next
  pushLog(state, `${settlementLabel(settlement)} 槽位已满，升级为${settlementType(from.next).label}。`)
  return { ok: true, type: settlement.type }
}

export function buildBuilding(state, settlementId, defId) {
  const check = canBuild(state, settlementId, defId)
  if (!check.ok) return check
  const settlement = settlementById(state, settlementId)
  const def = defById(state, defId)
  const cost = buildCost(state, def)
  state.laborPoints -= cost.labor
  state.treasury -= cost.p
  state.materials -= cost.materials
  const building = { id: makeId('b'), defId: def.id }
  settlement.buildings.push(building)
  pushLog(state, `在${settlementLabel(settlement)}建成${defLabel(def)}，花费${costText(state, def)}。`)
  if (settlementStats(state, settlement).full) upgradeSettlement(state, settlement.id)
  return { ok: true, building }
}

export function demolishBuilding(state, settlementId, buildingId) {
  const settlement = settlementById(state, settlementId)
  if (!settlement) return { ok: false, reason: '没有这处定居点' }
  const i = settlement.buildings.findIndex((b) => b.id === buildingId)
  if (i < 0) return { ok: false, reason: '没有这座建筑' }
  const def = defById(state, settlement.buildings[i].defId)
  settlement.buildings.splice(i, 1)
  pushLog(state, `拆除${settlementLabel(settlement)}的${def ? defLabel(def) : '建筑'}，空出${def ? def.slots : 0}槽，不退款。`)
  return { ok: true }
}

export function newSettlementCost(state) {
  return { labor: 6, materials: 5, p: state.settlements.length * 100 }
}

export function canFoundSettlement(state) {
  const cost = newSettlementCost(state)
  const missing = []
  if (state.laborPoints < cost.labor) missing.push(`劳力${cost.labor - state.laborPoints}`)
  if (state.materials < cost.materials) missing.push(`物资${cost.materials - state.materials}`)
  if (state.treasury < cost.p) missing.push(`${cost.p - state.treasury}p`)
  if (missing.length) return { ok: false, reason: `还缺${missing.join('、')}` }
  return { ok: true, reason: '' }
}

export function foundSettlement(state) {
  const check = canFoundSettlement(state)
  if (!check.ok) return check
  const cost = newSettlementCost(state)
  state.laborPoints -= cost.labor
  state.materials -= cost.materials
  state.treasury -= cost.p
  const settlement = {
    id: makeId('s'),
    name: `定居点${state.settlements.length + 1}`,
    alias: '',
    type: 'village',
    water: false,
    hexes: [],
    buildings: [],
  }
  state.settlements.push(settlement)
  pushLog(state, `新建${settlementLabel(settlement)}，花费${cost.labor}劳力、${cost.p}p、${cost.materials}物资。`)
  return { ok: true, settlement }
}

// 城市已满档时清空建筑，原址重新规划
export function clearBuildings(state, settlementId) {
  const settlement = settlementById(state, settlementId)
  if (!settlement) return { ok: false, reason: '没有这处定居点' }
  if (!settlement.buildings.length) return { ok: false, reason: '没有可拆除的建筑' }
  const count = settlement.buildings.length
  settlement.buildings = []
  pushLog(state, `清空${settlementLabel(settlement)}的${count}座建筑，槽位全部空出。`)
  return { ok: true, count }
}

export function maintenanceCost(state) {
  const count = state.settlements.reduce((sum, s) => sum + s.buildings.length, 0)
  return count * 5
}

// 压力模式：每次经营手动结算；付不起时拆一座建筑抵账
export function settleMaintenance(state) {
  if (!state.options?.pressure) return { ok: false, reason: '未开启压力模式' }
  const cost = maintenanceCost(state)
  if (!cost) return { ok: true, cost: 0, paid: true }
  if (state.treasury >= cost) {
    state.treasury -= cost
    pushLog(state, `结算维护费${cost}p。`)
    return { ok: true, cost, paid: true }
  }
  const target = state.settlements
    .filter((s) => s.buildings.length)
    .sort((a, b) => b.buildings.length - a.buildings.length)[0]
  const building = target.buildings[target.buildings.length - 1]
  const def = defById(state, building.defId)
  target.buildings.pop()
  const name = def ? defLabel(def) : '建筑'
  pushLog(state, `维护费${cost}p不足，拆除${settlementLabel(target)}的${name}抵账。`)
  return { ok: true, cost, paid: false, demolished: { settlementId: target.id, name } }
}

export const AMBITIONS = [
  { id: 'pop50', label: '人口 50', test: (ctx) => ctx.population >= 50 },
  { id: 'pop100', label: '人口 100', test: (ctx) => ctx.population >= 100 },
  { id: 'pop200', label: '人口 200', test: (ctx) => ctx.population >= 200 },
  { id: 'town', label: '建成城镇', test: (ctx) => ctx.settlements.some((s) => s.type === 'town' || s.type === 'city') },
  { id: 'city', label: '建成城市', test: (ctx) => ctx.settlements.some((s) => s.type === 'city') },
  { id: 's3', label: '定居点 3', test: (ctx) => ctx.settlements.length >= 3 },
  { id: 's5', label: '定居点 5', test: (ctx) => ctx.settlements.length >= 5 },
  { id: 'b12', label: '建筑 12 种', test: (ctx) => ctx.types.size >= 12 },
  { id: 'p1000', label: '国库 1000p', test: (ctx) => ctx.treasury >= 1000 },
]

export function ambitionStatus(state) {
  const stats = kingdomStats(state)
  const types = new Set(state.settlements.flatMap((s) => s.buildings.map((b) => b.defId)))
  const ctx = {
    population: stats.totalPopulation,
    settlements: state.settlements,
    treasury: state.treasury,
    types,
  }
  return AMBITIONS.map((a) => ({ id: a.id, label: a.label, done: a.test(ctx) }))
}

export function effectSummary(state, def) {
  if (!def) return ''
  const parts = []
  for (const effect of def.effects || []) {
    const fx = (state.effectDefs || []).find((e) => e.id === effect.type)
    if (!fx) {
      parts.push('未知效果')
      continue
    }
    const value = numOf(effect.value, 0)
    if (fx.kind === 'note') {
      parts.push(value ? `${fx.label} ${value}` : fx.label)
      continue
    }
    const unit = fx.unit && fx.unit !== fx.label ? fx.unit : ''
    parts.push(`${fx.label}${signed(value)}${unit}`)
  }
  return parts.length ? parts.join('、') : '无效果'
}

export function costText(state, def) {
  if (!def) return ''
  const cost = buildCost(state, def)
  const parts = []
  if (cost.labor) parts.push(`劳${cost.labor}`)
  parts.push(`${cost.p}p`)
  if (cost.materials) parts.push(`物资${cost.materials}`)
  return parts.join(' · ')
}

export function newBuildingDef() {
  return {
    id: makeId('def'),
    name: '新建筑',
    alias: '',
    tier: 'village',
    slots: 1,
    labor: 3,
    p: 20,
    materials: 0,
    limitPerSettlement: 0,
    requiresWater: false,
    description: '',
    effects: [],
  }
}

export function newEffectDef() {
  return { id: makeId('fx'), label: '新效果', unit: '', kind: 'note' }
}

export function pushLog(state, text) {
  state.log.push({ id: makeId('log'), text })
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200)
}

function signed(value) {
  const n = numOf(value, 0)
  return n >= 0 ? `+${n}` : `${n}`
}
