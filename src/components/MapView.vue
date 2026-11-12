<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { state, exportSaveFile, flushMapSave } from '../mapStore.js'
import { saveRemote } from '../persist.js'
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
    showRegions: true, showNames: true,
    showPins: true, onlyMarked: false,
    showColumns: true, colLeft: 1, colRight: 28,
    scopeCodes: REGIONS.map(([code]) => code),
    sheetIds: ['m3'], activeSheet: 'm3',
  }
  let p = null
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(UI_KEY) : null
    if (raw) p = JSON.parse(raw)
  } catch (e) { /* 忽略 */ }
  // localStorage 被禁用时，退回启动阶段从文件存档取到的偏好
  if (!p && typeof window !== 'undefined') p = window.__kingdomUiPrefs || null
  if (!p) return defaults
  try {
    const codes = Array.isArray(p.scopeCodes)
      ? p.scopeCodes.filter((c) => REGIONS.some(([r]) => r === c))
      : defaults.scopeCodes
    const sheetIds = Array.isArray(p.sheetIds)
      ? p.sheetIds.filter((id) => maps.some((m) => m.id === id))
      : defaults.sheetIds
    return {
      showRegions: typeof p.showRegions === 'boolean' ? p.showRegions : defaults.showRegions,
      showNames: typeof p.showNames === 'boolean' ? p.showNames : defaults.showNames,
      showPins: typeof p.showPins === 'boolean' ? p.showPins : defaults.showPins,
      onlyMarked: typeof p.onlyMarked === 'boolean' ? p.onlyMarked : defaults.onlyMarked,
      showColumns: typeof p.showColumns === 'boolean' ? p.showColumns : defaults.showColumns,
      colLeft: Number.isFinite(Number(p.colLeft)) ? Math.round(Number(p.colLeft)) : defaults.colLeft,
      colRight: Number.isFinite(Number(p.colRight)) ? Math.round(Number(p.colRight)) : defaults.colRight,
      scopeCodes: codes,
      sheetIds: sheetIds.length ? sheetIds : defaults.sheetIds,
      activeSheet: maps.some((m) => m.id === p.activeSheet) ? p.activeSheet : defaults.activeSheet,
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
const selectedIds = ref([...uiPrefs.sheetIds])
const activeId = ref(uiPrefs.sheetIds.includes(uiPrefs.activeSheet) ? uiPrefs.activeSheet : uiPrefs.sheetIds[0])
const shownMaps = computed(() => maps.filter((m) => selectedIds.value.includes(m.id)))
// 连续画布：取所选图幅的横向并集（纵向固定为四图共同覆盖的地图带）
// 列区域生效时再与左右边界取交集，让预览、导出和飞书同步都按列裁剪
const view = computed(() => {
  const sel = shownMaps.value
  const x0 = Math.max(Math.min(...sel.map((m) => m.left)), trim.x)
  const x1 = Math.max(...sel.map((m) => m.left + m.w))
  const y0 = trim.y
  const h = layout.h - y0
  const ci = columnInfo
  if (!ci.count) return { x: x0, y: y0, w: x1 - x0, h }
  const l = Math.min(Math.max(Math.round(Number(colLeft.value) || 1), 1), ci.count)
  const r = Math.min(Math.max(Math.round(Number(colRight.value) || ci.count), l), ci.count)
  const nx0 = Math.max(x0, ci.left + (l - 1) * ci.step)
  const nx1 = Math.min(x1, ci.left + r * ci.step)
  // 所选图幅和列范围不相交时退回整段并集，避免只剩空白
  if (nx1 - nx0 < ci.step * 0.2) return { x: x0, y: y0, w: x1 - x0, h }
  return { x: nx0, y: y0, w: nx1 - nx0, h }
})
const activeMap = computed(() => maps.find((m) => m.id === activeId.value) || maps[0])
const selKey = ref('')
// 组件被 KeepAlive 缓存后 document 监听仍然挂着，失活时不能响应点击和快捷键
const isActive = ref(true)
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
// 编号点的状态可能记在编号上，也可能记在它所在的格键上，两种都算
function labelStatus(l, geo) {
  const key = geo.labelCell[l.code]
  const keys = key ? groupKeys(key) : []
  const hit = (map) => !!map[l.code] || keys.some((k) => !!map[k])
  return { claimed: hit(state.hexClaimed), explored: hit(state.hexExplored), noted: hit(state.hexNotes) }
}
function shownFor(geo) {
  const scoped = geo.here.filter((l) => scopeSet.value.has(regionOf(l.code)))
  // 「全部标点」优先：勾选时始终显示全部编号点，不被下方的状态筛选削减
  if (showPins.value) return scoped
  if (!onlyMarked.value) return []
  // 「全部标点」未勾选时，仍保留已探索/占据/备注格的编号点
  const out = scoped.filter((l) => {
    const st = labelStatus(l, geo)
    return st.claimed || st.explored || st.noted
  })
  // 当前选中的格即使未标记也留着，避免「跳到编号」后看不见
  const cur = geo.here.find((l) => l.code === selKey.value)
  return cur && !out.includes(cur) ? [...out, cur] : out
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
  return {
    m, geo,
    // 在连续画布中的位置（相对当前 union 视图）
    style: {
      left: ((m.left - v.x) / v.w) * 100 + '%',
      top: ((m.top - v.y) / v.h) * 100 + '%',
      width: (m.w / v.w) * 100 + '%',
      height: (m.h / v.h) * 100 + '%',
    },
    fade,
    fadePct: fade ? (fade / m.w) * 100 + '%' : '',
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
    view.value.y + ((e.clientY - r.top) / r.height) * view.value.h,
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
    y: v.y + ((e.clientY - r.top) / r.height) * v.h,
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
  delete state.hexExplored[selKey.value]
  delete state.hexClaimed[selKey.value]
  selKey.value = ''
}

// 勾掉状态时连整组格键一起清掉：旧存档里同一物理格可能同时记在格键和编号上，
// 只清 selKey 会让剩下那份键继续把颜色点亮
function clearStateKeys(field) {
  const targets = new Set([selKey.value])
  if (selCellKey.value) {
    for (const key of groupKeys(selCellKey.value)) {
      targets.add(key)
      const code = labelCodeOfKey[key] || plainInfo.value.codeOfKey[key]
      if (code) targets.add(code)
    }
  }
  for (const key of targets) if (key) delete state[field][key]
}
function setExplored(checked) {
  if (checked) state.hexExplored[selKey.value] = true
  else clearStateKeys('hexExplored')
}
function setClaimed(checked) {
  if (checked) state.hexClaimed[selKey.value] = true
  else clearStateKeys('hexClaimed')
}

// 编号点／自定标记在连续画布上的位置
function pinPos(m, x, y) {
  const v = view.value
  return {
    left: (((m.left + x - v.x) / v.w) * 100).toFixed(3) + '%',
    top: (((m.top + y - v.y) / v.h) * 100).toFixed(3) + '%',
  }
}
// 标点文字自适应：按实际像素量出气泡宽度，贴边时向内对齐，顶部放不下就翻到下方
let chipCtx = null
function chipTextWidth(text) {
  if (typeof document === 'undefined') return 0
  if (!chipCtx) chipCtx = document.createElement('canvas').getContext('2d')
  chipCtx.font = '12px "PingFang SC", "Noto Sans CJK SC", sans-serif'
  return chipCtx.measureText(String(text || '')).width + 10
}
function pinPlacement(m, x, y, text) {
  const v = view.value
  const w = wrapW.value
  const h = wrapH.value
  if (!w || !h) return {}
  const px = ((m.left + x - v.x) / v.w) * w
  const py = ((m.top + y - v.y) / v.h) * h
  const half = chipTextWidth(text) / 2
  const out = {}
  // 左右放不下时把文字向内对齐，不再以圆点为中心
  if (px - half < 0) out['edge-left'] = true
  else if (px + half > w) out['edge-right'] = true
  // 上方放不下就翻到下方；下方也放不下时保持上方
  out.flip = py - 36 < 0 && py + 36 <= h
  return out
}
// 全景坐标 → 画布百分比（区域名标注用）
function panPos(x, y) {
  const v = view.value
  return {
    left: (((x - v.x) / v.w) * 100).toFixed(3) + '%',
    top: (((y - v.y) / v.h) * 100).toFixed(3) + '%',
  }
}
// 列号只需要横向百分比，纵向固定贴在地图顶边
function panX(x) {
  const v = view.value
  return (((x - v.x) / v.w) * 100).toFixed(3) + '%'
}

// 点空白处取消选中：只放过地图、侧栏和各类可交互控件，工具栏/页面空白都算空白
function onDocClick(e) {
  if (!isActive.value) return
  if (!e.target.closest('.scopePick')) {
    document.querySelectorAll('details.scopePick[open]').forEach((d) => { d.open = false })
  }
  if (!selKey.value) return
  if (e.target.closest('.mapwrap, .mapAside, button, input, select, textarea, label, a, summary, details')) return
  selKey.value = ''
}
function onKey(e) {
  if (!isActive.value) return
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
const showColumns = ref(uiPrefs.showColumns)    // 列边界与列号（仅预览）
const colLeft = ref(uiPrefs.colLeft)            // 列区域左边界
const colRight = ref(uiPrefs.colRight)          // 列区域右边界
// 勾选框与区域筛选记忆到本地，下次打开沿用
watch([showRegions, showNames, showPins, onlyMarked, showColumns, colLeft, colRight, scopeCodes, selectedIds, activeId], () => {
  const prefs = {
    showRegions: showRegions.value,
    showNames: showNames.value,
    showPins: showPins.value,
    onlyMarked: onlyMarked.value,
    showColumns: showColumns.value,
    colLeft: colLeft.value,
    colRight: colRight.value,
    scopeCodes: scopeCodes.value,
    sheetIds: selectedIds.value,
    activeSheet: activeId.value,
    updatedAt: Date.now(),
  }
  // 本地立即记忆，同时写一份到文件存档，换浏览器或清缓存后也能恢复
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(UI_KEY, JSON.stringify(prefs)) } catch (e) { /* 忽略 */ }
  }
  saveRemote(UI_KEY, prefs)
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
// 编号 → 该编号对应的格键；别名可能记在编号上，也可能落在格键上
const codeKeys = computed(() => {
  const out = {}
  for (const [key, code] of Object.entries(plainInfo.value.codeOfKey)) {
    if (!code) continue
    if (!out[code]) out[code] = []
    out[code].push(key)
  }
  return out
})
const aliases = computed(() => {
  const out = {}
  for (const [code, keys] of Object.entries(codeKeys.value)) {
    const direct = state.hexAliases?.[code]
    const hit = direct || keys.map((k) => state.hexAliases?.[k]).find(Boolean)
    if (hit) out[code] = hit
  }
  return out
})
// 区域色块画在整张全景上，避免在图幅边缘被裁成竖条；同一物理格只画一次
// 区域色块始终渲染全部区域格，不受「仅已探索/占据/备注」影响
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
/* ---------- 列区域：按横向完整的物理格列切分全景 ---------- */
// 图幅 1 左侧、图幅 4 右侧被裁掉的半格不参与列划分，剩余完整格列正好 28 列
const columnInfo = (() => {
  const full = physCells.filter((pc) => pc.x - pc.w / 2 >= -0.5 && pc.x + pc.w / 2 <= layout.w + 0.5)
  if (!full.length) return { first: 0, step: 1, left: 0, right: layout.w, count: 0 }
  let minX = Infinity, maxX = -Infinity, sumW = 0
  for (const pc of full) {
    minX = Math.min(minX, pc.x)
    maxX = Math.max(maxX, pc.x)
    sumW += pc.w
  }
  const avgW = sumW / full.length
  const count = Math.max(1, Math.round((maxX - minX) / avgW) + 1)
  const step = count > 1 ? (maxX - minX) / (count - 1) : avgW
  return { first: minX, step, left: minX - step / 2, right: maxX + step / 2, count }
})()
const columnCount = columnInfo.count
// 画幅裁剪基准：顶部对齐 RL1 所在格的顶边，左侧对齐 TV1 所在格的左边
function labelBox(code) {
  const l = labels.find((x) => x.code === code)
  if (!l) return null
  const m = maps.find((x) => x.id === l.map)
  const geo = geomOf(m)
  const c = geo.byKey[geo.labelCell[code]]
  if (!c) return null
  const verts = cellVerts(geo.g, c.q, c.r).map(([x, y]) => [x + m.left, y + m.top])
  return {
    left: Math.min(...verts.map((p) => p[0])),
    top: Math.min(...verts.map((p) => p[1])),
  }
}
const trim = {
  x: labelBox('TV1')?.left ?? 0,
  y: labelBox('RL1')?.top ?? 0,
}
const columnMarks = computed(() => {
  const out = []
  for (let n = 1; n <= columnInfo.count; n++) {
    const a = Math.max(columnInfo.left + (n - 1) * columnInfo.step, trim.x)
    const b = columnInfo.left + n * columnInfo.step
    out.push({ n, x: (a + b) / 2 })
  }
  return out
})
function normalizeCols() {
  const n = columnCount
  let l = Math.min(Math.max(Math.round(Number(colLeft.value) || 1), 1), n)
  let r = Math.min(Math.max(Math.round(Number(colRight.value) || n), 1), n)
  if (l > r) [l, r] = [r, l]
  colLeft.value = l
  colRight.value = r
}
normalizeCols()

// 编号格（模组标注地点）的格键索引，用来把特殊格与普通格分开
const labelCodeOfKey = (() => {
  const out = {}
  for (const m of maps) {
    for (const [k, code] of Object.entries(geomOf(m).codeOfCell)) out[k] = code
  }
  return out
})()
// 格状态也画在全景层：同一物理格只画完整的一格，避免在图幅接缝处被裁成矩形色块
const stateShapes = computed(() => {
  if (!onlyMarked.value) return []
  const seen = new Set()
  const shapes = []
  for (const m of shownMaps.value) {
    const geo = geomOf(m)
    const g = geo.g
    for (const c of geo.cells) {
      const group = groupKeys(c.key)
      if (seen.has(group[0])) continue
      seen.add(group[0])
      const code = group.map((k) => plainInfo.value.codeOfKey[k]).find(Boolean) || ''
      const claimed = group.some((k) => !!state.hexClaimed[k]) || !!(code && state.hexClaimed[code])
      const explored = group.some((k) => !!state.hexExplored[k]) || !!(code && state.hexExplored[code])
      // 备注只做文字记录，不参与填色；格颜色只表示占据/探索
      if (!claimed && !explored) continue
      const cls = claimed
        ? { claimed: true, explored: false }
        : { claimed: false, explored: true }
      const pts = cellVerts(g, c.q, c.r)
        .map(([x, y]) => `${(x + m.left).toFixed(1)},${(y + m.top).toFixed(1)}`)
        .join(' ')
      shapes.push({ key: c.key, pts, cls })
    }
  }
  return shapes
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
      y: Math.min(Math.max(inside ? cy : near.y, view.value.y + 26), layout.h - 26),
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
  const alias = aliases.value[selKey.value] || ''
  // 有别名时优先显示别名，官方地点名与别名重复时不再重复
  return [alias || selKey.value, r ? r[1] : '', alias && alias === place ? '' : place].filter(Boolean).join(' ')
})

/* ---------- 导出地图图片 ---------- */
const exporting = ref('')
const syncing = ref('')
const syncMsg = ref('')
const toast = ref('')
let toastTimer = null
function showToast(text) {
  toast.value = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2000)
}
const wrapEl = ref(null)
const wrapW = ref(0)
const wrapH = ref(0)
let wrapRo = null
function measureWrap() {
  if (!wrapEl.value) return
  wrapW.value = wrapEl.value.clientWidth
  wrapH.value = wrapEl.value.clientHeight
}
// KeepAlive 让组件在切页时被缓存，回来时要重新量一次容器尺寸
function observeWrap() {
  measureWrap()
  if (typeof ResizeObserver === 'undefined' || !wrapEl.value) return
  if (!wrapRo) wrapRo = new ResizeObserver(measureWrap)
  wrapRo.disconnect()
  wrapRo.observe(wrapEl.value)
}
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
function drawRegionFills(ctx, ox, oy) {
  if (!regionShapes.value.length) return
  ctx.save()
  ctx.globalAlpha = 0.18
  for (const c of regionShapes.value) {
    const pts = ptsOf(c.pts).map(([x, y]) => [x - ox, y - oy])
    tracePath(ctx, pts)
    ctx.fillStyle = c.color
    ctx.fill()
  }
  ctx.restore()
}
// 已探索 / 已占据（全景坐标，与页面同一个全景层）
// 状态色比区域填色更饱和并带描边，保证不与 18% 的区域底色混淆
const STATE_STYLE = {
  claimed: { fill: 'rgba(77, 122, 77, 0.42)', stroke: 'rgba(58, 96, 58, 0.75)' },
  explored: { fill: 'rgba(63, 79, 134, 0.42)', stroke: 'rgba(47, 60, 104, 0.75)' },
}
function drawState(ctx, ox, oy, k) {
  for (const c of stateShapes.value) {
    const st = STATE_STYLE[c.cls.claimed ? 'claimed' : 'explored']
    tracePath(ctx, ptsOf(c.pts).map(([x, y]) => [x - ox, y - oy]))
    ctx.fillStyle = st.fill
    ctx.fill()
    ctx.lineWidth = 1.5 * k
    ctx.strokeStyle = st.stroke
    ctx.stroke()
  }
}
// 标点文字：贴边时向画面内偏移，顶部放不下就移到圆点下方
function drawPinChip(ctx, text, px, py, k, gap, bounds) {
  const fs = 12 * k
  ctx.font = `${fs}px "PingFang SC", "Noto Sans CJK SC", sans-serif`
  const w = ctx.measureText(text).width + 10 * k
  const h = 18 * k
  let cx = px
  if (cx - w / 2 < bounds.left) cx = bounds.left + w / 2
  if (cx + w / 2 > bounds.right) cx = bounds.right - w / 2
  let bottom = py - gap * k
  if (bottom - h < bounds.top) {
    const below = py + gap * k + h
    bottom = below <= bounds.bottom ? below : bounds.top + h
  }
  drawChip(ctx, text, cx, bottom, k)
}
// 编号点与自定标记（图幅本地坐标，调用前已 translate）
function drawPins(ctx, s, k) {
  const v = view.value
  const bounds = {
    left: v.x - s.m.left,
    right: v.x + v.w - s.m.left,
    top: v.y - s.m.top,
    bottom: v.y + v.h - s.m.top,
  }
  for (const l of shownFor(s.geo)) {
    const px = l.x, py = l.y
    ctx.beginPath()
    ctx.arc(px, py, 5 * k, 0, Math.PI * 2)
    ctx.fillStyle = onlyMarked.value
      ? (state.hexClaimed[l.code] ? '#4d7a4d' : state.hexExplored[l.code] ? '#3f4f86' : '#7a5a25')
      : '#7a5a25'
    ctx.fill()
    ctx.lineWidth = 2 * k
    ctx.strokeStyle = '#fbf9f3'
    ctx.stroke()
    // 与预览一致：靠近边缘时文字向内偏移或移到圆点下方
    drawPinChip(ctx, aliases.value[l.code] || l.code, px, py, k, 10, bounds)
  }
  for (const p of s.pins) {
    const px = p.x, py = p.y
    ctx.fillStyle = '#3f6f8f'
    ctx.fillRect(px - 6 * k, py - 6 * k, 12 * k, 12 * k)
    ctx.lineWidth = 2 * k
    ctx.strokeStyle = '#fbf9f3'
    ctx.strokeRect(px - 6 * k, py - 6 * k, 12 * k, 12 * k)
    drawPinChip(ctx, p.name, px, py, k, 12, bounds)
  }
}
// 区域名标注：与页面的标签样式一致
function drawRegionNames(ctx, ox, oy, k) {
  if (!regionLabels.value.length) return
  ctx.font = `${11 * k}px "PingFang SC", "Noto Sans CJK SC", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const l of regionLabels.value) {
    const x = l.x - ox
    const y = l.y - oy
    const w = ctx.measureText(l.name).width + 14 * k
    const h = 18 * k
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 3 * k)
    ctx.fillStyle = 'rgba(246, 242, 233, 0.9)'
    ctx.fill()
    ctx.lineWidth = Math.max(1, k)
    ctx.strokeStyle = 'rgba(96, 80, 54, 0.3)'
    ctx.stroke()
    ctx.fillStyle = '#3b3326'
    ctx.fillText(l.name, x, y)
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
// 与预览同顺序、同颜色的画布：导出图片与同步飞书共用
async function renderMapCanvas() {
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
    ctx.drawImage(src, s.m.left - v.x, s.m.top - v.y, s.m.w, s.m.h)
  }

  // 与页面同样的叠层顺序：区域填色 → 状态 → 标点 → 区域名
  // 线宽、字号、标记按预览缩放比换算，导出图看起来就是预览的样子
  const cw = wrapEl.value?.clientWidth || 0
  const k = cw ? v.w / cw : 2
  drawRegionFills(ctx, v.x, v.y)
  drawState(ctx, v.x, v.y, k)
  for (const s of sheets.value) {
    ctx.save()
    ctx.translate(s.m.left - v.x, s.m.top - v.y)
    drawPins(ctx, s, k)
    ctx.restore()
  }
  drawRegionNames(ctx, v.x, v.y, k)
  return canvas
}
async function exportMap() {
  if (exporting.value || !sheets.value.length) return
  exporting.value = '正在导出…'
  try {
    const canvas = await renderMapCanvas()
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
// 一键同步：只把当前视图的地图图片写入飞书
async function syncToFeishu() {
  if (syncing.value || !sheets.value.length) return
  syncing.value = '正在同步…'
  syncMsg.value = ''
  try {
    const canvas = await renderMapCanvas()
    const res = await fetch('/api/feishu-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: canvas.toDataURL('image/png') }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) throw new Error(data.error || '同步失败')
    syncing.value = ''
    showToast('已写入')
  } catch (err) {
    syncing.value = ''
    syncMsg.value = `同步失败：${err?.message || err}`
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

  // 记录地图容器的实际像素尺寸，标点文字做贴边判断时要用
  observeWrap()

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
// KeepAlive 切回来时恢复监听语义，并重新量容器；切走时停掉点击/快捷键响应
onActivated(() => {
  isActive.value = true
  observeWrap()
})
onDeactivated(() => {
  isActive.value = false
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
  if (wrapRo) wrapRo.disconnect()
  if (hoverRaf) cancelAnimationFrame(hoverRaf)
  if (toastTimer) clearTimeout(toastTimer)
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
        <label>列区域</label>
        <div class="colRange">
          <input type="number" min="1" :max="columnCount" v-model.number="colLeft" class="compact colInput" @change="normalizeCols" />
          <span class="muted">–</span>
          <input type="number" min="1" :max="columnCount" v-model.number="colRight" class="compact colInput" @change="normalizeCols" />
          <span class="muted">/ {{ columnCount }}</span>
        </div>
      </div>
      <div class="field">
        <label>跳到编号</label>
        <input v-model="query" @keyup.enter="jump" maxlength="6" class="compact" style="width: 68px" />
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <button class="act compact" :class="{ on: addMode }" @click="addMode = !addMode">
          {{ addMode ? '点击地图落点…' : '添加标记' }}
        </button>
      </div>
    </div>
    <div class="mapBar checks">
      <label class="check"><input type="checkbox" v-model="showRegions" /><span>区域色块</span></label>
      <label class="check"><input type="checkbox" v-model="showNames" /><span>区域名称</span></label>
      <label class="check" title="勾选后始终显示全部编号点，不受状态筛选影响"><input type="checkbox" v-model="showPins" /><span>全部标点</span></label>
      <label class="check" title="勾选后只高亮已探索/已占据/有备注的格；未勾选全部标点时，仅这些格保留编号点"><input type="checkbox" v-model="onlyMarked" /><span>仅已探索/占据/备注</span></label>
      <label class="check" title="仅预览显示列号，不写入导出图片"><input type="checkbox" v-model="showColumns" /><span>列号</span></label>
    </div>
    <div class="mapBar acts">
      <button class="act" :disabled="!!exporting" @click="exportMap">{{ exporting || '导出图片' }}</button>
      <button class="act" :disabled="!!syncing || !!exporting" @click="syncToFeishu">{{ syncing || '同步到飞书' }}</button>
      <button class="act" @click="exportSaveFile">导出存档</button>
    </div>
    <p class="muted" v-if="syncMsg">{{ syncMsg }}</p>
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
            v-memo="[regionShapes, view.x, view.y, view.w, view.h]"
            :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon v-for="c in regionShapes" :key="c.key" class="hex-region" :points="c.pts" :style="{ fill: c.color }" />
          </svg>
          <svg
            class="statelayer"
            v-memo="[stateShapes, view.x, view.y, view.w, view.h]"
            :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon v-for="c in stateShapes" :key="'st' + c.key" class="hex-st" :class="c.cls" :points="c.pts" />
          </svg>
          <svg
            class="highlightlayer"
            :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon v-for="c in hoverShapes" :key="'h' + c.key" class="hex-hover" :points="c.pts" />
            <polygon v-for="c in selShapes" :key="'sel' + c.key" class="hex-sel" :points="c.pts" />
          </svg>
          <template v-for="s in sheets" :key="'pin:' + s.m.id">
            <button
              v-for="l in shownFor(s.geo)"
              :key="l.code"
              class="pin"
              :class="[{ sel: l.code === selKey, noted: onlyMarked && !!state.hexNotes[l.code], explored: onlyMarked && !!state.hexExplored[l.code], claimed: onlyMarked && !!state.hexClaimed[l.code] }, pinPlacement(s.m, l.x, l.y, aliases[l.code] || l.code)]"
              :style="pinPos(s.m, l.x, l.y)"
              @click.stop="pick(l.code)"
            >
              <span class="dot"></span><span class="code">{{ aliases[l.code] || l.code }}</span>
            </button>
            <button
              v-for="p in s.pins"
              :key="s.m.id + ':' + p.id"
              class="pin mine"
              :class="[{ sel: 'pin:' + p.id === selKey, noted: onlyMarked && !!state.hexNotes['pin:' + p.id], explored: onlyMarked && !!state.hexExplored['pin:' + p.id], claimed: onlyMarked && !!state.hexClaimed['pin:' + p.id] }, pinPlacement(s.m, p.x, p.y, p.name)]"
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
          <div v-if="showColumns" class="labelLayer">
            <span
              v-for="c in columnMarks"
              :key="'cn' + c.n"
              class="columnNum"
              :style="{ left: panX(c.x) }"
            >{{ c.n }}</span>
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

          <label class="check stateCheck">
            <input type="checkbox" :checked="!!state.hexExplored[selKey]" @change="setExplored($event.target.checked)" />
            <i class="swatch explored"></i>
            <span>已探索</span>
          </label>
          <label class="check stateCheck">
            <input type="checkbox" :checked="!!state.hexClaimed[selKey]" @change="setClaimed($event.target.checked)" />
            <i class="swatch claimed"></i>
            <span>已占据</span>
          </label>
          <div class="field" v-if="!curPin">
            <label>别名</label>
            <input v-model="state.hexAliases[selKey]" maxlength="24" @change="flushMapSave" />
          </div>
          <div class="field">
            <label>备注</label>
            <textarea v-model="state.hexNotes[selKey]" @change="flushMapSave"></textarea>
          </div>
          <button v-if="curPin" class="act" style="margin-top: 12px" @click="removePin">删除这个标记（Delete）</button>
        </template>
      </aside>
    </div>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.mapBar { display: flex; flex-wrap: wrap; gap: 12px 14px; align-items: flex-start; margin-bottom: 8px; }
.mapBar > .field > label { font-size: 14px; }
.mapBar .compact { padding: 4px 9px; font-size: 13px; }
.colRange { display: flex; align-items: center; gap: 4px; }
.colRange .colInput { width: 48px; text-align: center; appearance: textfield; -moz-appearance: textfield; }
.colRange .colInput::-webkit-outer-spin-button,
.colRange .colInput::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.panel { border-top: 0; }
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
.sheetPick { display: flex; flex-wrap: wrap; gap: 6px; }
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

/* 区域色块、格状态、悬浮/选中高亮都用全景坐标，跨图幅接缝也能连续 */
.regionlayer, .statelayer, .highlightlayer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hex-region { stroke: none; fill-opacity: 0.18; }
/* 列号：仅预览显示，不进入导出图片 */
.columnNum {
  position: absolute; top: 2px; transform: translateX(-50%);
  padding: 0 4px; border-radius: 2px;
  background: rgba(246, 242, 233, 0.85);
  color: #5c5142; font-size: 10px; line-height: 14px; white-space: nowrap;
}
/* 格状态：比 18% 的区域底色更饱和，并加描边，避免和区域填色混在一起 */
.hex-st.claimed { fill: var(--map-claimed); fill-opacity: 0.42; stroke: var(--map-claimed); stroke-opacity: 0.75; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.hex-st.explored { fill: var(--map-explored); fill-opacity: 0.42; stroke: var(--map-explored); stroke-opacity: 0.75; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
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

.toast {
  position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); z-index: 80;
  padding: 8px 18px; border-radius: 4px;
  background: var(--ink); color: var(--paper-2);
  font-size: 13px; letter-spacing: 0.08em;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  animation: toast-in 0.18s ease-out;
}
@keyframes toast-in {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.pin { position: absolute; transform: translate(-50%, -50%); appearance: none; border: 0; background: transparent; padding: 0; cursor: pointer; line-height: 1; }
.pin .dot { display: block; width: 10px; height: 10px; margin: 0 auto; border-radius: 50%; border: 2px solid var(--paper-2); background: var(--ochre); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
.pin.mine .dot { border-color: var(--paper-2); background: #3f6f8f; border-radius: 2px; border-width: 0; width: 12px; height: 12px; box-shadow: 0 0 0 2px var(--paper-2), 0 1px 3px rgba(0, 0, 0, 0.5); }
.pin.explored .dot { background: var(--map-explored); }
.pin.claimed .dot { background: var(--map-claimed); }
.pin.sel .dot { background: var(--warn); width: 13px; height: 13px; }
.pin.noted .dot { outline: 2px solid var(--ochre-soft); outline-offset: 1px; }
.pin .code { display: block; position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); white-space: nowrap; font-size: 12px; font-variant-numeric: tabular-nums; color: #fff; background: rgba(30, 28, 24, 0.84); padding: 1px 5px; border-radius: 3px; }
.pin.flip .code { bottom: auto; top: 20px; }
.pin.edge-left .code { transform: none; }
.pin.edge-right .code { left: auto; right: 50%; transform: none; }

.mapAside { position: sticky; top: 16px; border-left: 1px solid var(--rule-soft); padding-left: 18px; }
.mapAside.empty { color: var(--ink-3); }
.asideHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.asideHead h3 { margin: 0; font-size: 15px; letter-spacing: 0.02em; }
.mapAside textarea { min-height: 96px; width: 100%; }
.stateCheck { margin: 10px 0 0; }
.stateCheck + .stateCheck { margin-top: 6px; }
.stateCheck + .field { margin-top: 14px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.swatch.claimed { background: var(--map-claimed); }
.swatch.explored { background: var(--map-explored); }
.calTitle { margin: 22px 0 0; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; color: var(--ink-2); }

.act.on { border-color: var(--ochre); color: var(--ochre); background: var(--cover-old); }

@media (max-width: 1180px) {
  .mapLayout { grid-template-columns: 1fr; }
  .mapAside { position: static; border-left: 0; border-top: 1px solid var(--rule-soft); padding: 16px 0 0; }
}
</style>
