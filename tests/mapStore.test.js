import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mapDefaults, pickMapFields, MAP_FIELDS, normalizeMapFields, looksLikeAlias, migrateNoteAliases,
} from '../src/mapStore.js'

test('地图存档只包含六个地图字段', () => {
  assert.deepEqual(MAP_FIELDS, ['hexExplored', 'hexClaimed', 'hexNotes', 'hexAliases', 'pins', 'mapCalib'])
  assert.deepEqual(Object.keys(mapDefaults()).sort(), [...MAP_FIELDS].sort())
})

test('从旧王国存档里只挑出地图字段', () => {
  const saved = {
    hexExplored: { GB1: true },
    hexClaimed: { GB1: true },
    hexNotes: { GB1: '营地' },
    hexAliases: { GB1: '老渡口' },
    pins: { m3: [{ id: 'p1', x: 10, y: 20, name: '渡口' }] },
    mapCalib: { m3: { rot: 1.5 } },
    mapRegions: { 'm3:1,1': 'GB' },
    diplomacy: { 剑爵: true },
    rp: 99,
    level: 7,
    towns: [{ name: '首都' }],
    log: ['第 3 回合'],
  }
  assert.deepEqual(pickMapFields(saved), {
    hexExplored: saved.hexExplored,
    hexClaimed: saved.hexClaimed,
    hexNotes: saved.hexNotes,
    hexAliases: saved.hexAliases,
    pins: saved.pins,
    mapCalib: saved.mapCalib,
  })
})

test('缺失或类型不对的字段不会写进地图存档', () => {
  assert.deepEqual(pickMapFields(null), {})
  assert.deepEqual(pickMapFields({ hexClaimed: [], pins: 'x', mapCalib: null }), {})
  assert.deepEqual(pickMapFields({ hexClaimed: {} }), { hexClaimed: {} })
})

test('别名清洗：去首尾空格，空值丢弃', () => {
  const out = normalizeMapFields({ hexAliases: { RL1: '  老渡口 ', GB1: '   ', GB2: 42 } })
  assert.deepEqual(out.hexAliases, { RL1: '老渡口' })
})

test('备注转别名：只迁移像地名的短备注，备注保留', () => {
  assert.equal(looksLikeAlias('老渡口'), true)
  assert.equal(looksLikeAlias('注意：这里有埋伏'), false)
  assert.equal(looksLikeAlias('第一行\n第二行'), false)
  assert.equal(looksLikeAlias('这是一条超过二十四个字符的备注内容用来测试长度限制是否生效'), false)

  const target = {
    hexNotes: { RL1: '老渡口', RL2: '注意：有埋伏', RL3: '已探索，安全' },
    hexAliases: {},
  }
  assert.equal(migrateNoteAliases(target), 1)
  assert.deepEqual(target.hexAliases, { RL1: '老渡口' })
  assert.deepEqual(target.hexNotes, { RL1: '老渡口', RL2: '注意：有埋伏', RL3: '已探索，安全' })
})

test('备注转别名不覆盖已有别名', () => {
  const target = { hexNotes: { RL1: '旧名字' }, hexAliases: { RL1: '新名字' } }
  assert.equal(migrateNoteAliases(target), 0)
  assert.equal(target.hexAliases.RL1, '新名字')
})
