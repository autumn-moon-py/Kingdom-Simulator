// 王国经营的数据模型与纯逻辑：不依赖 Vue，便于单元测试。
// 建筑与效果全部走数据表，界面改表即时生效；存档只保存这张表和当前局面。

export const VERSION = 4
export const UPKEEP_PER_BUILDING = 5

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

export const EFFECT_KINDS = [
  { id: 'population', label: '人口', hint: '加定居点人口，同时影响税收与劳力骰。' },
  { id: 'labor', label: '劳力骰', hint: '给全王国加劳力骰，每颗 d6。' },
  { id: 'incomeP', label: 'p收入', hint: '给国库加 p。' },
  { id: 'incomeMaterial', label: '物资收入', hint: '给物资池加物资。' },
  { id: 'slots', label: '槽位', hint: '加减定居点的槽位上限。' },
  { id: 'morale', label: '民心', hint: '计入王国民心，每点抵消1点动荡；剩余每点调整1p税收。' },
  { id: 'note', label: '说明', hint: '只展示，不参与数值计算。' },
]

const EFFECT_IDS = {
  population: 'population',
  labor: 'labor',
  p: 'p',
  material: 'material',
  slots: 'slots',
  note: 'note',
  morale: 'morale',
  defense: 'defense',
  research: 'research',
  diplomacy: 'diplomacy',
}

const V3_EFFECT_IDS = new Set([EFFECT_IDS.morale, EFFECT_IDS.defense, EFFECT_IDS.research, EFFECT_IDS.diplomacy])
const V3_BUILDING_IDS = new Set(['tavern', 'shrine', 'wall', 'library', 'trade_post'])
const V4_REMOVED_BUILDING_IDS = new Set(['school', 'university', 'grand_market', 'theater'])
const V4_NEW_BUILDING_IDS = new Set(['academy', 'alehouse', 'brewery', 'museum', 'blacksmith', 'graveyard'])
const V4_BUILDING_NAMES = {
  house: '民房',
  farm: '产地',
  market: '市集',
  road: '道路',
  tavern: '旅店',
  shrine: '神殿',
  workshop: '工坊',
  dock: '码头',
  town_hall: '议事厅',
  wall: '城墙',
  library: '图书馆',
  trade_post: '贸易站',
  palace: '宫殿',
}

export function defaultEffectDefs() {
  return [
    { id: EFFECT_IDS.population, label: '人口', unit: '人', kind: 'population' },
    { id: EFFECT_IDS.labor, label: '劳力骰', unit: '颗', kind: 'labor' },
    { id: EFFECT_IDS.p, label: 'p', unit: 'p', kind: 'incomeP' },
    { id: EFFECT_IDS.material, label: '物资', unit: '物资', kind: 'incomeMaterial' },
    { id: EFFECT_IDS.slots, label: '槽位', unit: '槽', kind: 'slots' },
    { id: EFFECT_IDS.note, label: '说明', unit: '', kind: 'note' },
    { id: EFFECT_IDS.morale, label: '民心', unit: '', kind: 'morale' },
    { id: EFFECT_IDS.defense, label: '防御', unit: '', kind: 'note' },
    { id: EFFECT_IDS.research, label: '研究', unit: '', kind: 'note' },
    { id: EFFECT_IDS.diplomacy, label: '外交', unit: '', kind: 'note' },
  ]
}

export function defaultBuildingDefs() {
  return [
    {
      id: 'house', name: '民房', tier: 'village', slots: 1, labor: 3, p: 20, materials: 0,
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
      id: 'tavern', name: '旅店', tier: 'village', slots: 1, labor: 3, p: 25, materials: 0,
      limitPerSettlement: 0, requiresWater: false, description: '提供食宿与消息',
      effects: [
        { type: EFFECT_IDS.p, value: 5 },
        { type: EFFECT_IDS.morale, value: 1 },
      ],
    },
    {
      id: 'shrine', name: '神殿', tier: 'village', slots: 1, labor: 4, p: 30, materials: 0,
      limitPerSettlement: 0, requiresWater: false, description: '安抚社区',
      effects: [
        { type: EFFECT_IDS.population, value: 5 },
        { type: EFFECT_IDS.morale, value: 1 },
      ],
    },
    {
      id: 'alehouse', name: '酒馆', tier: 'village', slots: 1, labor: 3, p: 20, materials: 0,
      limitPerSettlement: 0, requiresWater: false, description: '饮酒与社交',
      effects: [
        { type: EFFECT_IDS.p, value: 3 },
        { type: EFFECT_IDS.morale, value: 2 },
      ],
    },
    {
      id: 'graveyard', name: '墓地', tier: 'village', slots: 1, labor: 3, p: 15, materials: 0,
      limitPerSettlement: 1, requiresWater: false, description: '安抚亡者与社区；每定居点限1座',
      effects: [{ type: EFFECT_IDS.morale, value: 1 }],
    },
    {
      id: 'workshop', name: '工坊', tier: 'town', slots: 1, labor: 5, p: 20, materials: 2,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [{ type: EFFECT_IDS.p, value: 15 }],
    },
    {
      id: 'dock', name: '码头', tier: 'town', slots: 1, labor: 5, p: 30, materials: 2,
      limitPerSettlement: 0, requiresWater: true, description: '需临水',
      effects: [{ type: EFFECT_IDS.p, value: 20 }],
    },
    {
      id: 'town_hall', name: '议事厅', tier: 'town', slots: 2, labor: 8, p: 80, materials: 3,
      limitPerSettlement: 0, requiresWater: false, description: '',
      effects: [
        { type: EFFECT_IDS.population, value: 10 },
        { type: EFFECT_IDS.labor, value: 1 },
      ],
    },
    {
      id: 'wall', name: '城墙', tier: 'town', slots: 2, labor: 8, p: 60, materials: 3,
      limitPerSettlement: 0, requiresWater: false, description: '防御按桌面裁定',
      effects: [{ type: EFFECT_IDS.defense, value: 1 }],
    },
    {
      id: 'library', name: '图书馆', tier: 'town', slots: 1, labor: 6, p: 50, materials: 2,
      limitPerSettlement: 0, requiresWater: false, description: '研究线索按桌面裁定',
      effects: [{ type: EFFECT_IDS.research, value: 1 }],
    },
    {
      id: 'trade_post', name: '贸易站', tier: 'town', slots: 1, labor: 5, p: 40, materials: 0,
      limitPerSettlement: 0, requiresWater: false, description: '外交与贸易按桌面裁定',
      effects: [
        { type: EFFECT_IDS.p, value: 10 },
        { type: EFFECT_IDS.diplomacy, value: 1 },
      ],
    },
    {
      id: 'brewery', name: '酿酒厂', tier: 'town', slots: 1, labor: 5, p: 30, materials: 3,
      limitPerSettlement: 0, requiresWater: false, description: '酿造与售卖酒类',
      effects: [
        { type: EFFECT_IDS.p, value: 5 },
        { type: EFFECT_IDS.material, value: 3 },
        { type: EFFECT_IDS.morale, value: 1 },
      ],
    },
    {
      id: 'blacksmith', name: '铁匠铺', tier: 'town', slots: 1, labor: 5, p: 25, materials: 2,
      limitPerSettlement: 1, requiresWater: false, description: '打造工具与兵器；每定居点限1座',
      effects: [
        { type: EFFECT_IDS.p, value: 10 },
        { type: EFFECT_IDS.defense, value: 1 },
      ],
    },
    {
      id: 'academy', name: '学院', tier: 'city', slots: 2, labor: 10, p: 120, materials: 5,
      limitPerSettlement: 1, requiresWater: false, description: '研究线索按桌面裁定；每定居点限1座',
      effects: [{ type: EFFECT_IDS.labor, value: 2 }],
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
    {
      id: 'museum', name: '博物馆', tier: 'city', slots: 2, labor: 8, p: 100, materials: 4,
      limitPerSettlement: 1, requiresWater: false, description: '展品与研究线索按桌面裁定；每定居点限1座',
      effects: [
        { type: EFFECT_IDS.p, value: 10 },
        { type: EFFECT_IDS.morale, value: 2 },
        { type: EFFECT_IDS.research, value: 1 },
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
    settled: false,
    moraleAdjust: 0,
    unrest: 0,
    settlements: [capitalSettlement()],
    buildingDefs: defaultBuildingDefs(),
    effectDefs: defaultEffectDefs(),
    log: [{ id: 'log_start', text: '开局：首都一处村庄，国库60p，物资4，民心0、动荡0。劳力骰数量仅作提示，外部掷好后填入点数。' }],
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
const signedIntOf = (v, fallback, min, max) => Math.min(max, Math.max(min, Math.floor(numOf(v, fallback))))
const textOf = (v, fallback = '') => (typeof v === 'string' ? v : fallback)

function uniqueId(list, id, prefix) {
  const seen = new Set(list.map((x) => x.id))
  let next = id && !seen.has(id) ? id : makeId(prefix)
  while (seen.has(next)) next = makeId(prefix)
  return next
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

// v4：建筑改名、移除旧地标、补战役建筑；民心从说明型改为可结算数值
function migrateV4(buildingDefs, effectDefs) {
  const byId = new Map(buildingDefs.map((d) => [d.id, d]))
  const defaults = new Map(defaultBuildingDefs().map((d) => [d.id, d]))
  for (const id of V4_REMOVED_BUILDING_IDS) byId.delete(id)
  for (const [id, name] of Object.entries(V4_BUILDING_NAMES)) {
    const def = byId.get(id)
    if (!def) continue
    def.name = name
    def.alias = ''
    const next = defaults.get(id)
    if (next) def.description = next.description
  }
  for (const def of defaults.values()) {
    if (V4_NEW_BUILDING_IDS.has(def.id) && !byId.has(def.id)) byId.set(def.id, { ...def })
  }
  const morale = effectDefs.find((e) => e.id === EFFECT_IDS.morale)
  if (morale) morale.kind = 'morale'
  else effectDefs.push({ id: EFFECT_IDS.morale, label: '民心', unit: '', kind: 'morale' })
  return [...byId.values()]
}

export function normalizeKingdomState(raw) {
  if (!isObj(raw)) return defaultKingdomState()
  const fallback = defaultKingdomState()
  const version = intOf(raw.version, 0, 0)
  const effectDefs = normalizeEffectDefs(raw.effectDefs)
  let buildingDefs = normalizeBuildingDefs(raw.buildingDefs)
  // v2 存档一次性补齐战役补充建筑与说明型效果；v3 后尊重玩家的删除
  if (version < 3) {
    for (const def of defaultEffectDefs()) {
      if (V3_EFFECT_IDS.has(def.id) && !effectDefs.some((x) => x.id === def.id)) effectDefs.push(def)
    }
    for (const def of defaultBuildingDefs()) {
      if (V3_BUILDING_IDS.has(def.id) && !buildingDefs.some((x) => x.id === def.id)) buildingDefs.push(def)
    }
  }
  if (version < 4) buildingDefs = migrateV4(buildingDefs, effectDefs)
  return {
    version: VERSION,
    treasury: intOf(raw.treasury, fallback.treasury, 0),
    materials: intOf(raw.materials, fallback.materials, 0),
    laborPoints: intOf(raw.laborPoints, 0, 0),
    settled: raw.settled === true,
    moraleAdjust: signedIntOf(raw.moraleAdjust, 0, -5, 5),
    unrest: signedIntOf(raw.unrest, 0, 0, 20),
    settlements: normalizeSettlements(raw.settlements, buildingDefs),
    buildingDefs,
    effectDefs,
    log: normalizeLog(raw.log),
  }
}

export function settlementType(type) {
  return SETTLEMENT_TYPES[type] || SETTLEMENT_TYPES.village
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
  const type = settlementType(settlement.type)
  let popEffect = 0
  let laborBonus = 0
  let buildingP = 0
  let buildingMaterials = 0
  let slotEffect = 0
  let moraleBonus = 0
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
      else if (kind === 'morale') moraleBonus += value
    }
  }

  const population = Math.max(0, type.basePop + popEffect)
  const capacity = Math.max(0, Math.round(type.slots + slotEffect))
  const free = Math.max(0, capacity - used)
  const tax = Math.floor(population / 2)
  const upkeep = settlement.buildings.length * UPKEEP_PER_BUILDING
  return {
    type,
    population,
    tax,
    buildingP,
    incomeP: tax + buildingP,
    upkeep,
    netIncomeP: tax + buildingP - upkeep,
    materials: buildingMaterials,
    laborBonus,
    moraleBonus,
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
  const baseLaborDice = Math.min(12, Math.max(3, Math.floor(totalPopulation / 6)))
  const laborBonus = rows.reduce((sum, r) => sum + r.laborBonus, 0)
  const laborDice = Math.max(0, baseLaborDice + laborBonus)
  const baseTax = rows.reduce((sum, r) => sum + r.tax, 0)
  const buildingMorale = rows.reduce((sum, r) => sum + r.moraleBonus, 0)
  const morale = Math.min(10, Math.max(0, buildingMorale + numOf(state.moraleAdjust, 0)))
  const unrest = Math.min(20, Math.max(0, numOf(state.unrest, 0)))
  const netMorale = morale - unrest
  const tax = Math.max(0, baseTax + netMorale)
  const moraleTax = tax - baseTax
  const buildingP = rows.reduce((sum, r) => sum + r.buildingP, 0)
  const incomeP = tax + buildingP
  const upkeep = rows.reduce((sum, r) => sum + r.upkeep, 0)
  return {
    totalPopulation,
    baseLaborDice,
    laborBonus,
    laborDice,
    tax,
    baseTax,
    buildingMorale,
    morale,
    unrest,
    netMorale,
    moraleTax,
    buildingP,
    incomeP,
    upkeep,
    netIncomeP: incomeP - upkeep,
    materials: rows.reduce((sum, r) => sum + r.materials, 0),
  }
}

// 每次经营结算一次全额净产出；settled 标记当前这一轮是否已经入库
export function pendingProduction(state) {
  const stats = kingdomStats(state)
  const settled = state.settled === true
  return {
    p: settled ? 0 : stats.netIncomeP,
    materials: settled ? 0 : stats.materials,
    totalP: stats.netIncomeP,
    totalMaterials: stats.materials,
    upkeep: stats.upkeep,
  }
}

export function settleCheck(state) {
  const pending = pendingProduction(state)
  if (state.settled === true) {
    return { ok: false, reason: '本次已经结算', pending }
  }
  if (!pending.p && !pending.materials) {
    return { ok: false, reason: '本次没有可结算的产出', pending }
  }
  const treasury = numOf(state.treasury, 0)
  if (pending.p < 0 && treasury + pending.p < 0) {
    const gap = -(treasury + pending.p)
    return { ok: false, reason: `国库不足支付维护费，还差${gap}p；可拆除建筑或补足国库`, pending }
  }
  return { ok: true, reason: '', pending }
}

export function settleProduction(state) {
  const check = settleCheck(state)
  if (!check.ok) return check
  const pending = check.pending
  state.treasury = numOf(state.treasury, 0) + pending.p
  state.materials = numOf(state.materials, 0) + pending.materials
  state.settled = true
  const stats = kingdomStats(state)
  const detail = state.settlements
    .map((s) => `${settlementLabel(s)} ${signed(settlementStats(state, s).netIncomeP)}p`)
    .join('、')
  pushLog(
    state,
    `结算：${detail}；合计${signed(pending.p)}p、${signed(pending.materials)}物资（税收${stats.tax}p、建筑${stats.buildingP}p、维护${stats.upkeep}p；民心${stats.morale}－动荡${stats.unrest}＝${signed(stats.netMorale)}，税收${signed(stats.moraleTax)}p）。`,
  )
  return { ok: true, ...pending }
}

export function startNewRound(state) {
  state.settled = false
  state.laborPoints = 0
  pushLog(state, '开始新一轮经营，劳力清零。')
  return { ok: true }
}

// 桌面补款、冒险所得或临时支出直接调整国库；正数入库，负数支出
export function depositTreasury(state, amount, note = '') {
  const value = Math.floor(numOf(amount, 0))
  if (!value) return { ok: false, reason: '入库金额不能为0' }
  const next = numOf(state.treasury, 0) + value
  if (next < 0) return { ok: false, reason: '国库余额不足，无法扣除' }
  state.treasury = next
  const memo = textOf(note, '').trim().slice(0, 120)
  pushLog(state, `入库：${signed(value)}p，国库现有 ${next}p${memo ? `；备注：${memo}` : ''}。`)
  return { ok: true, amount: value, treasury: next, note: memo }
}

export function allowedDefs(state, settlement) {
  const type = settlementType(settlement.type)
  return state.buildingDefs.filter((def) => type.tiers.includes(def.tier))
}

// 实际建造费：直接读建筑定义
export function buildCost(def) {
  if (!def) return { labor: 0, p: 0, materials: 0 }
  return {
    labor: Math.max(0, Number(def.labor) || 0),
    p: Math.max(0, Number(def.p) || 0),
    materials: Math.max(0, Number(def.materials) || 0),
  }
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

export function canBuild(state, settlementId, defId) {
  const settlement = settlementById(state, settlementId)
  if (!settlement) return { ok: false, reason: '没有这处定居点' }
  const def = defById(state, defId)
  if (!def) return { ok: false, reason: '没有这项建筑' }
  if (!settlementType(settlement.type).tiers.includes(def.tier)) {
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
  const cost = buildCost(def)
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
  const cost = buildCost(def)
  state.laborPoints -= cost.labor
  state.treasury -= cost.p
  state.materials -= cost.materials
  const building = { id: makeId('b'), defId: def.id }
  settlement.buildings.push(building)
  pushLog(state, `在${settlementLabel(settlement)}建成${defLabel(def)}，花费${costText(def)}。`)
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

export function costText(def) {
  if (!def) return ''
  const cost = buildCost(def)
  const parts = []
  if (cost.labor) parts.push(`劳力${cost.labor}`)
  parts.push(`${cost.p}p`)
  if (cost.materials) parts.push(`${cost.materials}物资`)
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
  return { id: makeId('fx'), label: '新效果', unit: 'p', kind: 'incomeP' }
}

export function pushLog(state, text) {
  state.log.push({ id: makeId('log'), text })
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200)
}

function signed(value) {
  const n = numOf(value, 0)
  return n >= 0 ? `+${n}` : `${n}`
}
