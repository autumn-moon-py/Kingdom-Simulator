import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMapReport, reportToXml } from '../src/mapReport.js'

const REGIONS = [
  { code: 'RL', name: '罗斯特兰腹地' },
  { code: 'GB', name: '翠绿之地' },
]

const cells = [
  { code: 'RL1', region: 'RL', special: true, explored: true, noted: true, note: '贸易站在此', name: '欧莱格贸易站' },
  { code: 'RL2', region: 'RL', special: true, explored: false, noted: false, note: '', name: '博肯小屋' },
  { code: 'RLN1', region: 'RL', special: false, explored: true, noted: false, note: '', name: '' },
  { code: 'RLN2', region: 'RL', special: false, explored: false, noted: true, note: '有埋伏', name: '' },
  { code: 'GB1', region: 'GB', special: true, explored: false, noted: false, note: '', name: '老渡口' },
]

test('汇总总览与区域进度', () => {
  const report = buildMapReport(cells, { regions: REGIONS, generatedAt: '2026-11-04 20:00', viewLabel: '全图 · 全部区域' })
  assert.equal(report.totals.cells, 5)
  assert.equal(report.totals.explored, 2)
  assert.equal(report.totals.unexplored, 3)
  assert.equal(report.totals.special, 3)
  assert.equal(report.totals.specialExplored, 1)
  assert.equal(report.totals.plain, 2)
  assert.equal(report.totals.plainExplored, 1)
  assert.equal(report.totals.noted, 2)
  assert.equal(report.totals.hiddenNotes, 1)

  assert.deepEqual(report.regions.map((r) => r.code), ['RL', 'GB'])
  assert.deepEqual(report.regions[0], {
    code: 'RL', name: '罗斯特兰腹地', cells: 4, explored: 2,
    special: 2, specialExplored: 1, plain: 2, plainExplored: 1,
  })
})

test('未探索格的地点名与备注不进入文档', () => {
  const report = buildMapReport(cells, { regions: REGIONS })
  const xml = reportToXml(report, { regions: REGIONS })
  assert.match(xml, /欧莱格贸易站/)
  assert.match(xml, /贸易站在此/)
  assert.match(xml, /RL2/)
  assert.doesNotMatch(xml, /博肯小屋/)
  assert.doesNotMatch(xml, /老渡口/)
  assert.doesNotMatch(xml, /有埋伏/)
  assert.match(xml, /另有 1 个未探索格带有备注/)
})

test('特殊格按区域顺序与编号数字排序', () => {
  const report = buildMapReport([
    { code: 'GB1', region: 'GB', special: true, explored: true, noted: false, note: '', name: '' },
    { code: 'RL10', region: 'RL', special: true, explored: true, noted: false, note: '', name: '' },
    { code: 'RL2', region: 'RL', special: true, explored: true, noted: false, note: '', name: '' },
  ], { regions: REGIONS })
  assert.deepEqual(report.specialExplored.map((x) => x.code), ['RL2', 'RL10', 'GB1'])
})

test('XML 转义与空清单', () => {
  const report = buildMapReport([], { regions: REGIONS, generatedAt: '2026-11-04' })
  const xml = reportToXml(report, { regions: REGIONS })
  assert.equal(report.totals.cells, 0)
  assert.match(xml, /已探索 <b>0<\/b> \/ 0 格/)
  assert.match(xml, /暂无备注/)
  assert.match(xml, /<!--MAP_IMAGE-->/)

  const escaped = reportToXml(buildMapReport([
    { code: 'RL1', region: 'RL', special: false, explored: true, noted: true, note: 'A & B < 3', name: '' },
  ], { regions: REGIONS }), { regions: REGIONS })
  assert.match(escaped, /A &amp; B &lt; 3/)
})
