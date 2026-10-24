<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { state, exportSaveFile } from '../mapStore.js'
import mapData from '../data/mapLabels.json'
import regionCells from '../data/regionCells.json'
import hexes from '../data/hexes.json'

const maps = mapData.maps
const labels = mapData.labels
const layout = mapData.layout
const byCode = Object.fromEntries(hexes.map((h) => [h.code, h]))

// 区域：编号前缀即区域码，名称取自第二章「六角格」的 20 个区域（含北缘的布雷沃 BV）
const REGIONS = [
  ['RL', '罗斯特兰腹地'], ['GB', '翠绿之地'], ['TW', '獠牙湖'], ['KL', '卡姆兰德'], ['NM', '纳马彻斯森林'],
  ['SH', '塞伦丘陵'], ['DS', '邓斯沃德'], ['NH', '诺门高地'], ['LV', '勒维尼斯山峦'], ['HT', '钩舌沼泽'],
  ['DR', '德雷列夫'], ['TL', '虎领主领'], ['RU', '灯火'], ['GL', '格莱尼邦低地'], ['PX', '皮塔克斯'],
  ['GU', '格莱尼邦高地'], ['NU', '努梅里亚'], ['TV', '千声之地'], ['BR', '布兰特伦德山脉'], ['BV', '布雷沃'],
]
// 普通格自动编号也带区域码（RLN1），按已知区域码取最长前缀，别把 N 当成区域码的一部分
function regionOf(code) {
  const s = String(code)
  let best = ''
  for (const [rc] of REGIONS) if (s.startsWith(rc) && rc.length > best.length) best = rc
  return best
}
function regionColor(code) { const i = REGIONS.findIndex((r) => r[0] === regionOf(code)); const h = ((i < 0 ? 0 : i) * 47) % 360; return `hsl(${h} 55% 42%)` }

/* ---------- 界面偏好 ---------- */
const UI_KEY = 'kingdom-map-ui-v1'
function loadUiPrefs() {
  const defaults = {
    showRegions: true, showNames: true, showBorders: true,
    showPins: true, onlyMarked: false,
    scopeCodes: REGIONS.map(([code]) => code),
  }
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return defaults
    const p = JSON.parse(raw)
    const codes = Array.isArray(p.scopeCodes)
      ? p.scopeCodes.filter((c) => REGIONS.some(([r]) => r === c))
      : defaults.scopeCodes
    return {
      showRegions: typeof p.showRegions === 'boolean' ? p.showRegions : defaults.showRegions,
      showNames: typeof p.showNames === 'boolean' ? p.showNames : defaults.showNames,
      showBorders: typeof p.showBorders === 'boolean' ? p.showBorders : defaults.showBorders,
      showPins: typeof p.showPins === 'boolean' ? p.showPins : defaults.showPins,
      onlyMarked: typeof p.onlyMarked === 'boolean' ? p.onlyMarked : defaults.onlyMarked,
      scopeCodes: codes,
    }
  } catch (e) {
    return defaults
  }
}
const uiPrefs = loadUiPrefs()

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
function cellVerts(g, q, r) {
  const [cx, cy] = cellCenter(g, q, r)
  const { W, H } = g
  return [[cx, cy - H / 2], [cx + W / 2, cy - H / 4], [cx + W / 2, cy + H / 4],
          [cx, cy + H / 2], [cx - W / 2, cy + H / 4], [cx - W / 2, cy - H / 4]]
}
function cellPoints(g, q, r) {
  return cellVerts(g, q, r).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')
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

  // 编号点落在哪一格 / 该格挂着哪个编号
  const here = hereOf(m)
  const labelCell = {}
  const codeOfCell = {}
  for (const l of here) {
    const k = `${m.id}:${cellAt(g, l.x, l.y).join(',')}`
    labelCell[l.code] = k
    if (!codeOfCell[k]) codeOfCell[k] = l.code
  }

  const out = { m, g, cells, byKey, here, labelCell, codeOfCell }
  geomCache.set(key, out)
  return out
}
const hereCache = new Map()
function hereOf(m) {
  if (!hereCache.has(m.id)) hereCache.set(m.id, labels.filter((l) => l.map === m.id))
  return hereCache.get(m.id)
}
function geomOf(m) { return buildGeom(m) }

// 同一块地被裁到两张图幅时，两边的格是同一个物理格；按中心距离归组，选中与标注都按组处理
const cellGroups = new Map()
;(() => {
  const items = []
  for (const m of maps) {
    const geo = geomOf(m)
    const g = geo.g
    for (const c of geo.cells) {
      const [cx, cy] = cellCenter(g, c.q, c.r)
      items.push({ key: c.key, map: m.id, x: cx + m.left, y: cy + m.top, w: g.W })
    }
  }
  const parent = items.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].map === items[j].map) continue
      if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) >= items[i].w * 0.46) continue
      const a = find(i), b = find(j)
      if (a !== b) parent[b] = a
    }
  }
  const byRoot = new Map()
  items.forEach((it, i) => {
    const r = find(i)
    if (!byRoot.has(r)) byRoot.set(r, [])
    byRoot.get(r).push(it.key)
  })
  for (const keys of byRoot.values()) for (const k of keys) cellGroups.set(k, keys)
})()
function groupKeys(key) { return cellGroups.get(key) || [key] }

/* ---------- 显示范围 ---------- */
const scopeCodes = ref(uiPrefs.scopeCodes)
const showPins = ref(uiPrefs.showPins)
const onlyMarked = ref(uiPrefs.onlyMarked)
const scopeSet = computed(() => new Set(scopeCodes.value))
const scopeAll = computed(() => scopeCodes.value.length === REGIONS.length)
const scopeSummary = computed(() => {
  const n = scopeCodes.value.length
  if (n === REGIONS.length) return '全部区域'
  if (!n) return '未选区域'
  if (n <= 4) return scopeCodes.value.join(' / ')
  return `已选 ${n} 个区域`
})
function toggleScope(code) {
  const i = scopeCodes.value.indexOf(code)
  if (i >= 0) scopeCodes.value.splice(i, 1)
  else scopeCodes.value.push(code)
}
function selectAllScope() { scopeCodes.value = REGIONS.map(([code]) => code) }
function clearScope() { scopeCodes.value = [] }
function shownFor(geo) {
  if (!showPins.value) return []
  let out = geo.here.filter((l) => scopeSet.value.has(regionOf(l.code)))
  if (onlyMarked.value) out = out.filter((l) => state.hexNotes[l.code] || state.hexClaimed[l.code])
  // 当前选中的格即使落在范围外也留着，否则「跳到编号」会跳到看不见的位置
  const cur = geo.here.find((l) => l.code === selKey.value)
  return cur && !out.includes(cur) ? [...out, cur] : out
}
function stateCellsFor(geo) {
  const out = []
  for (const c of geo.cells) {
    const code = geo.codeOfCell[c.key] || plainInfo.value.codeOfKey[c.key]
    const claimed = !!state.hexClaimed[c.key] || !!(code && state.hexClaimed[code])
    const noted = !!state.hexNotes[c.key] || !!(code && state.hexNotes[code])
    if (claimed || noted) out.push({ key: c.key, pts: c.pts, cls: { claimed, noted: !claimed } })
  }
  // 内容签名：备注文字变化不该触发格网层重绘
  const sig = out.map((c) => c.key + (c.cls.claimed ? '+' : '-')).join('|')
  return { cells: out, sig }
}
// 左缘渐隐宽度：前一张图幅与本图幅的重叠像素（相邻裁片重叠 5–25px）
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
  const st = stateCellsFor(geo)
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
    stateCells: st.cells,
    stateSig: st.sig,
    pins: state.pins[m.id] || [],
  }
}))
const totalHere = computed(() => sheets.value.reduce((n, s) => n + s.geo.here.length, 0))
const totalShown = computed(() => sheets.value.reduce((n, s) => n + shownFor(s.geo).length, 0))

// 换图幅后清掉悬浮，显示筛选保持不变
watch(selectedIds, () => {
  hoverKey.value = ''
}, { deep: true })

/* ---------- 选中 ---------- */
const activeGeo = computed(() => geomOf(activeMap.value))
// 编号与格子共用一个选中：选编号时换算到它所在的格，区域标注与高亮才有落点
const selCellKey = computed(() => {
  if (activeGeo.value.byKey[selKey.value]) return selKey.value
  const l = curLabel.value
  if (l) return activeGeo.value.labelCell[l.code] || ''
  // 普通格自动编号：优先落回当前图幅那一半
  const keys = plainInfo.value.byCode[selKey.value]
  if (!keys) return ''
  return keys.find((k) => k.startsWith(activeId.value + ':')) || keys[0]
})
const selGroup = computed(() => new Set(groupKeys(selCellKey.value)))
const hoverGroup = computed(() => new Set(groupKeys(hoverKey.value)))
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
  if (labels.some((x) => x.code === q)) {
    jumpMsg.value = ''
    pick(q)
    return
  }
  // 普通格自动编号（RLN1 这种）
  const keys = plainInfo.value.byCode[q]
  if (!keys) { jumpMsg.value = `没有编号 ${q}`; return }
  const key = keys.find((k) => k.startsWith(activeId.value + ':')) || keys[0]
  const mapId = key.slice(0, key.indexOf(':'))
  activeId.value = mapId
  if (!selectedIds.value.includes(mapId)) selectedIds.value.push(mapId)
  jumpMsg.value = ''
  selKey.value = q
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
  if (!m) { selKey.value = ''; return }
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
  const code = geo.codeOfCell[key] || plainInfo.value.codeOfKey[key]
  // 点空白格（没有归属的格）直接取消选中；同一格再点一次也取消
  if (!code || code === selKey.value) { selKey.value = ''; return }
  selKey.value = code
}
function onMapMove(e) {
  // 触屏不参与悬浮，避免点击后被合成的 pointermove 点亮一格
  if (e.pointerType !== 'mouse') return
  if (addMode.value) { hoverKey.value = ''; return }
  const r = e.currentTarget.getBoundingClientRect()
  const v = view.value
  hoverPt = {
    x: v.x + ((e.clientX - r.left) / r.width) * v.w,
    y: ((e.clientY - r.top) / r.height) * v.h,
  }
  if (!hoverRaf) hoverRaf = requestAnimationFrame(applyHover)
}
let hoverRaf = 0
let hoverPt = null
function applyHover() {
  hoverRaf = 0
  const pt = hoverPt
  hoverPt = null
  if (!pt) return
  const m = mapAt(pt.x, pt.y)
  const next = m
    ? (() => {
        const geo = geomOf(m)
        const key = `${m.id}:${cellAt(geo.g, pt.x - m.left, pt.y - m.top).join(',')}`
        return geo.byKey[key] ? key : ''
      })()
    : ''
  if (next !== hoverKey.value) hoverKey.value = next
}

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
// 全景坐标 → 画布百分比（区域名标注用）
function panPos(x, y) {
  const v = view.value
  return {
    left: (((x - v.x) / v.w) * 100).toFixed(3) + '%',
    top: ((y / v.h) * 100).toFixed(3) + '%',
  }
}

// 点空白处取消选中：只放过地图、侧栏和各类可交互控件，工具栏/页面空白都算空白
function onDocClick(e) {
  if (!e.target.closest('.scopePick')) {
    document.querySelectorAll('details.scopePick[open]').forEach((d) => { d.open = false })
  }
  if (!selKey.value) return
  if (e.target.closest('.mapwrap, .mapAside, button, input, select, textarea, label, a, summary, details')) return
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

/* ---------- 区域显示 ---------- */
const showRegions = ref(uiPrefs.showRegions)    // 区域色块
const showNames = ref(uiPrefs.showNames)        // 区域名称
const showBorders = ref(uiPrefs.showBorders)    // 区域边界线
// 勾选框与区域筛选记忆到本地，下次打开沿用
watch([showRegions, showNames, showBorders, showPins, onlyMarked, scopeCodes], () => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({
      showRegions: showRegions.value,
      showNames: showNames.value,
      showBorders: showBorders.value,
      showPins: showPins.value,
      onlyMarked: onlyMarked.value,
      scopeCodes: scopeCodes.value,
    }))
  } catch (e) { /* 忽略 */ }
}, { deep: true })
// 区域归属来自内置数据；同一物理格跨图幅拆成两半时统一区域，避免一格两属
const regionMap = computed(() => {
  const out = { ...regionCells }
  const done = new Set()
  for (const keys of cellGroups.values()) {
    if (done.has(keys)) continue
    done.add(keys)
    let code = ''
    for (const k of keys) if (regionCells[k]) { code = regionCells[k]; break }
    if (code) for (const k of keys) out[k] = code
  }
  return out
})
// 普通格（有区域归属但没有模组编号）自动编号：RL 区域即 RLN1、RLN2……
// 按全景自上而下、自左而右排序，编号稳定；跨图幅的同一物理格共用一个编号
const plainInfo = computed(() => {
  const codeOfKey = {}
  const byCode = {}
  const labeledKey = {}
  for (const m of maps) {
    for (const [k, code] of Object.entries(geomOf(m).codeOfCell)) labeledKey[k] = code
  }

  const rows = []
  const seen = new Set()
  for (const m of maps) {
    const geo = geomOf(m)
    for (const c of geo.cells) {
      const region = regionMap.value[c.key]
      if (!region) continue
      const group = groupKeys(c.key)
      if (seen.has(group)) continue
      seen.add(group)
      const label = group.map((k) => labeledKey[k]).find(Boolean)
      if (label) {
        // 同一物理格的另一半有模组编号：两边都按那个编号选中
        for (const k of group) codeOfKey[k] = label
        continue
      }
      const [cx, cy] = cellCenter(geo.g, c.q, c.r)
      rows.push({ group, region, x: m.left + cx, y: m.top + cy })
    }
  }

  rows.sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const n = {}
  for (const row of rows) {
    n[row.region] = (n[row.region] || 0) + 1
    const code = `${row.region}N${n[row.region]}`
    byCode[code] = row.group
    for (const k of row.group) codeOfKey[k] = code
  }
  return { byCode, codeOfKey }
})
// 区域色块画在整张全景上，避免在图幅边缘被裁成竖条；同一物理格只画一次
const regionShapes = computed(() => {
  if (!showRegions.value) return []
  const seen = new Set()
  const out = []
  for (const m of shownMaps.value) {
    const geo = geomOf(m)
    const g = geo.g
    for (const c of geo.cells) {
      const code = regionMap.value[c.key]
      if (!code || !scopeSet.value.has(code)) continue
      const group = groupKeys(c.key)
      if (seen.has(group[0])) continue
      seen.add(group[0])
      const pts = cellVerts(g, c.q, c.r)
        .map(([x, y]) => `${(x + m.left).toFixed(1)},${(y + m.top).toFixed(1)}`)
        .join(' ')
      out.push({ key: c.key, pts, color: regionColor(code) })
    }
  }
  return out
})
// 悬浮/选中高亮也画在全景层，避免在图幅边缘被裁成半格
function shapesForGroup(group) {
  const seen = new Set()
  const out = []
  for (const m of shownMaps.value) {
    const geo = geomOf(m)
    const g = geo.g
    for (const c of geo.cells) {
      if (!group.has(c.key)) continue
      const rep = groupKeys(c.key)[0]
      if (seen.has(rep)) continue
      seen.add(rep)
      const pts = cellVerts(g, c.q, c.r)
        .map(([x, y]) => `${(x + m.left).toFixed(1)},${(y + m.top).toFixed(1)}`)
        .join(' ')
      out.push({ key: c.key, pts })
    }
  }
  return out
}
const hoverShapes = computed(() => shapesForGroup(hoverGroup.value))
const selShapes = computed(() => shapesForGroup(selGroup.value))
const NEIGHBORS = [[1, 0, 1], [-1, 0, 4], [0, 1, 2], [0, -1, 5], [1, -1, 0], [-1, 1, 3]]
// 物理格：跨图幅去重，一块真实地只留一份，格点直接换算到全景坐标
const physCells = (() => {
  const out = []
  const done = new Set()
  for (const m of maps) {
    const g = gridOf(m)
    for (const c of geomOf(m).cells) {
      const group = groupKeys(c.key)
      if (done.has(group)) continue
      done.add(group)
      const [cx, cy] = cellCenter(g, c.q, c.r)
      out.push({
        group, g, q: c.q, r: c.r, left: m.left, top: m.top,
        x: cx + m.left,
        y: cy + m.top,
        w: g.W,
        verts: cellVerts(g, c.q, c.r).map(([x, y]) => [x + m.left, y + m.top]),
      })
    }
  }
  return out
})()
// 邻格查找：按约一格宽的粗网格索引，只找中心最近的一格
const physIndex = (() => {
  const BS = 48
  const bucket = new Map()
  for (const pc of physCells) {
    const k = `${Math.floor(pc.x / BS)},${Math.floor(pc.y / BS)}`
    if (!bucket.has(k)) bucket.set(k, [])
    bucket.get(k).push(pc)
  }
  return { BS, bucket }
})()
function physAt(x, y, tol) {
  const { BS, bucket } = physIndex
  const bx = Math.floor(x / BS), by = Math.floor(y / BS)
  let best = null
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = bucket.get(`${bx + dx},${by + dy}`)
      if (!list) continue
      for (const pc of list) {
        const d = Math.hypot(pc.x - x, pc.y - y)
        if (d <= tol && (!best || d < best.d)) best = { pc, d }
      }
    }
  }
  return best ? best.pc : null
}
// 全景边界：按物理格逐条六边形边判断两侧区域，不同才画；同一条边只画一次
// 邻格在全部图幅里找，所以接缝处不会断线、也不会重复画线
const borderPath = computed(() => {
  if (!showBorders.value) return ''
  const rm = regionMap.value
  const shownIds = new Set(shownMaps.value.map((m) => m.id))
  const seen = new Set()
  let d = ''
  for (const pc of physCells) {
    const code = rm[pc.group[0]]
    if (!code || !scopeSet.value.has(code)) continue
    if (!pc.group.some((k) => shownIds.has(k.split(':')[0]))) continue
    for (const [dq, dr, ei] of NEIGHBORS) {
      const [nx, ny] = cellCenter(pc.g, pc.q + dq, pc.r + dr)
      const nb = physAt(nx + pc.left, ny + pc.top, pc.w * 0.45)
      if (!nb) continue
      if (rm[nb.group[0]] === code) continue
      const [ax, ay] = pc.verts[ei]
      const [bx, by] = pc.verts[(ei + 1) % 6]
      // 同一条边两侧会各算一次，按中点分桶去重
      const ek = `${Math.round((ax + bx) / 8)},${Math.round((ay + by) / 8)}`
      if (seen.has(ek)) continue
      seen.add(ek)
      d += `M${ax.toFixed(1)},${ay.toFixed(1)}L${bx.toFixed(1)},${by.toFixed(1)}`
    }
  }
  return d
})
// 区域名标注：放在区域重心处（不吸附到格子中心）；重心落到区域外时退到最近的格
const regionLabels = computed(() => {
  if (!showNames.value) return []
  const rm = regionMap.value
  const shownIds = new Set(shownMaps.value.map((m) => m.id))
  const byRegion = new Map()
  for (const pc of physCells) {
    if (!pc.group.some((k) => shownIds.has(k.split(':')[0]))) continue
    const code = rm[pc.group[0]]
    if (!code || !scopeSet.value.has(code)) continue
    if (!byRegion.has(code)) byRegion.set(code, [])
    byRegion.get(code).push(pc)
  }
  const out = []
  for (const [code, list] of byRegion) {
    const r = REGIONS.find((x) => x[0] === code)
    let sx = 0, sy = 0
    for (const pc of list) { sx += pc.x; sy += pc.y }
    const cx = sx / list.length, cy = sy / list.length
    let near = list[0], nd = Infinity
    for (const pc of list) {
      const dd = Math.hypot(pc.x - cx, pc.y - cy)
      if (dd < nd) { nd = dd; near = pc }
    }
    // 凹形/环形区域的重心可能不在区域内，这时用最近的那一格
    const inside = nd <= near.w * 0.55
    out.push({
      code,
      name: r ? r[1] : code,
      // 留出标签宽度，免得贴着画布边缘被裁掉
      x: Math.min(Math.max(inside ? cx : near.x, 90), layout.w - 90),
      y: Math.min(Math.max(inside ? cy : near.y, 26), layout.h - 26),
    })
  }
  return out
})
const selRegion = computed(() => regionMap.value[selCellKey.value] || '')
// 侧栏一行说清：编号 + 区域名 + 地点名（区域名不带区域码，编号里已经带了）
const asideTitle = computed(() => {
  if (curPin.value) return curPin.value.name
  const r = REGIONS.find((x) => x[0] === selRegion.value)
  const place = info.value ? info.value.name.split(' ')[0] : ''
  return [selKey.value, r ? r[1] : '', place].filter(Boolean).join(' ')
})

/* ---------- 导出地图图片 ---------- */
const exporting = ref('')
const wrapEl = ref(null)
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
function drawChip(ctx, text, cx, bottom, k) {
  const fs = 12 * k
  ctx.font = `${fs}px "PingFang SC", "Noto Sans CJK SC", sans-serif`
  const w = ctx.measureText(text).width + 10 * k
  const h = 18 * k
  roundRect(ctx, cx - w / 2, bottom - h, w, h, 3 * k)
  ctx.fillStyle = 'rgba(30, 28, 24, 0.84)'
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, cx, bottom - h / 2)
}
function ptsOf(s) {
  return s.split(' ').map((p) => p.split(',').map(Number))
}
function tracePath(ctx, pts) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
}
// 区域填色：与页面同样的 18% 不透明度，全景坐标
function drawRegionFills(ctx, ox) {
  if (!regionShapes.value.length) return
  ctx.save()
  ctx.globalAlpha = 0.18
  for (const c of regionShapes.value) {
    const pts = ptsOf(c.pts).map(([x, y]) => [x - ox, y])
    tracePath(ctx, pts)
    ctx.fillStyle = c.color
    ctx.fill()
  }
  ctx.restore()
}
// 已占据 / 已备注（图幅本地坐标，调用前已 translate）
function drawState(ctx, s) {
  for (const c of s.stateCells) {
    tracePath(ctx, ptsOf(c.pts))
    ctx.fillStyle = c.cls.claimed ? 'rgba(77, 122, 77, 0.28)' : 'rgba(176, 138, 69, 0.24)'
    ctx.fill()
  }
}
// 编号点与自定标记（图幅本地坐标，调用前已 translate）
function drawPins(ctx, s, k) {
  for (const l of shownFor(s.geo)) {
    const px = l.x, py = l.y
    ctx.beginPath()
    ctx.arc(px, py, 5 * k, 0, Math.PI * 2)
    ctx.fillStyle = state.hexClaimed[l.code] ? '#4d7a4d' : '#7a5a25'
    ctx.fill()
    ctx.lineWidth = 2 * k
    ctx.strokeStyle = '#fbf9f3'
    ctx.stroke()
    drawChip(ctx, l.code, px, py - 10 * k, k)
  }
  for (const p of s.pins) {
    const px = p.x, py = p.y
    ctx.fillStyle = '#3f6f8f'
    ctx.fillRect(px - 6 * k, py - 6 * k, 12 * k, 12 * k)
    ctx.lineWidth = 2 * k
    ctx.strokeStyle = '#fbf9f3'
    ctx.strokeRect(px - 6 * k, py - 6 * k, 12 * k, 12 * k)
    drawChip(ctx, p.name, px, py - 12 * k, k)
  }
}
// 区域边界：与页面同一条路径、同一颜色
function drawBorders(ctx, ox, k) {
  if (!borderPath.value) return
  ctx.save()
  ctx.translate(-ox, 0)
  ctx.strokeStyle = 'rgba(47, 42, 30, 0.62)'
  ctx.lineWidth = 2 * k
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(borderPath.value))
  ctx.restore()
}
// 区域名标注：与页面的标签样式一致
function drawRegionNames(ctx, ox, k) {
  if (!regionLabels.value.length) return
  ctx.font = `${11 * k}px "PingFang SC", "Noto Sans CJK SC", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const l of regionLabels.value) {
    const x = l.x - ox
    const w = ctx.measureText(l.name).width + 14 * k
    const h = 18 * k
    roundRect(ctx, x - w / 2, l.y - h / 2, w, h, 3 * k)
    ctx.fillStyle = 'rgba(246, 242, 233, 0.9)'
    ctx.fill()
    ctx.lineWidth = Math.max(1, k)
    ctx.strokeStyle = 'rgba(96, 80, 54, 0.3)'
    ctx.stroke()
    ctx.fillStyle = '#3b3326'
    ctx.fillText(l.name, x, l.y)
  }
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

    // 与页面同样的叠层顺序：区域填色 → 占据/备注 → 边界 → 标点 → 区域名
    // 线宽、字号、标记按预览缩放比换算，导出图看起来就是预览的样子
    const cw = wrapEl.value?.clientWidth || 0
    const k = cw ? v.w / cw : 2
    drawRegionFills(ctx, v.x)
    for (const s of sheets.value) {
      ctx.save()
      ctx.translate(s.m.left - v.x, s.m.top)
      drawState(ctx, s)
      ctx.restore()
    }
    drawBorders(ctx, v.x, k)
    for (const s of sheets.value) {
      ctx.save()
      ctx.translate(s.m.left - v.x, s.m.top)
      drawPins(ctx, s, k)
      ctx.restore()
    }
    drawRegionNames(ctx, v.x, k)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) { exporting.value = '导出失败'; return }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `失窃之地-探索地图-${new Date().toISOString().slice(0, 10)}.png`
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
  if (hoverRaf) cancelAnimationFrame(hoverRaf)
})
</script>

<template>
  <div class="panel">
    <div class="mapBar">
      <div class="field">
        <label>图幅</label>
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
        <details class="scopePick">
          <summary>{{ scopeSummary }}</summary>
          <div class="scopeMenu">
            <div class="scopeChips">
              <button type="button" class="scopeChip" :class="{ on: scopeAll }" @click="selectAllScope">全部</button>
              <button type="button" class="scopeChip" :class="{ on: !scopeCodes.length }" @click="clearScope">清空</button>
              <button
                v-for="r in REGIONS"
                :key="r[0]"
                type="button"
                class="scopeChip"
                :class="{ on: scopeSet.has(r[0]) }"
                :title="r[1]"
                @click="toggleScope(r[0])"
              >{{ r[0] }}</button>
            </div>
          </div>
        </details>
      </div>
      <div class="field">
        <label>跳到编号</label>
        <input v-model="query" @keyup.enter="jump" maxlength="6" style="width: 68px" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="act" :class="{ on: addMode }" @click="addMode = !addMode">
          {{ addMode ? '点击地图落点…' : '添加标记' }}
        </button>
      </div>
    </div>
    <div class="mapBar checks">
      <label class="check"><input type="checkbox" v-model="showRegions" /><span>区域色块</span></label>
      <label class="check"><input type="checkbox" v-model="showNames" /><span>区域名称</span></label>
      <label class="check"><input type="checkbox" v-model="showBorders" /><span>边界线</span></label>
      <label class="check"><input type="checkbox" v-model="showPins" /><span>标点</span></label>
      <label class="check"><input type="checkbox" v-model="onlyMarked" /><span>仅已占据/已备注</span></label>
    </div>
    <div class="mapBar acts">
      <button class="act" :disabled="!!exporting" @click="exportMap">{{ exporting || '导出图片' }}</button>
      <button class="act" @click="exportSaveFile">导出存档</button>
    </div>
    <p class="muted" v-if="jumpMsg">{{ jumpMsg }}</p>

    <!-- 网格校准暂时停用：当前格网已足够准确，不需要手动微调
    <details class="more" style="margin: 4px 0 14px">
      <summary>网格校准<span class="muted">　调试</span></summary>
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
    -->

    <div class="mapLayout">
      <div class="mapCol">
        <div
          class="mapwrap"
          ref="wrapEl"
          :class="{ adding: addMode }"
          :style="{ aspectRatio: `${view.w} / ${view.h}` }"
          @click="onMapClick"
          @pointermove="onMapMove"
          @pointerleave="hoverKey = ''"
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
            class="regionlayer"
            v-memo="[regionShapes, view.x, view.w]"
            :viewBox="`${view.x} 0 ${view.w} ${view.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon v-for="c in regionShapes" :key="c.key" class="hex-region" :points="c.pts" :style="{ fill: c.color }" />
          </svg>
          <svg
            v-for="s in sheets"
            :key="'hex:' + s.m.id"
            v-memo="[s.m.id, s.style.left, s.style.top, s.style.width, s.style.height, s.stateSig]"
            class="hexlayer"
            :style="s.style"
            :viewBox="`0 0 ${s.m.w} ${s.m.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon v-for="c in s.stateCells" :key="'s' + c.key" class="hex-st" :class="c.cls" :points="c.pts" />
          </svg>
          <svg
            class="highlightlayer"
            :viewBox="`${view.x} 0 ${view.w} ${view.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon v-for="c in hoverShapes" :key="'h' + c.key" class="hex-hover" :points="c.pts" />
            <polygon v-for="c in selShapes" :key="'sel' + c.key" class="hex-sel" :points="c.pts" />
          </svg>
          <svg
            class="borderlayer"
            v-memo="[borderPath, view.x, view.w]"
            :viewBox="`${view.x} 0 ${view.w} ${view.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path class="hex-border" :d="borderPath" />
          </svg>
          <template v-for="s in sheets" :key="'pin:' + s.m.id">
            <button
              v-for="l in shownFor(s.geo)"
              :key="l.code"
              class="pin"
              :class="{ sel: l.code === selKey, noted: !!state.hexNotes[l.code], claimed: !!state.hexClaimed[l.code] }"
              :style="pinPos(s.m, l.x, l.y)"
              @click.stop="pick(l.code)"
            >
              <span class="dot"></span><span class="code">{{ l.code }}</span>
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
          <div class="labelLayer">
            <span
              v-for="l in regionLabels"
              :key="l.code"
              class="regionLabel"
              :style="panPos(l.x, l.y)"
            >{{ l.name }}</span>
          </div>
        </div>
      </div>

      <aside class="mapAside" :class="{ empty: !selKey }">
        <template v-if="selKey">
          <div class="asideHead">
            <h3>{{ asideTitle }}</h3>
          </div>

          <template v-if="curPin">
            <div class="field" style="margin-bottom: 10px">
              <label>标记名称</label>
              <input v-model="curPin.name" />
            </div>
          </template>

          <label class="check" style="margin: 10px 0">
            <input type="checkbox" v-model="state.hexClaimed[selKey]" />
            <span>占据</span>
          </label>
          <div class="field">
            <label>备注</label>
            <textarea v-model="state.hexNotes[selKey]"></textarea>
          </div>
          <button v-if="curPin" class="act" style="margin-top: 12px" @click="removePin">删除这个标记（Delete）</button>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.mapBar { display: flex; flex-wrap: wrap; gap: 12px 14px; align-items: flex-end; margin-bottom: 8px; }
/* 勾选框、导出按钮各自单独一行 */
.mapBar.checks { align-items: center; gap: 6px 18px; margin-bottom: 8px; }
.mapBar.acts { gap: 10px; margin-bottom: 12px; }
.scopePick { position: relative; }
.scopePick > summary { list-style: none; cursor: pointer; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink-2); border-radius: 3px; padding: 4px 9px; font-size: 13px; min-width: 104px; }
.scopePick > summary::-webkit-details-marker { display: none; }
.scopePick[open] > summary { border-color: var(--ochre); color: var(--ink); }
.scopeMenu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 30; width: 360px; max-width: calc(100vw - 40px); padding: 10px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 4px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
.scopeChips { display: flex; flex-wrap: wrap; gap: 6px; }
.scopeChip { appearance: none; border: 1px solid var(--rule); background: var(--paper); color: var(--ink-2); border-radius: 999px; padding: 2px 8px; font: inherit; font-size: 12px; cursor: pointer; }
.scopeChip.on { background: var(--ochre); border-color: var(--ochre); color: var(--paper-2); }
.sheetPick { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 3px; }
.sheetBtn { appearance: none; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink-2); border-radius: 3px; padding: 3px 9px; font: inherit; font-size: 12px; cursor: pointer; }
.sheetBtn:hover { border-color: var(--rule-hover); color: var(--ink); }
.sheetBtn.on { border-color: var(--ochre); background: var(--wash-ochre); color: var(--ochre); font-weight: 600; }

.mapLayout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 22px; align-items: start; }
.mapCol { min-width: 0; }

/* 连续画布：四张裁片按实测偏移绝对定位；容器即全景图边界，点击换算以它为准 */
.mapwrap { position: relative; overflow: hidden; background: var(--paper-2); line-height: 0; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
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
/* 区域色块、悬浮/选中高亮、边界都用全景坐标，跨图幅接缝也能连续 */
.regionlayer, .highlightlayer, .borderlayer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hex-region { stroke: none; fill-opacity: 0.18; }
.hex-st.claimed { fill: var(--map-claimed); fill-opacity: 0.28; stroke: none; }
.hex-st.noted { fill: var(--ochre-soft); fill-opacity: 0.24; stroke: none; }
/* 区域交界：统一深色细线，颜色只留给填色，避免多色线互相打架 */
.hex-border { fill: none; stroke: #2f2a1e; stroke-opacity: 0.62; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
/* 区域名标注：固定像素字号，位置跟随全景坐标 */
.labelLayer { position: absolute; inset: 0; pointer-events: none; }
.regionLabel {
  position: absolute; transform: translate(-50%, -50%);
  padding: 1px 7px 2px; border-radius: 3px;
  background: rgba(246, 242, 233, 0.9);
  border: 1px solid rgba(96, 80, 54, 0.3);
  color: #3b3326; font-size: 11px; line-height: 1.5; letter-spacing: 0.12em; white-space: nowrap;
}
.hex-hover { fill: var(--ochre); fill-opacity: 0.12; stroke: var(--ochre-soft); stroke-width: 2; vector-effect: non-scaling-stroke; }
.hex-sel { fill: var(--ochre); fill-opacity: 0.16; stroke: var(--ochre); stroke-width: 2.5; vector-effect: non-scaling-stroke; }

.pin { position: absolute; transform: translate(-50%, -50%); appearance: none; border: 0; background: transparent; padding: 0; cursor: pointer; line-height: 1; }
.pin .dot { display: block; width: 10px; height: 10px; margin: 0 auto; border-radius: 50%; border: 2px solid var(--paper-2); background: var(--ochre); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
.pin.mine .dot { border-color: var(--paper-2); background: #3f6f8f; border-radius: 2px; border-width: 0; width: 12px; height: 12px; box-shadow: 0 0 0 2px var(--paper-2), 0 1px 3px rgba(0, 0, 0, 0.5); }
.pin.claimed .dot { background: #4d7a4d; }
.pin.sel .dot { background: var(--warn); width: 13px; height: 13px; }
.pin.noted .dot { outline: 2px solid var(--ochre-soft); outline-offset: 1px; }
.pin .code { display: block; position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; color: #fff; background: rgba(30, 28, 24, 0.84); padding: 1px 5px; border-radius: 3px; }

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
