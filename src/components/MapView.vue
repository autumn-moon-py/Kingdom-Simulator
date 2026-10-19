<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { state } from '../store.js'
import mapData from '../data/mapLabels.json'
import hexes from '../data/hexes.json'
import groups from '../data/groups.json'

const maps = mapData.maps
const labels = mapData.labels
const byCode = Object.fromEntries(hexes.map((h) => [h.code, h]))
const labelCodes = new Set(labels.map((l) => l.code))

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

const photos = import.meta.glob('../assets/map-*.jpg', { eager: true, query: '?url', import: 'default' })
const srcOf = (file) => photos[`../assets/${file}`]

const mapId = ref('m3')
const selKey = ref('RL1')
const query = ref('')
const addMode = ref(false)
const showGrid = ref(true)
const hoverKey = ref('')

const map = computed(() => maps.find((m) => m.id === mapId.value))
const mapNo = computed(() => maps.findIndex((m) => m.id === mapId.value) + 1)
const here = computed(() => labels.filter((l) => l.map === mapId.value))
const myPins = computed(() => state.pins[mapId.value] || [])
const info = computed(() => byCode[selKey.value])
const curLabel = computed(() => here.value.find((l) => l.code === selKey.value))
const curPin = computed(() => myPins.value.find((p) => 'pin:' + p.id === selKey.value))

/* ---------- 六角格网：格心 = (X0 + W*(q + r/2), y0 + 0.75H*r)，与印刷格线一一对应 ---------- */
function gridOf(m) {
  const { W, H, x0, y0, parity } = m
  return { W, H, X0: x0 + (parity ? W / 2 : 0), y0 }
}
function cellCenter(g, q, r) { return [g.X0 + g.W * (q + r / 2), g.y0 + 0.75 * g.H * r] }
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
// 像素 → 覆盖该点的格（轴向四舍五入，与格心公式互为逆运算）
function cellAt(g, x, y) {
  const rf = (y - g.y0) / (0.75 * g.H)
  return cubeRound((x - g.X0) / g.W - rf / 2, rf)
}
const cellKey = (q, r) => `${mapId.value}:${q},${r}`

// 当前图幅里所有与画面相交的格（含只露出一角的边缘格）
const cells = computed(() => {
  const m = map.value, g = gridOf(m), out = []
  const rLo = Math.floor(-g.y0 / (0.75 * g.H)) - 1
  const rHi = Math.ceil((m.h - g.y0) / (0.75 * g.H)) + 1
  for (let r = rLo; r <= rHi; r++) {
    const cy = g.y0 + 0.75 * g.H * r
    if (cy < -g.H / 2 || cy > m.h + g.H / 2) continue
    const qLo = Math.floor(-g.X0 / g.W - r / 2) - 1
    const qHi = Math.ceil((m.w - g.X0) / g.W - r / 2) + 1
    for (let q = qLo; q <= qHi; q++) {
      const cx = cellCenter(g, q, r)[0]
      if (cx < -g.W / 2 || cx > m.w + g.W / 2) continue
      out.push({ q, r, key: `${m.id}:${q},${r}`, pts: cellPoints(g, q, r) })
    }
  }
  return out
})
const cellByKey = computed(() => Object.fromEntries(cells.value.map((c) => [c.key, c])))

// 第几行第几格（供界面说话用；按行内从左到右编号）
const cellIndex = computed(() => {
  const byRow = {}
  for (const c of cells.value) (byRow[c.r] = byRow[c.r] || []).push(c)
  const out = {}
  Object.keys(byRow).map(Number).sort((a, b) => a - b).forEach((r, i) => {
    byRow[r].sort((a, b) => a.q - b.q).forEach((c, j) => { out[c.key] = { row: i + 1, col: j + 1 } })
  })
  return out
})

// 编号点落在哪一格 / 该格挂着哪个编号
const labelCell = computed(() => {
  const g = gridOf(map.value), out = {}
  for (const l of here.value) out[l.code] = `${mapId.value}:${cellAt(g, l.x, l.y).join(',')}`
  return out
})
const codeOfCell = computed(() => {
  const out = {}
  for (const [code, key] of Object.entries(labelCell.value)) if (!out[key]) out[key] = code
  return out
})
// 已有状态的格：已占据 / 已备注
const stateCells = computed(() => {
  const out = []
  for (const c of cells.value) {
    const code = codeOfCell.value[c.key]
    const claimed = !!state.hexClaimed[c.key] || !!(code && state.hexClaimed[code])
    const noted = !!state.hexNotes[c.key] || !!(code && state.hexNotes[code])
    if (claimed || noted) out.push({ key: c.key, pts: c.pts, cls: { claimed, noted: !claimed } })
  }
  return out
})
const hoverCell = computed(() => cellByKey.value[hoverKey.value])
const selCell = computed(() => cellByKey.value[selKey.value])

// 显示范围：默认只显示与王国有关的格（已占据／已备注），否则 77 个圆点连编号一起压在图上看不清
const scope = ref('marked')
const scopeRegions = computed(() => REGIONS
  .map(([code, name]) => ({ code, name, count: here.value.filter((l) => regionOf(l.code) === code).length }))
  .filter((r) => r.count))
const shown = computed(() => {
  const list = here.value
  let out = list
  if (scope.value === 'marked') out = list.filter((l) => state.hexNotes[l.code] || state.hexClaimed[l.code])
  else if (scope.value !== 'all') out = list.filter((l) => regionOf(l.code) === scope.value)
  // 当前选中的格即使落在范围外也留着，否则「跳到编号」会跳到看不见的位置
  const cur = list.find((l) => l.code === selKey.value)
  return cur && !out.includes(cur) ? [...out, cur] : out
})
// 换图幅后原来选的区域可能不存在，退回默认范围，免得图上一片空白
watch(mapId, () => {
  const s = scope.value
  if (s !== 'marked' && s !== 'all' && !scopeRegions.value.some((r) => r.code === s)) scope.value = 'marked'
  hoverKey.value = ''
})

function pick(code) {
  const l = labels.find((x) => x.code === code)
  if (!l) return
  mapId.value = l.map
  selKey.value = code
}
// 格子索引并进地图页：列表与地图点选写同一个 selKey，不再有两个入口
const hexQuery = ref('')
const hexFiltered = computed(() => {
  const k = hexQuery.value.trim().toLowerCase()
  if (!k) return hexes
  return hexes.filter((h) => (h.code + h.name + h.region).toLowerCase().includes(k))
})
function selectHex(code) {
  const l = labels.find((x) => x.code === code)
  if (l) mapId.value = l.map
  selKey.value = code
}
function jump() {
  const q = query.value.trim().toUpperCase()
  if (q) pick(q)
}

// 当前选中物的说法：编号 / 未标注格 / 自定标记
const selText = computed(() => {
  if (curPin.value) return curPin.value.name
  if (selCell.value) {
    const i = cellIndex.value[selKey.value]
    return `第 ${i.row} 行第 ${i.col} 格`
  }
  return selKey.value || '未选中'
})

// 点哪儿标哪儿 + 点格选格：都按底图像素坐标换算
function imgPoint(e) {
  const r = e.currentTarget.getBoundingClientRect()
  return [((e.clientX - r.left) / r.width) * map.value.w, ((e.clientY - r.top) / r.height) * map.value.h]
}
function onMapClick(e) {
  const [x, y] = imgPoint(e)
  if (addMode.value) {
    if (!state.pins[mapId.value]) state.pins[mapId.value] = []
    const id = Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36)
    const pin = { id, x: Math.round(x), y: Math.round(y), name: '新标记 ' + (state.pins[mapId.value].length + 1) }
    state.pins[mapId.value].push(pin)
    selKey.value = 'pin:' + id
    addMode.value = false
    return
  }
  const key = `${mapId.value}:${cellAt(gridOf(map.value), x, y).join(',')}`
  if (!cellByKey.value[key]) return
  selKey.value = codeOfCell.value[key] || key
}
function onMapMove(e) {
  if (addMode.value) { hoverKey.value = ''; return }
  const [x, y] = imgPoint(e)
  const key = `${mapId.value}:${cellAt(gridOf(map.value), x, y).join(',')}`
  hoverKey.value = cellByKey.value[key] ? key : ''
}

function removePin() {
  const p = curPin.value
  if (!p) return
  const arr = state.pins[mapId.value]
  arr.splice(arr.indexOf(p), 1)
  delete state.hexNotes[selKey.value]
  delete state.hexClaimed[selKey.value]
  selKey.value = ''
}

function pos(l) {
  return { left: ((l.x / map.value.w) * 100).toFixed(3) + '%', top: ((l.y / map.value.h) * 100).toFixed(3) + '%' }
}

// 旧存档的落点按 west/east 坐标存，换成四块裁片后跟着换算，免得用户自己打的点丢掉
onMounted(() => {
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
</script>

<template>
  <div class="panel">
    <h2>地图</h2>
    <div class="row" style="margin-bottom: 12px">
      <div class="field">
        <label>图幅</label>
        <select v-model="mapId">
          <option v-for="m in maps" :key="m.id" :value="m.id">{{ m.title }}</option>
        </select>
      </div>
      <div class="field">
        <label>显示<span class="muted">（{{ shown.length }} / {{ here.length }}）</span></label>
        <select v-model="scope" style="max-width: 210px">
          <option value="marked">已占据／已备注</option>
          <option value="all">全部格子</option>
          <option v-for="r in scopeRegions" :key="r.code" :value="r.code">{{ r.code }} {{ r.name }}（{{ r.count }}）</option>
        </select>
      </div>
      <div class="field">
        <label>跳到编号</label>
        <input v-model="query" placeholder="如 GB1、RL1、TW5" @keyup.enter="jump" style="width: 150px" />
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
        <label>当前</label>
        <div style="padding-top: 7px"><span class="tag">{{ selText }}</span></div>
      </div>
    </div>
    <p class="muted" style="margin-bottom: 12px">
      点格子即选中它（格网与图上印刷的格线对齐）；带编号的圆点是原模组标出的特殊六角格，格上有编号即选中该格。
    </p>

    <div
      class="mapwrap"
      :class="{ adding: addMode }"
      @click="onMapClick"
      @mousemove="onMapMove"
      @mouseleave="hoverKey = ''"
    >
      <img :src="srcOf(map.file)" :alt="map.title" draggable="false" />
      <svg class="hexlayer" :viewBox="`0 0 ${map.w} ${map.h}`" aria-hidden="true">
        <polygon v-for="c in (showGrid ? cells : [])" :key="c.key" class="hex" :points="c.pts" />
        <polygon v-for="c in stateCells" :key="'s' + c.key" class="hex-st" :class="c.cls" :points="c.pts" />
        <polygon v-if="hoverCell" class="hex-hover" :points="hoverCell.pts" />
        <polygon v-if="selCell" class="hex-sel" :points="selCell.pts" />
      </svg>
      <button
        v-for="l in shown"
        :key="l.code"
        class="pin"
        :class="{ sel: l.code === selKey, noted: !!state.hexNotes[l.code], claimed: !!state.hexClaimed[l.code], grp: diploMode, home: diploMode && !!groupByCode[l.code] }"
        :style="{ ...pos(l), '--grp': diploMode ? (groupByCode[l.code] ? groupByCode[l.code].color : regionColor(l.code)) : null }"
        @click.stop="pick(l.code)"
      >
        <span class="dot"></span><span class="code">{{ l.code }}</span>
        <span class="gcode" v-if="diploMode">{{ groupByCode[l.code] ? groupByCode[l.code].name : (regionName[regionOf(l.code)] || regionOf(l.code)) }}</span>
      </button>
      <button
        v-for="p in myPins"
        :key="p.id"
        class="pin mine"
        :class="{ sel: 'pin:' + p.id === selKey, noted: !!state.hexNotes['pin:' + p.id], claimed: !!state.hexClaimed['pin:' + p.id] }"
        :style="pos(p)"
        @click.stop="selKey = 'pin:' + p.id"
      >
        <span class="dot"></span><span class="code">{{ p.name }}</span>
      </button>
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
            <button v-if="g.code && labelCodes.has(g.code)" class="act mini" @click="pick(g.code)">{{ g.code }}</button>
            <span v-else class="muted">{{ g.code || '—' }}</span>
          </td>
          <td class="num">{{ g.dc ?? '—' }}</td>
          <td><input type="checkbox" v-model="state.diplomacy[g.name]" /></td>
          <td class="muted">{{ g.army || '—' }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="panel">
    <details class="more">
      <summary>格子索引<span class="muted">　{{ hexes.length }} 个带资源的格</span></summary>
      <div class="field" style="margin-top: 8px">
        <input v-model="hexQuery" placeholder="输入编号、地点名或区域，例如 RL1 / 麋鹿 / 钩舌沼泽" />
      </div>
      <div class="hexlist" style="margin-top: 10px">
        <button
          v-for="h in hexFiltered"
          :key="h.code"
          :class="{ sel: h.code === selKey }"
          @click="selectHex(h.code)"
        >
          <span class="code">{{ h.code }}</span>
          <span>{{ h.name }}</span>
          <span class="note-dot" v-if="state.hexNotes[h.code]">●</span>
        </button>
      </div>
    </details>
  </div>

  <div class="panel" v-if="selKey">
    <h2>{{ curPin ? curPin.name : selKey }}<span class="muted" v-if="selCell">　图 {{ mapNo }} · {{ selText }}</span></h2>

    <template v-if="curPin">
      <div class="field" style="margin-bottom: 10px">
        <label>标记名称</label>
        <input v-model="curPin.name" style="width: 240px" />
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
    <button v-if="curPin" class="act" style="margin-top: 10px" @click="removePin">删除这个标记</button>
  </div>
</template>

<style scoped>
/* 容器必须与图片边界严格重合，否则点击换算与标记定位都会偏 */
.mapwrap { position: relative; line-height: 0; margin-top: 14px; cursor: pointer; }
.mapwrap img { width: 100%; height: auto; display: block; user-select: none; }
.mapwrap.adding { cursor: crosshair; }
.mapwrap.adding img { opacity: 0.92; }

/* 六角格图层：与图片同一坐标系（viewBox = 底图像素），随图片等比缩放 */
.hexlayer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hex { fill: none; stroke: rgba(255, 255, 255, 0.42); stroke-width: 1; vector-effect: non-scaling-stroke; }
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

.swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }

.act.on { border-color: var(--ochre); color: var(--ochre); background: var(--cover-old); }
</style>
