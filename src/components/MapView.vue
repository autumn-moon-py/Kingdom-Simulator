<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { state } from '../store.js'
import mapData from '../data/mapLabels.json'
import hexes from '../data/hexes.json'
import groups from '../data/groups.json'

const maps = mapData.maps
const labels = mapData.labels
const layout = mapData.layout
const byCode = Object.fromEntries(hexes.map((h) => [h.code, h]))

// 群组归属：kind 形如「聚居地（SH5）」，从中取出其主六角格编号
const GROUP_COLORS = ['#b5642f', '#3f6f8f', '#4d7a4d', '#8a5a9e', '#a8873a', '#8f3f45', '#2f7f7a', '#6b6b2f']
const groupByCode = {}
groups.forEach((g, i) => {
  const m = String(g.kind || '').match(/（([A-Z]{2}\d+)）/)
  if (m) groupByCode[m[1]] = { ...g, color: GROUP_COLORS[i % GROUP_COLORS.length] }
})
const diploMode = ref(false)
const diploList = computed(() => groups.map((g, i) => {
  const m = String(g.kind || '').match(/（([A-Z]{2}\d+)）/)
  return { name: g.name, kind: g.kind, army: g.army, dc: g.dc ?? null, code: m ? m[1] : '', color: GROUP_COLORS[i % GROUP_COLORS.length] }
}))

// 区域：编号前缀即区域码，名称取自第二章「六角格.md」的 19 个区域
const REGIONS = [
  ['RL', '罗斯特兰腹地'], ['GB', '翠绿之地'], ['TW', '獠牙湖'], ['KL', '卡姆兰德'], ['NM', '纳马彻斯森林'],
  ['SH', '塞伦丘陵'], ['DS', '邓斯沃德'], ['NH', '诺门高地'], ['LV', '勒维尼斯山峦'], ['HT', '钩舌沼泽'],
  ['DR', '德雷列夫'], ['TL', '虎领主领'], ['RU', '灯火'], ['GL', '格莱尼邦低地'], ['PX', '皮塔克斯'],
  ['GU', '格莱尼邦高地'], ['NU', '努梅里亚'], ['TV', '千声之地'], ['BR', '布兰特伦德山脉'],
]
const regionName = Object.fromEntries(REGIONS)
function regionOf(code) { const m = String(code).match(/^[A-Z]+/); return m ? m[0] : '' }
function regionColor(code) { const i = REGIONS.findIndex((r) => r[0] === regionOf(code)); const h = ((i < 0 ? 0 : i) * 47) % 360; return `hsl(${h} 55% 42%)` }
const regionList = computed(() => REGIONS
  .map(([code, name]) => ({ code, name, color: regionColor(code), count: labels.filter((l) => regionOf(l.code) === code).length }))
  .filter((r) => r.count))

/* ---------- 图幅与预载 ---------- */
const photos = import.meta.glob('../assets/map-*.jpg', { eager: true, query: '?url', import: 'default' })
const srcOf = (file) => photos[`../assets/${file}`]
const imageCache = new Map()
function cachedImage(m) {
  let img = imageCache.get(m.id)
  if (!img) {
    img = new Image()
    img.decoding = 'async'
    img.src = srcOf(m.file)
    imageCache.set(m.id, img)
  }
  return img
}
function whenReady(img) {
  if (img.complete && img.naturalWidth) {
    return img.decode ? img.decode().catch(() => {}).then(() => img) : Promise.resolve(img)
  }
  return new Promise((resolve, reject) => {
    img.addEventListener('load', () => resolve(img), { once: true })
    img.addEventListener('error', reject, { once: true })
  })
}

/* ---------- 选择状态 ---------- */
const selectedIds = ref(['m3'])
const activeId = ref('m3')
const shownMaps = computed(() => maps.filter((m) => selectedIds.value.includes(m.id)))
// 连续画布：取所选图幅的横向并集（纵向固定为四图共同覆盖的地图带）
const view = computed(() => {
  const sel = shownMaps.value
  const x0 = Math.min(...sel.map((m) => m.left))
  const x1 = Math.max(...sel.map((m) => m.left + m.w))
  return { x: x0, w: x1 - x0, h: layout.h }
})
const activeMap = computed(() => maps.find((m) => m.id === activeId.value) || maps[0])
const selKey = ref('RL1')
const query = ref('')
const jumpMsg = ref('')
const addMode = ref(false)
const showGrid = ref(true)
const hoverKey = ref('')

function toggleSheet(id) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) {
    if (selectedIds.value.length === 1) return
    selectedIds.value.splice(i, 1)
    if (activeId.value === id) activeId.value = selectedIds.value[0]
  } else {
    selectedIds.value.push(id)
    activeId.value = id
  }
}
function selectAllSheets() {
  selectedIds.value = maps.map((m) => m.id)
}

/* ---------- 格网：格心 = (x0 + W*(q + r/2), y0 + 0.75H*r)，可整体旋转 ---------- */
function calOf(m) { return (state.mapCalib || {})[m.id] || {} }
function updateCal(field, value) {
  const id = activeMap.value.id
  const next = { ...((state.mapCalib || {})[id] || {}) }
  if (value === '' || value === null) delete next[field]
  else next[field] = Number(value)
  if (!state.mapCalib) state.mapCalib = {}
  state.mapCalib[id] = next
}
function resetCal() {
  if (!state.mapCalib) state.mapCalib = {}
  state.mapCalib[activeMap.value.id] = {}
}
const activeCal = computed(() => calOf(activeMap.value))

function gridOf(m) {
  const c = calOf(m)
  const W = Number(c.W) || m.W
  const H = Number(c.H) || m.H
  return {
    W, H,
    X0: (c.x0 ?? m.x0) + (m.parity ? W / 2 : 0),
    y0: c.y0 ?? m.y0,
    rot: Number(c.rot) || 0,
    cx: m.w / 2,
    cy: m.h / 2,
  }
}
function rotatePoint(g, x, y, deg) {
  if (!deg) return [x, y]
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  const dx = x - g.cx, dy = y - g.cy
  return [g.cx + dx * cos - dy * sin, g.cy + dx * sin + dy * cos]
}
function cellCenter(g, q, r) {
  const x = g.X0 + g.W * (q + r / 2)
  const y = g.y0 + 0.75 * g.H * r
  return rotatePoint(g, x, y, g.rot)
}
function cellPoints(g, q, r) {
  const [cx, cy] = cellCenter(g, q, r)
  const { W, H } = g
  return [[cx, cy - H / 2], [cx + W / 2, cy - H / 4], [cx + W / 2, cy + H / 4],
          [cx, cy + H / 2], [cx - W / 2, cy + H / 4], [cx - W / 2, cy - H / 4]]
    .map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')
}
function cubeRound(qf, rf) {
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(-qf - rf)
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - (-qf - rf))
  if (dq > dr && dq > ds) q = -r - s
  else if (dr > ds) r = -q - s
  return [q, r]
}
// 像素 → 覆盖该点的格（先反旋转，再轴向四舍五入）
function cellAt(g, x, y) {
  let px = x, py = y
  if (g.rot) [px, py] = rotatePoint(g, x, y, -g.rot)
  const rf = (py - g.y0) / (0.75 * g.H)
  return cubeRound((px - g.X0) / g.W - rf / 2, rf)
}

// 每个图幅的格网只算一次：换图幅、切选中都不再重建
const geomCache = new Map()
function buildGeom(m) {
  const g = gridOf(m)
  const key = [m.id, g.W, g.H, g.X0, g.y0, g.rot].join('|')
  const hit = geomCache.get(key)
  if (hit) return hit

  const pad = g.rot ? 4 : 1
  const cells = []
  const rLo = Math.floor(-g.y0 / (0.75 * g.H)) - pad
  const rHi = Math.ceil((m.h - g.y0) / (0.75 * g.H)) + pad
  for (let r = rLo; r <= rHi; r++) {
    const cy = g.y0 + 0.75 * g.H * r
    if (!g.rot && (cy < -g.H / 2 || cy > m.h + g.H / 2)) continue
    const qLo = Math.floor(-g.X0 / g.W - r / 2) - pad
    const qHi = Math.ceil((m.w - g.X0) / g.W - r / 2) + pad
    for (let q = qLo; q <= qHi; q++) {
      const cx = cellCenter(g, q, r)[0]
      if (!g.rot && (cx < -g.W / 2 || cx > m.w + g.W / 2)) continue
      cells.push({ q, r, key: `${m.id}:${q},${r}`, pts: cellPoints(g, q, r) })
    }
  }
  const byKey = Object.fromEntries(cells.map((c) => [c.key, c]))

  // 第几行第几格（供界面说话用；按行内从左到右编号）
  const byRow = {}
  for (const c of cells) (byRow[c.r] = byRow[c.r] || []).push(c)
  const cellIndex = {}
  Object.keys(byRow).map(Number).sort((a, b) => a - b).forEach((r, i) => {
    byRow[r].sort((a, b) => a.q - b.q).forEach((c, j) => { cellIndex[c.key] = { row: i + 1, col: j + 1 } })
  })

  // 编号点落在哪一格 / 该格挂着哪个编号
  const here = hereOf(m)
  const labelCell = {}
  const codeOfCell = {}
  for (const l of here) {
    const k = `${m.id}:${cellAt(g, l.x, l.y).join(',')}`
    labelCell[l.code] = k
    if (!codeOfCell[k]) codeOfCell[k] = l.code
  }

  const out = { m, g, cells, byKey, cellIndex, here, labelCell, codeOfCell }
  geomCache.set(key, out)
  return out
}
const hereCache = new Map()
function hereOf(m) {
  if (!hereCache.has(m.id)) hereCache.set(m.id, labels.filter((l) => l.map === m.id))
  return hereCache.get(m.id)
}
function geomOf(m) { return buildGeom(m) }

/* ---------- 显示范围 ---------- */
const scope = ref('marked')
const allHere = computed(() => labels.filter((l) => selectedIds.value.includes(l.map)))
const scopeRegions = computed(() => REGIONS
  .map(([code, name]) => ({ code, name, count: allHere.value.filter((l) => regionOf(l.code) === code).length }))
  .filter((r) => r.count))
function shownFor(geo) {
  let out = geo.here
  if (scope.value === 'marked') out = out.filter((l) => state.hexNotes[l.code] || state.hexClaimed[l.code])
  else if (scope.value !== 'all') out = out.filter((l) => regionOf(l.code) === scope.value)
  // 当前选中的格即使落在范围外也留着，否则「跳到编号」会跳到看不见的位置
  const cur = geo.here.find((l) => l.code === selKey.value)
  return cur && !out.includes(cur) ? [...out, cur] : out
}
function stateCellsFor(geo) {
  const out = []
  for (const c of geo.cells) {
    const code = geo.codeOfCell[c.key]
    const claimed = !!state.hexClaimed[c.key] || !!(code && state.hexClaimed[code])
    const noted = !!state.hexNotes[c.key] || !!(code && state.hexNotes[code])
    if (claimed || noted) out.push({ key: c.key, pts: c.pts, cls: { claimed, noted: !claimed } })
  }
  return out
}
function regionCellsFor(geo) {
  if (!regionMode.value) return []
  const out = []
  for (const c of geo.cells) {
    const manual = (state.mapRegions || {})[c.key]
    const code = manual || regionOf(geo.codeOfCell[c.key] || '')
    if (code) out.push({ key: c.key, pts: c.pts, color: regionColor(code), manual: !!manual })
  }
  return out
}
// 左缘渐隐宽度：前一张图幅与本图幅的重叠像素（相邻裁片只重叠 24–25px）
function leftFade(m) {
  const i = maps.findIndex((x) => x.id === m.id)
  const prev = maps[i - 1]
  if (!prev || !selectedIds.value.includes(prev.id)) return 0
  return Math.max(0, prev.left + prev.w - m.left)
}
const sheets = computed(() => shownMaps.value.map((m) => {
  const geo = geomOf(m)
  const v = view.value
  const fade = leftFade(m)
  return {
    m, geo,
    // 在连续画布中的位置（相对当前 union 视图）
    style: {
      left: ((m.left - v.x) / v.w) * 100 + '%',
      top: (m.top / v.h) * 100 + '%',
      width: (m.w / v.w) * 100 + '%',
      height: (m.h / v.h) * 100 + '%',
    },
    fade,
    fadePct: fade ? (fade / m.w) * 100 + '%' : '',
    shown: shownFor(geo),
    stateCells: stateCellsFor(geo),
    regionCells: regionCellsFor(geo),
    pins: state.pins[m.id] || [],
  }
}))
const totalHere = computed(() => sheets.value.reduce((n, s) => n + s.geo.here.length, 0))
const totalShown = computed(() => sheets.value.reduce((n, s) => n + s.shown.length, 0))

// 换图幅后原来选的区域可能不存在，退回默认范围，免得图上一片空白
watch(selectedIds, () => {
  const s = scope.value
  if (s !== 'marked' && s !== 'all' && !scopeRegions.value.some((r) => r.code === s)) scope.value = 'marked'
  hoverKey.value = ''
}, { deep: true })

/* ---------- 选中 ---------- */
const activeGeo = computed(() => geomOf(activeMap.value))
// 编号与格子共用一个选中：选编号时换算到它所在的格，区域标注与高亮才有落点
const selCellKey = computed(() => {
  if (activeGeo.value.byKey[selKey.value]) return selKey.value
  const l = curLabel.value
  return l ? (activeGeo.value.labelCell[l.code] || '') : ''
})
const selCell = computed(() => activeGeo.value.byKey[selCellKey.value])
const selIndex = computed(() => activeGeo.value.cellIndex[selCellKey.value])
const selText = computed(() => {
  if (curPin.value) return curPin.value.name
  if (selIndex.value) return `第 ${selIndex.value.row} 行第 ${selIndex.value.col} 格`
  return selKey.value || '未选中'
})
const info = computed(() => byCode[selKey.value])
const curLabel = computed(() => labels.find((l) => l.code === selKey.value))
const curPin = computed(() => {
  if (!String(selKey.value).startsWith('pin:')) return null
  const id = selKey.value.slice(4)
  return (state.pins[activeId.value] || []).find((p) => p.id === id) || null
})

function pick(code) {
  const l = labels.find((x) => x.code === code)
  if (!l) return
  activeId.value = l.map
  if (!selectedIds.value.includes(l.map)) selectedIds.value.push(l.map)
  selKey.value = code
}
function jump() {
  const q = query.value.trim().toUpperCase()
  if (!q) return
  const l = labels.find((x) => x.code === q)
  if (!l) { jumpMsg.value = `没有编号 ${q}`; return }
  jumpMsg.value = ''
  pick(q)
}
function selectPin(mapId, p) {
  activeId.value = mapId
  selKey.value = 'pin:' + p.id
}

// 点哪儿标哪儿 + 点格选格：先把点击换算到全景像素，再落到具体图幅的本地坐标
function viewPoint(e) {
  const r = e.currentTarget.getBoundingClientRect()
  return [
    view.value.x + ((e.clientX - r.left) / r.width) * view.value.w,
    ((e.clientY - r.top) / r.height) * view.value.h,
  ]
}
// 重叠区取后画的图幅（与 DOM 绘制顺序一致）
function mapAt(x, y) {
  const list = sheets.value
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i].m
    if (x >= m.left && x <= m.left + m.w && y >= m.top && y <= m.top + m.h) return m
  }
  return null
}
function onMapClick(e) {
  const [x, y] = viewPoint(e)
  const m = mapAt(x, y)
  if (!m) return
  activeId.value = m.id
  const lx = x - m.left
  const ly = y - m.top
  if (addMode.value) {
    if (!state.pins[m.id]) state.pins[m.id] = []
    const id = Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36)
    const pin = { id, x: Math.round(lx), y: Math.round(ly), name: '新标记 ' + (state.pins[m.id].length + 1) }
    state.pins[m.id].push(pin)
    selKey.value = 'pin:' + id
    addMode.value = false
    return
  }
  const geo = geomOf(m)
  const key = `${m.id}:${cellAt(geo.g, lx, ly).join(',')}`
  if (!geo.byKey[key]) return
  selKey.value = geo.codeOfCell[key] || key
  if (regionMode.value) {
    if (!state.mapRegions) state.mapRegions = {}
    if (paintCode.value) state.mapRegions[key] = paintCode.value
    else delete state.mapRegions[key]
  }
}
function onMapMove(e) {
  if (addMode.value) { hoverKey.value = ''; return }
  const [x, y] = viewPoint(e)
  const m = mapAt(x, y)
  if (!m) { hoverKey.value = ''; return }
  const geo = geomOf(m)
  const key = `${m.id}:${cellAt(geo.g, x - m.left, y - m.top).join(',')}`
  hoverKey.value = geo.byKey[key] ? key : ''
}
function hoverOf(s) { return s.geo.byKey[hoverKey.value] }

function removePin() {
  const p = curPin.value
  if (!p) return
  const arr = state.pins[activeId.value]
  if (!arr) return
  arr.splice(arr.indexOf(p), 1)
  delete state.hexNotes[selKey.value]
  delete state.hexClaimed[selKey.value]
  selKey.value = ''
}

// 编号点／自定标记在连续画布上的位置
function pinPos(m, x, y) {
  const v = view.value
  return {
    left: (((m.left + x - v.x) / v.w) * 100).toFixed(3) + '%',
    top: (((m.top + y) / v.h) * 100).toFixed(3) + '%',
  }
}

/* ---------- 键盘与外部点击 ---------- */
function onDocClick(e) {
  if (!selKey.value) return
  if (e.target.closest('.mapwrap, .mapAside, .mapBar, button, input, select, textarea, label, a')) return
  selKey.value = ''
}
function onKey(e) {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (!curPin.value) return
  e.preventDefault()
  removePin()
}

/* ---------- 区域标注（调试） ---------- */
const regionMode = ref(false)
const paintCode = ref('')
const regionMsg = ref('')
// 自动归属：带编号的格本来就从前缀知道区域；手动标注只用来补未编号的格或改覆盖
const autoRegionMap = computed(() => {
  const out = {}
  for (const m of maps) {
    const geo = geomOf(m)
    for (const [code, key] of Object.entries(geo.labelCell)) {
      if (key) out[key] = regionOf(code)
    }
  }
  return out
})
const regionMap = computed(() => ({ ...autoRegionMap.value, ...(state.mapRegions || {}) }))
const regionSummary = computed(() => {
  const counts = {}
  for (const code of Object.values(regionMap.value)) counts[code] = (counts[code] || 0) + 1
  return REGIONS
    .map(([code, name]) => ({ code, name, color: regionColor(code), count: counts[code] || 0 }))
    .filter((r) => r.count)
})
const autoRegionTotal = computed(() => Object.keys(autoRegionMap.value).length)
const manualRegionTotal = computed(() => Object.keys(state.mapRegions || {}).length)
const regionTotal = computed(() => Object.keys(regionMap.value).length)
const selRegionAuto = computed(() => {
  const key = selCellKey.value
  return !!key && !!activeGeo.value.codeOfCell[key] && !(state.mapRegions || {})[key]
})
function regionOfSel() {
  const key = selCellKey.value
  const manual = (state.mapRegions || {})[key]
  if (manual) return manual
  const code = activeGeo.value.codeOfCell[key]
  return code ? regionOf(code) : ''
}
function setSelRegion(code) {
  if (!selCellKey.value) return
  if (!state.mapRegions) state.mapRegions = {}
  if (code) state.mapRegions[selCellKey.value] = code
  else delete state.mapRegions[selCellKey.value]
}
async function copyRegions() {
  const text = JSON.stringify(regionMap.value, null, 1)
  try {
    await navigator.clipboard.writeText(text)
    regionMsg.value = `区域 JSON 已复制（${regionTotal.value} 格，含自动归属）。`
  } catch {
    window.prompt('复制下面的 JSON', text)
  }
}
function exportRegions() {
  const blob = new Blob([JSON.stringify(regionMap.value, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = '地图区域汇总.json'
  a.click()
  URL.revokeObjectURL(a.href)
}
function clearRegions() {
  const n = manualRegionTotal.value
  if (!n) return
  if (!confirm(`清空 ${n} 格手动标注？带编号的格仍会按前缀自动归属。`)) return
  state.mapRegions = {}
  regionMsg.value = '已清空手动标注。'
}

/* ---------- 导出地图图片 ---------- */
const exporting = ref('')
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
function drawChip(ctx, text, cx, cy) {
  ctx.font = '12px "PingFang SC", "Noto Sans CJK SC", sans-serif'
  const w = ctx.measureText(text).width + 10
  roundRect(ctx, cx - w / 2, cy - 18, w, 18, 3)
  ctx.fillStyle = 'rgba(30, 28, 24, 0.84)'
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, cy - 9)
}
function ptsOf(s) {
  return s.split(' ').map((p) => p.split(',').map(Number))
}
function drawSheet(ctx, s, ox, oy) {
  const { m } = s
  ctx.save()
  ctx.beginPath()
  ctx.rect(ox, oy, m.w, m.h)
  ctx.clip()

  // 已占据 / 已备注
  for (const c of s.stateCells) {
    const pts = ptsOf(c.pts)
    ctx.beginPath()
    ctx.moveTo(ox + pts[0][0], oy + pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(ox + pts[i][0], oy + pts[i][1])
    ctx.closePath()
    ctx.fillStyle = c.cls.claimed ? 'rgba(77, 122, 77, 0.28)' : 'rgba(176, 138, 69, 0.24)'
    ctx.fill()
  }

  // 编号点
  for (const l of s.shown) {
    const px = ox + l.x, py = oy + l.y
    ctx.beginPath()
    ctx.arc(px, py, 5, 0, Math.PI * 2)
    ctx.fillStyle = state.hexClaimed[l.code] ? '#4d7a4d' : '#7a5a25'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fbf9f3'
    ctx.stroke()
    drawChip(ctx, l.code, px, py - 6)
  }

  // 自定标记
  for (const p of s.pins) {
    const px = ox + p.x, py = oy + p.y
    ctx.fillStyle = '#3f6f8f'
    ctx.fillRect(px - 6, py - 6, 12, 12)
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fbf9f3'
    ctx.strokeRect(px - 6, py - 6, 12, 12)
    drawChip(ctx, p.name, px, py - 8)
  }
  ctx.restore()
}
// 导出时把重叠处左缘擦成渐变 alpha，与页面上的渐隐一致
function fadeLeft(img, w, h, fade) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-in'
  const g = ctx.createLinearGradient(0, 0, fade, 0)
  g.addColorStop(0, 'rgba(0, 0, 0, 0)')
  g.addColorStop(1, 'rgba(0, 0, 0, 1)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  return c
}
async function exportMap() {
  if (exporting.value || !sheets.value.length) return
  exporting.value = '正在导出…'
  try {
    const v = view.value
    const canvas = document.createElement('canvas')
    canvas.width = v.w
    canvas.height = v.h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#f4f1e9'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // 底图按实测偏移铺开；相邻重叠区的左缘渐隐，接缝不可见
    for (const s of sheets.value) {
      const img = await whenReady(cachedImage(s.m))
      const src = s.fade ? fadeLeft(img, s.m.w, s.m.h, s.fade) : img
      ctx.drawImage(src, s.m.left - v.x, s.m.top, s.m.w, s.m.h)
    }
    // 叠层最后统一画，免得编号与色块被相邻图幅的渐隐压暗
    for (const s of sheets.value) {
      ctx.save()
      ctx.translate(s.m.left - v.x, s.m.top)
      drawSheet(ctx, s, 0, 0)
      ctx.restore()
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) { exporting.value = '导出失败'; return }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `失窃之地-探索地图-第${state.turn}回合.png`
    a.click()
    URL.revokeObjectURL(a.href)
    exporting.value = '已导出'
    setTimeout(() => { exporting.value = '' }, 1800)
  } catch (err) {
    exporting.value = '导出失败'
  }
}

/* ---------- 初始化 ---------- */
onMounted(() => {
  // 地图不会变：进页面就把四张底图解到内存，换图幅不再等网络与解码
  for (const m of maps) {
    const img = cachedImage(m)
    if (img.decode) img.decode().catch(() => {})
  }
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)

  // 旧存档的落点按 west/east 坐标存，换成四块裁片后跟着换算，免得用户自己打的点丢掉
  const move = {
    west: [[3, 0, 0, 563], [4, 540, -2, null]],
    east: [[1, 0, 0, 582], [2, 556, -2, null]],
  }
  for (const oldId of ['west', 'east']) {
    const arr = state.pins[oldId]
    if (!arr) continue
    for (const p of arr) {
      const seg = move[oldId].find(([, , , lim]) => lim === null || p.x < lim)
      if (!seg) continue
      const [n, dx, dy] = seg
      if (!state.pins['m' + n]) state.pins['m' + n] = []
      state.pins['m' + n].push({ ...p, x: Math.round(p.x - dx), y: Math.round(p.y - dy) })
    }
    delete state.pins[oldId]
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="panel">
    <h2>地图</h2>
    <div class="mapBar">
      <div class="field">
        <label>图幅<span class="muted">（可多选）</span></label>
        <div class="sheetPick">
          <button
            v-for="(m, i) in maps"
            :key="m.id"
            class="sheetBtn"
            :class="{ on: selectedIds.includes(m.id) }"
            :title="m.title"
            @click="toggleSheet(m.id)"
          >{{ i + 1 }}</button>
          <button class="sheetBtn" @click="selectAllSheets">全选</button>
        </div>
      </div>
      <div class="field">
        <label>显示<span class="muted">（{{ totalShown }} / {{ totalHere }}）</span></label>
        <select v-model="scope" style="max-width: 210px">
          <option value="marked">已占据／已备注</option>
          <option value="all">全部格子</option>
          <option v-for="r in scopeRegions" :key="r.code" :value="r.code">{{ r.code }} {{ r.name }}（{{ r.count }}）</option>
        </select>
      </div>
      <div class="field">
        <label>跳到编号</label>
        <input v-model="query" placeholder="如 GB1、RL1、TW5" @keyup.enter="jump" style="width: 140px" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="act" :class="{ on: addMode }" @click="addMode = !addMode">
          {{ addMode ? '点击地图落点…' : '添加标记' }}
        </button>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="act" :class="{ on: diploMode }" @click="diploMode = !diploMode">外交归属</button>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <label class="check" style="padding-top: 6px">
          <input type="checkbox" v-model="showGrid" /><span>格网</span>
        </label>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="act" :disabled="!!exporting" @click="exportMap">{{ exporting || '导出地图图片' }}</button>
      </div>
      <div class="field">
        <label>当前</label>
        <div style="padding-top: 7px"><span class="tag">{{ selText }}</span></div>
      </div>
    </div>
    <p class="muted" v-if="jumpMsg">{{ jumpMsg }}</p>

    <details class="more" style="margin: 4px 0 14px">
      <summary>区域标注 / 网格校准<span class="muted">　调试</span></summary>
      <div class="row" style="margin-top: 10px">
        <div class="field">
          <label>标注模式</label>
          <label class="check" style="padding-top: 6px">
            <input type="checkbox" v-model="regionMode" /><span>点格子即标注</span>
          </label>
        </div>
        <div class="field">
          <label>涂成哪个区域</label>
          <select v-model="paintCode" style="min-width: 180px">
            <option value="">清除标注</option>
            <option v-for="r in REGIONS" :key="r[0]" :value="r[0]">{{ r[0] }} {{ r[1] }}</option>
          </select>
        </div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="!regionTotal" @click="copyRegions">复制标注 JSON</button></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="!regionTotal" @click="exportRegions">导出标注文件</button></div>
        <div class="field"><label>&nbsp;</label><button class="act" :disabled="!manualRegionTotal" @click="clearRegions">清空标注</button></div>
      </div>
      <p class="muted">合计 {{ regionTotal }} 格（编号自动 {{ autoRegionTotal }} · 手动 {{ manualRegionTotal }}）。带编号的格已按前缀自动归属；手动标注只补未编号的格或改覆盖。采完把 JSON 发我，用来生成区域分界线。</p>
      <p class="muted" v-if="regionMsg">{{ regionMsg }}</p>
      <table v-if="regionSummary.length" style="margin-top: 10px">
        <thead><tr><th>区域</th><th style="width: 120px">已标格数</th></tr></thead>
        <tbody>
          <tr v-for="r in regionSummary" :key="r.code">
            <td><span class="swatch" :style="{ background: r.color }"></span>{{ r.code }} {{ r.name }}</td>
            <td class="num">{{ r.count }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="calTitle">当前图幅校准 · {{ activeMap.title }}</h3>
      <div class="row" style="margin-top: 8px">
        <div class="field"><label>旋转（度）</label><input type="number" step="0.1" :value="activeCal.rot ?? 0" @change="updateCal('rot', $event.target.value)" style="width: 90px" /></div>
        <div class="field"><label>x0</label><input type="number" step="0.1" :value="activeCal.x0 ?? activeMap.x0" @change="updateCal('x0', $event.target.value)" style="width: 90px" /></div>
        <div class="field"><label>y0</label><input type="number" step="0.1" :value="activeCal.y0 ?? activeMap.y0" @change="updateCal('y0', $event.target.value)" style="width: 90px" /></div>
        <div class="field"><label>格宽 W</label><input type="number" step="0.01" :value="activeCal.W ?? activeMap.W" @change="updateCal('W', $event.target.value)" style="width: 100px" /></div>
        <div class="field"><label>格高 H</label><input type="number" step="0.01" :value="activeCal.H ?? activeMap.H" @change="updateCal('H', $event.target.value)" style="width: 100px" /></div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="resetCal">复位本图幅</button></div>
      </div>
      <p class="muted">改动即时生效并随存档保存。旋转以图幅中心为轴；先转角度，再微调 x0／y0。</p>
    </details>

    <div class="mapLayout">
      <div class="mapCol">
        <div
          class="mapwrap"
          :class="{ adding: addMode }"
          :style="{ aspectRatio: `${view.w} / ${view.h}` }"
          @click="onMapClick"
          @mousemove="onMapMove"
          @mouseleave="hoverKey = ''"
        >
          <img
            v-for="s in sheets"
            :key="s.m.id"
            class="sheet"
            :class="{ fade: !!s.fade }"
            :style="s.fade ? { ...s.style, '--fade': s.fadePct } : s.style"
            :src="srcOf(s.m.file)"
            :alt="s.m.title"
            draggable="false"
            loading="eager"
            decoding="async"
          />
          <svg
            v-for="s in sheets"
            :key="'hex:' + s.m.id"
            class="hexlayer"
            :style="s.style"
            :viewBox="`0 0 ${s.m.w} ${s.m.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon v-for="c in (showGrid ? s.geo.cells : [])" :key="c.key" class="hex" :points="c.pts" />
            <polygon v-for="c in s.regionCells" :key="'r' + c.key" class="hex-region" :class="{ auto: !c.manual }" :points="c.pts" :style="{ fill: c.color }" />
            <polygon v-for="c in s.stateCells" :key="'s' + c.key" class="hex-st" :class="c.cls" :points="c.pts" />
            <polygon v-if="hoverOf(s)" class="hex-hover" :points="hoverOf(s).pts" />
            <polygon v-if="selCell && s.m.id === activeId" class="hex-sel" :points="selCell.pts" />
          </svg>
          <template v-for="s in sheets" :key="'pin:' + s.m.id">
            <button
              v-for="l in s.shown"
              :key="l.code"
              class="pin"
              :class="{ sel: l.code === selKey, noted: !!state.hexNotes[l.code], claimed: !!state.hexClaimed[l.code], grp: diploMode, home: diploMode && !!groupByCode[l.code] }"
              :style="{ ...pinPos(s.m, l.x, l.y), '--grp': diploMode ? (groupByCode[l.code] ? groupByCode[l.code].color : regionColor(l.code)) : null }"
              @click.stop="pick(l.code)"
            >
              <span class="dot"></span><span class="code">{{ l.code }}</span>
              <span class="gcode" v-if="diploMode">{{ groupByCode[l.code] ? groupByCode[l.code].name : (regionName[regionOf(l.code)] || regionOf(l.code)) }}</span>
            </button>
            <button
              v-for="p in s.pins"
              :key="s.m.id + ':' + p.id"
              class="pin mine"
              :class="{ sel: 'pin:' + p.id === selKey, noted: !!state.hexNotes['pin:' + p.id], claimed: !!state.hexClaimed['pin:' + p.id] }"
              :style="pinPos(s.m, p.x, p.y)"
              @click.stop="selectPin(s.m.id, p)"
            >
              <span class="dot"></span><span class="code">{{ p.name }}</span>
            </button>
          </template>
        </div>
      </div>

      <aside class="mapAside" :class="{ empty: !selKey }">
        <template v-if="selKey">
          <div class="asideHead">
            <h3>{{ curPin ? curPin.name : selKey }}</h3>
            <button class="act mini" @click="selKey = ''">关闭</button>
          </div>
          <p class="muted" v-if="selCell" style="margin-bottom: 10px">{{ activeMap.title }} · {{ selText }}</p>

          <template v-if="curPin">
            <div class="field" style="margin-bottom: 10px">
              <label>标记名称</label>
              <input v-model="curPin.name" />
            </div>
          </template>
          <template v-else-if="info">
            <p class="muted">{{ info.region }} · {{ info.name }}</p>
            <p class="prose">{{ info.resource }}</p>
          </template>
          <template v-else-if="selCell">
            <p class="muted">这一格原模组没有编号，可自行占据或写备注。</p>
          </template>
          <p class="muted" v-else-if="curLabel">本图未收录这一格的资源条目。</p>

          <label class="check" style="margin: 10px 0">
            <input type="checkbox" v-model="state.hexClaimed[selKey]" />
            <span>已被王国占据</span>
          </label>
          <div class="field">
            <label>备注</label>
            <textarea v-model="state.hexNotes[selKey]"></textarea>
          </div>
          <div class="field" v-if="regionMode && selCell" style="margin-top: 10px">
            <label>所属区域（调试）</label>
            <select :value="regionOfSel()" @change="setSelRegion($event.target.value)">
              <option value="">跟随编号 / 未标注</option>
              <option v-for="r in REGIONS" :key="r[0]" :value="r[0]">{{ r[0] }} {{ r[1] }}</option>
            </select>
            <span class="muted" v-if="selRegionAuto" style="font-size: 12px">当前按编号前缀自动归属</span>
          </div>
          <button v-if="curPin" class="act" style="margin-top: 12px" @click="removePin">删除这个标记（Delete）</button>
        </template>
        <p v-else class="muted">点一个格子看详情。选中后按 Delete 可删除自定标记。</p>
      </aside>
    </div>
  </div>

  <div class="panel" v-if="diploMode">
    <h2>区域与外交归属</h2>
    <p class="muted">图上同色圆点＝同一区域（按六角格编号前缀）；外圈更大的实心点＝某群组的聚居地主格。勾选「建交」后才能征募该群组的特种军队。</p>

    <h2 style="margin-top: 14px">区域一览</h2>
    <table>
      <thead><tr><th style="width: 90px">区域码</th><th style="width: 240px">区域名</th><th>本图编号数</th></tr></thead>
      <tbody>
        <tr v-for="r in regionList" :key="r.code">
          <td><span class="swatch" :style="{ background: r.color }"></span>{{ r.code }}</td>
          <td>{{ r.name }}</td>
          <td class="num">{{ r.count }}</td>
        </tr>
      </tbody>
    </table>

    <h2 style="margin-top: 18px">群组（聚居地主格）</h2>
    <table>
      <thead><tr><th style="width: 210px">群组</th><th style="width: 90px">主格</th><th style="width: 80px">谈判DC</th><th style="width: 90px">建交</th><th>可征募军队</th></tr></thead>
      <tbody>
        <tr v-for="g in diploList" :key="g.name">
          <td><span class="swatch" :style="{ background: g.color }"></span>{{ g.name }}<span class="muted" v-if="g.kind"> · {{ g.kind }}</span></td>
          <td>
            <button v-if="g.code && labels.some(l => l.code === g.code)" class="act mini" @click="pick(g.code)">{{ g.code }}</button>
            <span v-else class="muted">{{ g.code || '—' }}</span>
          </td>
          <td class="num">{{ g.dc ?? '—' }}</td>
          <td><input type="checkbox" v-model="state.diplomacy[g.name]" /></td>
          <td class="muted">{{ g.army || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.mapBar { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: flex-end; margin-bottom: 10px; }
.sheetPick { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 3px; }
.sheetBtn { appearance: none; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink-2); border-radius: 3px; padding: 3px 9px; font: inherit; font-size: 12px; cursor: pointer; }
.sheetBtn:hover { border-color: var(--rule-hover); color: var(--ink); }
.sheetBtn.on { border-color: var(--ochre); background: var(--wash-ochre); color: var(--ochre); font-weight: 600; }

.mapLayout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 22px; align-items: start; }
.mapCol { min-width: 0; }

/* 连续画布：四张裁片按实测偏移绝对定位；容器即全景图边界，点击换算以它为准 */
.mapwrap { position: relative; overflow: hidden; background: var(--paper-2); line-height: 0; cursor: pointer; }
.mapwrap.adding { cursor: crosshair; }
.mapwrap.adding .sheet { opacity: 0.92; }

.sheet { position: absolute; display: block; object-fit: fill; user-select: none; pointer-events: none; }
/* 相邻图幅横向重叠 24–25px：后画的图在左缘渐隐，与前图交叉淡入，接缝不可见 */
.sheet.fade {
  -webkit-mask-image: linear-gradient(to right, rgba(0, 0, 0, 0), #000 var(--fade));
  mask-image: linear-gradient(to right, rgba(0, 0, 0, 0), #000 var(--fade));
}

/* 六角格图层：与对应底图同一坐标系（viewBox = 底图像素），preserveAspectRatio=none 保证严格贴合 */
.hexlayer { position: absolute; pointer-events: none; }
.hex { fill: none; stroke: rgba(255, 255, 255, 0.42); stroke-width: 1; vector-effect: non-scaling-stroke; }
.hex-region { stroke: none; fill-opacity: 0.18; }
.hex-region.auto { fill-opacity: 0.1; }
.hex-st.claimed { fill: var(--map-claimed); fill-opacity: 0.28; stroke: none; }
.hex-st.noted { fill: var(--ochre-soft); fill-opacity: 0.24; stroke: none; }
.hex-hover { fill: var(--ochre); fill-opacity: 0.12; stroke: var(--ochre-soft); stroke-width: 2; vector-effect: non-scaling-stroke; }
.hex-sel { fill: var(--ochre); fill-opacity: 0.16; stroke: var(--ochre); stroke-width: 2.5; vector-effect: non-scaling-stroke; }

.pin { position: absolute; transform: translate(-50%, -50%); appearance: none; border: 0; background: transparent; padding: 0; cursor: pointer; line-height: 1; }
.pin .dot { display: block; width: 10px; height: 10px; margin: 0 auto; border-radius: 50%; border: 2px solid var(--paper-2); background: var(--ochre); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
.pin.mine .dot { border-color: var(--paper-2); background: #3f6f8f; border-radius: 2px; border-width: 0; width: 12px; height: 12px; box-shadow: 0 0 0 2px var(--paper-2), 0 1px 3px rgba(0, 0, 0, 0.5); }
.pin.claimed .dot { background: #4d7a4d; }
.pin.sel .dot { background: var(--warn); width: 13px; height: 13px; }
.pin.noted .dot { outline: 2px solid var(--ochre-soft); outline-offset: 1px; }
.pin .code { display: block; position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; color: #fff; background: rgba(30, 28, 24, 0.84); padding: 1px 5px; border-radius: 3px; }
.pin.grp .dot { background: var(--grp); box-shadow: 0 0 0 2px #fff, 0 1px 3px rgba(0, 0, 0, 0.5); }
.pin.home .dot { width: 14px; height: 14px; box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--grp), 0 1px 3px rgba(0, 0, 0, 0.5); }
.pin .gcode { position: absolute; left: 50%; bottom: 38px; transform: translateX(-50%); white-space: nowrap; font-size: 12px; color: #fff; background: var(--grp); padding: 1px 5px; border-radius: 3px; }

.mapAside { position: sticky; top: 16px; border-left: 1px solid var(--rule-soft); padding-left: 18px; }
.mapAside.empty { color: var(--ink-3); }
.asideHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.asideHead h3 { margin: 0; font-size: 15px; letter-spacing: 0.02em; }
.mapAside textarea { min-height: 96px; width: 100%; }
.calTitle { margin: 22px 0 0; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; color: var(--ink-2); }

.swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.act.on { border-color: var(--ochre); color: var(--ochre); background: var(--cover-old); }

@media (max-width: 1180px) {
  .mapLayout { grid-template-columns: 1fr; }
  .mapAside { position: static; border-left: 0; border-top: 1px solid var(--rule-soft); padding: 16px 0 0; }
}
</style>
