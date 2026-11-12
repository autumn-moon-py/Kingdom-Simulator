import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBuilding,
  buildCost,
  canBuild,
  canFoundSettlement,
  clearBuildings,
  defaultBuildingDefs,
  defaultKingdomState,
  defLabel,
  depositTreasury,
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

test('入库：正负金额调整国库并记录备注', () => {
  const state = defaultKingdomState()
  const before = state.treasury

  const plus = depositTreasury(state, 25, '冒险分成')
  assert.equal(plus.ok, true)
  assert.equal(plus.amount, 25)
  assert.equal(state.treasury, before + 25)
  assert.match(state.log.at(-1).text, /入库：\+25p/)
  assert.match(state.log.at(-1).text, /备注：冒险分成/)

  const minus = depositTreasury(state, -10, '采购')
  assert.equal(minus.ok, true)
  assert.equal(state.treasury, before + 15)
  assert.match(state.log.at(-1).text, /入库：-10p/)
  assert.match(state.log.at(-1).text, /备注：采购/)

  assert.equal(depositTreasury(state, -99999).ok, false)
  assert.equal(state.treasury, before + 15)
  assert.equal(depositTreasury(state, 0).ok, false)
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

test('建筑表 v4：名称、删除项与新增建筑', () => {
  const defs = defaultBuildingDefs()
  const ids = defs.map((d) => d.id)
  for (const id of ['alehouse', 'graveyard', 'brewery', 'blacksmith', 'academy', 'museum']) {
    assert.ok(ids.includes(id))
  }
  for (const id of ['school', 'university', 'grand_market', 'theater']) {
    assert.equal(ids.includes(id), false)
  }
  const names = Object.fromEntries(defs.map((d) => [d.id, d.name]))
  assert.equal(names.house, '民房')
  assert.equal(names.tavern, '旅店')
  assert.equal(names.town_hall, '议事厅')
  assert.equal(names.academy, '学院')
  assert.equal(names.alehouse, '酒馆')
  assert.equal(names.graveyard, '墓地')
  assert.ok(defs.every((d) => !d.alias))
})

test('民心与动荡：建筑民心汇总、事件修正和抵消税收', () => {
  const state = defaultKingdomState()
  state.settlements[0].buildings.push({ id: 'b_shrine', defId: 'shrine' })

  let stats = kingdomStats(state)
  assert.equal(stats.buildingMorale, 1)
  assert.equal(stats.morale, 1)
  assert.equal(stats.unrest, 0)
  assert.equal(stats.netMorale, 1)
  assert.equal(stats.moraleTax, 1)
  assert.equal(stats.baseTax, 15)
  assert.equal(stats.tax, 16)

  state.moraleAdjust = 2
  assert.equal(kingdomStats(state).morale, 3)
  assert.equal(kingdomStats(state).tax, 18)

  state.unrest = 5
  const hindered = kingdomStats(state)
  assert.equal(hindered.netMorale, -2)
  assert.equal(hindered.moraleTax, -2)
  assert.equal(hindered.tax, 13)

  state.unrest = 99
  assert.equal(kingdomStats(state).unrest, 20)
  state.moraleAdjust = -99
  assert.equal(kingdomStats(state).morale, 0)
})

test('城市原址重建：清空建筑后槽位全部空出', () => {
  const state = defaultKingdomState()
  const result = clearBuildings(state, 'capital')
  assert.equal(result.ok, true)
  assert.equal(result.count, 1)
  assert.equal(state.settlements[0].buildings.length, 0)
  assert.equal(clearBuildings(state, 'capital').ok, false)
  assert.equal(clearBuildings(state, 'missing').ok, false)
})

test('旧存档迁移到 v4：建筑改名、旧地标移除、战役建筑补齐、民心转为数值', () => {
  const old = defaultKingdomState()
  old.version = 2
  const newBuildings = ['tavern', 'shrine', 'wall', 'library', 'trade_post']
  const newEffects = ['morale', 'defense', 'research', 'diplomacy']
  old.buildingDefs = old.buildingDefs.filter((d) => !newBuildings.includes(d.id))
  old.effectDefs = old.effectDefs.filter((e) => !newEffects.includes(e.id))

  const migrated = normalizeKingdomState(old)
  assert.equal(migrated.version, 4)
  for (const id of newBuildings) assert.ok(migrated.buildingDefs.some((d) => d.id === id))
  for (const id of newEffects) assert.ok(migrated.effectDefs.some((e) => e.id === id))
  for (const id of ['academy', 'alehouse', 'brewery', 'museum', 'blacksmith', 'graveyard']) {
    assert.ok(migrated.buildingDefs.some((d) => d.id === id))
  }
  for (const id of ['school', 'university', 'grand_market', 'theater']) {
    assert.equal(migrated.buildingDefs.some((d) => d.id === id), false)
  }
  assert.equal(migrated.buildingDefs.find((d) => d.id === 'tavern').name, '旅店')
  assert.equal(migrated.effectDefs.find((e) => e.id === 'morale').kind, 'morale')

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
