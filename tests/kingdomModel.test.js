import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBuilding,
  canBuild,
  canFoundSettlement,
  defaultKingdomState,
  defLabel,
  effectSummary,
  foundSettlement,
  kingdomStats,
  newSettlementCost,
  normalizeBuildingDefs,
  normalizeKingdomState,
  pendingProduction,
  settleCheck,
  settleProduction,
  settlementLabel,
  settlementStats,
  startNewRound,
} from '../src/kingdom/model.js'

test('开局：首都村庄、25人口、4颗劳力骰、12p税收', () => {
  const state = defaultKingdomState()
  assert.equal(state.settlements.length, 1)
  assert.equal(state.treasury, 60)
  assert.equal(state.materials, 4)
  assert.equal(state.laborPoints, 0)
  const stats = kingdomStats(state)
  assert.equal(stats.totalPopulation, 25)
  assert.equal(stats.baseLaborDice, 4)
  assert.equal(stats.laborDice, 4)
  assert.equal(stats.tax, 12)
})

test('劳力点数由玩家外部掷骰后填入，不内置投掷', () => {
  const state = defaultKingdomState()
  assert.match(canBuild(state, 'capital', 'house').reason, /劳力/)
  state.laborPoints = 10
  assert.equal(buildBuilding(state, 'capital', 'house').ok, true)
  assert.equal(state.laborPoints, 7)
})

test('建造扣资源，建筑立即计入人口', () => {
  const state = defaultKingdomState()
  state.laborPoints = 10
  const result = buildBuilding(state, 'capital', 'house')
  assert.equal(result.ok, true)
  assert.equal(state.treasury, 40)
  assert.equal(settlementStats(state, state.settlements[0]).population, 30)
  assert.equal(settlementStats(state, state.settlements[0]).used, 2)
  assert.equal(kingdomStats(state).laborDice, 5)
})

test('建筑产出与税收直接反映在当前数值里', () => {
  const state = defaultKingdomState()
  state.laborPoints = 10
  assert.equal(buildBuilding(state, 'capital', 'market').ok, true)
  assert.equal(state.treasury, 30)
  assert.equal(kingdomStats(state).buildingP, 10)
  assert.equal(kingdomStats(state).incomeP, 22)
})

test('结算：每轮全额结算，新一轮重置劳力', () => {
  const state = defaultKingdomState()
  state.treasury = 100

  const pending = pendingProduction(state)
  assert.deepEqual(pending, { p: 7, materials: 0, totalP: 7, totalMaterials: 0, upkeep: 5 })
  assert.equal(settleProduction(state).ok, true)
  assert.equal(state.treasury, 107)
  assert.equal(state.settled, true)
  assert.equal(settleProduction(state).ok, false)
  assert.equal(state.treasury, 107)

  startNewRound(state)
  assert.equal(state.settled, false)
  assert.equal(state.laborPoints, 0)

  state.laborPoints = 10
  assert.equal(buildBuilding(state, 'capital', 'market').ok, true)
  const second = settleProduction(state)
  assert.equal(second.ok, true)
  assert.equal(second.p, 12)
  assert.equal(second.materials, 0)
  assert.equal(state.treasury, 89)
  assert.equal(state.settled, true)

  const saved = normalizeKingdomState({ settled: true })
  assert.equal(saved.settled, true)
})

test('维护费不足时阻止结算，避免国库变负', () => {
  const state = defaultKingdomState()
  state.settlements[0].buildings = ['house', 'farm', 'farm', 'farm'].map((defId, i) => ({ id: `b${i}`, defId }))
  state.treasury = 0
  const check = settleCheck(state)
  assert.equal(check.ok, false)
  assert.match(check.reason, /维护费/)
  assert.equal(settleProduction(state).ok, false)
  assert.equal(state.treasury, 0)
})

test('v2 存档补齐补充建筑与说明效果，v3 不再补回已删除项', () => {
  const old = defaultKingdomState()
  old.version = 2
  const newBuildings = ['tavern', 'shrine', 'wall', 'library', 'trade_post']
  const newEffects = ['morale', 'defense', 'research', 'diplomacy']
  old.buildingDefs = old.buildingDefs.filter((d) => !newBuildings.includes(d.id))
  old.effectDefs = old.effectDefs.filter((e) => !newEffects.includes(e.id))

  const migrated = normalizeKingdomState(old)
  assert.equal(migrated.version, 3)
  for (const id of newBuildings) assert.ok(migrated.buildingDefs.some((d) => d.id === id))
  for (const id of newEffects) assert.ok(migrated.effectDefs.some((e) => e.id === id))

  const v3 = normalizeKingdomState({ ...old, version: 3 })
  assert.equal(v3.buildingDefs.some((d) => d.id === 'tavern'), false)
})

test('槽位填满后立即升级', () => {
  const state = defaultKingdomState()
  state.laborPoints = 30
  state.treasury = 200
  for (let i = 0; i < 3; i++) assert.equal(buildBuilding(state, 'capital', 'house').ok, true)
  assert.equal(state.settlements[0].type, 'town')
  const after = settlementStats(state, state.settlements[0])
  assert.equal(after.capacity, 8)
  assert.equal(after.population, 50)
  assert.equal(after.full, false)
})

test('新建定居点费用随数量上涨，建成后立即计入人口', () => {
  const state = defaultKingdomState()
  state.laborPoints = 30
  state.treasury = 400
  state.materials = 20
  assert.deepEqual(newSettlementCost(state), { labor: 6, materials: 5, p: 100 })
  assert.equal(canFoundSettlement(state).ok, true)

  const result = foundSettlement(state)
  assert.equal(result.ok, true)
  assert.equal(state.settlements.length, 2)
  assert.equal(state.treasury, 300)
  assert.equal(state.materials, 15)
  assert.equal(state.laborPoints, 24)
  assert.equal(kingdomStats(state).totalPopulation, 45)
})

test('同一定居点可重复建筑受上限约束，临水要求生效', () => {
  const state = defaultKingdomState()
  state.laborPoints = 30
  state.treasury = 200
  state.materials = 20
  assert.equal(buildBuilding(state, 'capital', 'road').ok, true)
  assert.match(canBuild(state, 'capital', 'road').reason, /限1座/)

  state.settlements[0].type = 'town'
  state.settlements[0].water = false
  assert.match(canBuild(state, 'capital', 'dock').reason, /临水/)
})

test('自定义效果类型参与计算，改计算口径立即改变结果', () => {
  const state = defaultKingdomState()
  state.effectDefs.push({ id: 'prestige', label: '声望', unit: '点', kind: 'incomeP' })
  state.buildingDefs.push({
    id: 'guild', name: '行会', tier: 'village', slots: 1, labor: 2, p: 10, materials: 0,
    limitPerSettlement: 0, requiresWater: false, description: '',
    effects: [{ type: 'prestige', value: 7 }],
  })
  state.laborPoints = 10
  assert.equal(buildBuilding(state, 'capital', 'guild').ok, true)

  assert.equal(kingdomStats(state).buildingP, 7)
  assert.equal(settlementStats(state, state.settlements[0]).incomeP, 19)
  assert.equal(effectSummary(state, state.buildingDefs.find((d) => d.id === 'guild')), '声望+7点')

  state.effectDefs.find((e) => e.id === 'prestige').kind = 'incomeMaterial'
  assert.equal(kingdomStats(state).materials, 7)
  assert.equal(kingdomStats(state).buildingP, 0)
})

test('建筑别名：旧存档补空值，有别名时并列显示', () => {
  const defs = normalizeBuildingDefs([
    { id: 'house', name: '民居', alias: '住宅', tier: 'village', slots: 1 },
    { id: 'farm', name: '产地', tier: 'village', slots: 1 },
  ])
  assert.equal(defs[0].alias, '住宅')
  assert.equal(defs[1].alias, '')
  assert.equal(defLabel(defs[0]), '民居（住宅）')
  assert.equal(defLabel(defs[1]), '产地')
  assert.equal(defLabel(null), '')
  assert.ok(defaultKingdomState().buildingDefs.every((d) => d.alias === ''))
})

test('定居点别名并列显示，不再有等级字段', () => {
  const base = defaultKingdomState()
  assert.equal(base.settlements[0].alias, '')
  assert.equal('level' in base, false)

  const normalized = normalizeKingdomState({
    level: 4,
    settlements: [{ id: 's1', name: '都城', alias: '达拉崩吧', type: 'town' }],
  })
  assert.equal('level' in normalized, false)
  assert.equal(normalized.settlements[0].alias, '达拉崩吧')
  assert.equal(settlementLabel(normalized.settlements[0]), '都城（达拉崩吧）')
  assert.equal(settlementLabel(null), '')
})

test('定居点关联地图格：支持多个编号，旧存档单值自动转数组', () => {
  const normalized = normalizeKingdomState({
    settlements: [
      { id: 's1', name: '首都', type: 'village', hexes: ['RL1', 'GB8', 'RL1', 42] },
      { id: 's2', name: '河边', type: 'village', hex: 'TW3' },
      { id: 's3', name: '空地', type: 'village', hexes: [1, null] },
    ],
  })
  assert.deepEqual(normalized.settlements[0].hexes, ['RL1', 'GB8'])
  assert.deepEqual(normalized.settlements[1].hexes, ['TW3'])
  assert.deepEqual(normalized.settlements[2].hexes, [])
  assert.deepEqual(defaultKingdomState().settlements[0].hexes, [])

  const state = defaultKingdomState()
  state.laborPoints = 10
  state.treasury = 200
  state.materials = 10
  const result = foundSettlement(state)
  assert.equal(result.ok, true)
  assert.deepEqual(result.settlement.hexes, [])
})

test('存档清洗：丢弃旧版的回合、等级与延迟字段', () => {
  const normalized = normalizeKingdomState({
    turn: 0,
    level: 4,
    treasury: -5,
    materials: '坏值',
    laborRolled: true,
    laborPoints: -3,
    effectDefs: [],
    buildingDefs: [
      { id: 'x', name: '测试建筑', tier: '未知档', slots: 2, labor: 2, p: 10, effects: [{ type: 'p', value: 5 }] },
    ],
    settlements: [
      {
        id: 's1', name: '测试', type: '村庄', foundedTurn: 3,
        buildings: [{ id: 'b1', defId: 'missing', builtTurn: 5 }],
      },
    ],
  })
  assert.equal('turn' in normalized, false)
  assert.equal('level' in normalized, false)
  assert.equal('laborRolled' in normalized, false)
  assert.equal(normalized.treasury, 0)
  assert.equal(normalized.materials, 4)
  assert.equal(normalized.laborPoints, 0)
  assert.equal(normalized.buildingDefs[0].tier, 'village')
  assert.deepEqual(normalized.settlements[0].buildings, [])
  assert.equal('foundedTurn' in normalized.settlements[0], false)

  const empty = normalizeKingdomState({ settlements: [], buildingDefs: [], effectDefs: [] })
  assert.equal(empty.settlements.length, 1)
  assert.equal(empty.settlements[0].id, 'capital')
  assert.equal(empty.settlements[0].buildings.length, 1)
  assert.equal('builtTurn' in empty.settlements[0].buildings[0], false)
})
