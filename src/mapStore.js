import { reactive, watch } from 'vue'

// 地图存档：只保存地图相关的六个字段。
// 主存档保留在 kingdom-map-v1；另有可读快照、元信息、滚动备份，便于外部排查与坏档恢复。
const KEY = 'kingdom-map-v1'
const LEGACY_KEY = 'kingdom-sim-v1'
const SNAPSHOT_KEY = 'kingdom-map-v1.snapshot'
const META_KEY = 'kingdom-map-v1.meta'
const BACKUP_PREFIX = 'kingdom-map-v1.bak.'
const CORRUPT_PREFIX = 'kingdom-map-v1.corrupt.'
const BACKUP_COUNT = 5
const SAVE_DELAY = 400

export const MAP_FIELDS = ['hexClaimed', 'hexNotes', 'pins', 'mapRegions', 'mapCalib', 'diplomacy']

export function mapDefaults() {
  return {
    hexClaimed: {},
    hexNotes: {},
    pins: {},
    mapRegions: {},
    mapCalib: {},
    diplomacy: {},
  }
}

// 从任意存档对象里只挑地图字段；非对象或数组一律丢弃
export function pickMapFields(saved) {
  const out = {}
  for (const k of MAP_FIELDS) {
    const v = saved && saved[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v
  }
  return out
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

// 逐字段清洗：类型不对的值不会进入存档，避免坏数据被反复写回
export function normalizeMapFields(saved) {
  const src = isObj(saved) ? saved : {}
  const out = mapDefaults()
  if (isObj(src.hexClaimed)) {
    for (const [k, v] of Object.entries(src.hexClaimed)) if (v === true) out.hexClaimed[k] = true
  }
  if (isObj(src.hexNotes)) {
    for (const [k, v] of Object.entries(src.hexNotes)) if (typeof v === 'string' && v) out.hexNotes[k] = v
  }
  if (isObj(src.pins)) {
    for (const [mid, list] of Object.entries(src.pins)) {
      if (!Array.isArray(list)) continue
      const arr = []
      for (const p of list) {
        if (!isObj(p)) continue
        const x = Number(p.x)
        const y = Number(p.y)
        if (typeof p.id !== 'string' || !p.id || !Number.isFinite(x) || !Number.isFinite(y)) continue
        arr.push({ id: p.id, x, y, name: typeof p.name === 'string' ? p.name : '' })
      }
      if (arr.length) out.pins[mid] = arr
    }
  }
  if (isObj(src.mapRegions)) {
    for (const [k, v] of Object.entries(src.mapRegions)) if (typeof v === 'string' && v) out.mapRegions[k] = v
  }
  if (isObj(src.mapCalib)) {
    for (const [mid, v] of Object.entries(src.mapCalib)) {
      if (!isObj(v)) continue
      const o = {}
      for (const f of ['rot', 'x0', 'y0', 'W', 'H']) {
        const n = Number(v[f])
        if (Number.isFinite(n)) o[f] = n
      }
      if (Object.keys(o).length) out.mapCalib[mid] = o
    }
  }
  if (isObj(src.diplomacy)) {
    for (const [k, v] of Object.entries(src.diplomacy)) if (v === true) out.diplomacy[k] = true
  }
  return out
}

// 稳定序列化：键排序后再比较，避免同一份数据因顺序不同被重复写入
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue)
  if (isObj(v)) {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k])
    return out
  }
  return v
}
function stableStringify(v) { return JSON.stringify(sortValue(v)) }

function parseFields(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (!isObj(parsed)) return null
    return normalizeMapFields(parsed)
  } catch (e) {
    return null
  }
}

function load() {
  if (typeof localStorage === 'undefined') return mapDefaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = parseFields(raw)
      if (parsed) return parsed
      // 主存档坏了：先把原始字符串留档，再从最近的备份恢复
      try { localStorage.setItem(CORRUPT_PREFIX + Date.now(), raw) } catch (e) { /* 忽略 */ }
      for (let i = 0; i < BACKUP_COUNT; i++) {
        const bak = localStorage.getItem(BACKUP_PREFIX + i)
        if (!bak) continue
        const restored = parseFields(bak)
        if (restored) return restored
      }
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const parsed = parseFields(legacy)
      if (parsed) return parsed
    }
  } catch (e) { /* 存储不可用时退回默认值 */ }
  return mapDefaults()
}

export const state = reactive(load())

let lastWritten = stableStringify(normalizeMapFields(state))
let saveTimer = null
let lastError = ''

function writeMeta() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(META_KEY, JSON.stringify({
      lastSavedAt: new Date().toISOString(),
      lastError,
      primaryKey: KEY,
      snapshotKey: SNAPSHOT_KEY,
      backupCount: BACKUP_COUNT,
    }, null, 1))
  } catch (e) { /* 忽略 */ }
}

function saveNow(reason = 'auto') {
  if (typeof localStorage === 'undefined') return false
  let payload
  try {
    payload = stableStringify(normalizeMapFields(state))
  } catch (e) {
    lastError = `序列化失败：${e.message || e}`
    writeMeta()
    return false
  }
  try {
    const current = localStorage.getItem(KEY)
    // 主存档被外部删除或改写时，即使内存数据没变也补写回去
    if (payload === lastWritten && current === payload) return true
    if (current && current !== payload) {
      if (parseFields(current)) {
        // 滚动备份：bak.4 <- bak.3 ... bak.0 <- 当前主存档
        for (let i = BACKUP_COUNT - 1; i > 0; i--) {
          const prev = localStorage.getItem(BACKUP_PREFIX + (i - 1))
          if (prev) localStorage.setItem(BACKUP_PREFIX + i, prev)
        }
        localStorage.setItem(BACKUP_PREFIX + '0', current)
      } else {
        try { localStorage.setItem(CORRUPT_PREFIX + Date.now(), current) } catch (e) { /* 忽略 */ }
      }
    }
    localStorage.setItem(KEY, payload)
    // 可读快照：外部排查时直接看这个键，或从控制台导出
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        app: 'stolen-lands-map',
        savedAt: new Date().toISOString(),
        reason,
        data: JSON.parse(payload),
      }, null, 1))
    } catch (e) { /* 忽略 */ }
    lastWritten = payload
    lastError = ''
    writeMeta()
    return true
  } catch (e) {
    lastError = `写入失败：${e.message || e}`
    writeMeta()
    return false
  }
}

function scheduleSave() {
  if (typeof window === 'undefined') return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; saveNow('auto') }, SAVE_DELAY)
}

function flushSave() {
  if (typeof window === 'undefined') return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saveNow('flush')
}

// 手动导出一份完整存档，便于外部工具直接查看
export function exportSaveFile() {
  if (typeof document === 'undefined') return
  const text = JSON.stringify({
    app: 'stolen-lands-map',
    savedAt: new Date().toISOString(),
    data: normalizeMapFields(state),
  }, null, 1)
  const blob = new Blob([text], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  a.download = `地图存档-${stamp}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

if (typeof window !== 'undefined') {
  // 第一次从旧键迁移后立刻落一份新键，之后旧键只作回滚备查
  try {
    if (!localStorage.getItem(KEY) && localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(KEY, stableStringify(normalizeMapFields(state)))
    }
  } catch (e) { /* 忽略写入失败 */ }

  watch(state, scheduleSave, { deep: true })
  window.addEventListener('beforeunload', flushSave)
  window.addEventListener('pagehide', flushSave)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave()
    })
  }

  // 多标签页同步：地图页可能同时开在两个窗口
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return
    const next = parseFields(e.newValue)
    if (!next) return
    Object.assign(state, next)
    lastWritten = stableStringify(next)
  })

  // 外部排查入口：可在控制台查看主存档、快照、备份并手动恢复
  window.__kingdomMapSave = {
    key: KEY,
    snapshotKey: SNAPSHOT_KEY,
    metaKey: META_KEY,
    backupKeys: () => Array.from({ length: BACKUP_COUNT }, (_, i) => BACKUP_PREFIX + i),
    read: () => normalizeMapFields(state),
    raw: () => localStorage.getItem(KEY),
    snapshot: () => localStorage.getItem(SNAPSHOT_KEY),
    meta: () => localStorage.getItem(META_KEY),
    exportFile: exportSaveFile,
    saveNow: () => saveNow('manual'),
    restoreBackup: (i) => {
      const raw = localStorage.getItem(BACKUP_PREFIX + i)
      const restored = raw ? parseFields(raw) : null
      if (!restored) return false
      Object.assign(state, restored)
      lastWritten = ''
      return saveNow('restore')
    },
  }
}
