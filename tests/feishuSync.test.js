import test from 'node:test'
import assert from 'node:assert/strict'
import { topLevelBlocks, planSectionUpdate } from '../scripts/feishu-sync.js'

test('只取顶层 block，表格与列表内部节点不算兄弟', () => {
  const xml = '<fragment mode="section"><h1 id="H">地图</h1>'
    + '<table id="T"><tbody><tr id="R"><td id="C"><p id="P">格子</p></td></tr></tbody></table>'
    + '<hr id="D1"/><p id="D">以下为手写区，同步不会覆盖。</p><p id="M">手写</p></fragment>'
  const { blocks } = topLevelBlocks(xml)
  assert.deepEqual(blocks.map((b) => b.tag), ['h1', 'table', 'hr', 'p', 'p'])
  assert.deepEqual(blocks.map((b) => b.id), ['H', 'T', 'D1', 'D', 'M'])
})

test('首次同步：清掉标题后的空段落', () => {
  const plan = planSectionUpdate('<fragment><h1 id="H">地图</h1><p id="A"></p><p id="B"></p></fragment>')
  assert.equal(plan.headingId, 'H')
  assert.deepEqual(plan.remove, ['A', 'B'])
})

test('再次同步：清到分隔线为止，手写区保留', () => {
  const xml = '<fragment><h1 id="H">地图</h1><p id="A">概览</p>'
    + '<table id="T"><tbody><tr><td><p>表</p></td></tr></tbody></table>'
    + '<hr id="D1"/><p id="D">以下为手写区，同步不会覆盖。</p><p id="M">我的笔记</p></fragment>'
  const plan = planSectionUpdate(xml)
  assert.deepEqual(plan.remove, ['A', 'T', 'D1', 'D'])
})

test('章节没有标题时明确报错', () => {
  assert.throws(() => planSectionUpdate('<fragment><p id="A">x</p></fragment>'), /没有找到标题块/)
})
