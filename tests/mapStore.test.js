import test from 'node:test'
import assert from 'node:assert/strict'
import { mapDefaults, pickMapFields, MAP_FIELDS } from '../src/mapStore.js'

test('地图存档只包含六个地图字段', () => {
  assert.deepEqual(MAP_FIELDS, ['hexClaimed', 'hexNotes', 'pins', 'mapRegions', 'mapCalib', 'diplomacy'])
  assert.deepEqual(Object.keys(mapDefaults()).sort(), [...MAP_FIELDS].sort())
})

test('从旧王国存档里只挑出地图字段', () => {
  const saved = {
    hexClaimed: { GB1: true },
    hexNotes: { GB1: '营地' },
    pins: { m3: [{ id: 'p1', x: 10, y: 20, name: '渡口' }] },
    mapRegions: { 'm3:1,1': 'GB' },
    mapCalib: { m3: { rot: 1.5 } },
    diplomacy: { 剑爵: true },
    rp: 99,
    level: 7,
    towns: [{ name: '首都' }],
    log: ['第 3 回合'],
  }
  assert.deepEqual(pickMapFields(saved), {
    hexClaimed: saved.hexClaimed,
    hexNotes: saved.hexNotes,
    pins: saved.pins,
    mapRegions: saved.mapRegions,
    mapCalib: saved.mapCalib,
    diplomacy: saved.diplomacy,
  })
})

test('缺失或类型不对的字段不会写进地图存档', () => {
  assert.deepEqual(pickMapFields(null), {})
  assert.deepEqual(pickMapFields({ hexClaimed: [], pins: 'x', mapCalib: null }), {})
  assert.deepEqual(pickMapFields({ hexClaimed: {} }), { hexClaimed: {} })
})
