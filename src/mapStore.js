import { reactive, watch } from 'vue'
import { saveRemote } from './persist.js'

// 地图存档：只保存地图用到的六个字段（探索、占据、备注、别名、自定标记、格网校准）。
// 主存档保留在 kingdom-map-v1；另有可读快照、元信息、滚动备份，便于外部排查与坏档恢复。
const KEY = 'kingdom-map-v1'
const LEGACY_KEY = 'kingdom-sim-v1'
const SNAPSHOT_KEY = 'kingdom-map-v1.snapshot'
const META_KEY = 'kingdom-map-v1.meta'
const SAVED_AT_KEY = 'kingdom-map-v1.saved-at'
const BACKUP_PREFIX = 'kingdom-map-v1.bak.'
const CORRUPT_PREFIX = 'kingdom-map-v1.corrupt.'
const ALIAS_MIGRATED_KEY = 'kingdom-map-v1.alias-migrated'
const BACKUP_COUNT = 5
const SAVE_DELAY = 400

export const MAP_FIELDS = ['hexExplored', 'hexClaimed', 'hexNotes', 'hexAliases', 'pins', 'mapCalib']

export function mapDefaults() {
  return {
    hexExplored: {},
    hexClaimed: {},
    hexNotes: {},
    hexAliases: {},
    pins: {},
    mapCalib: {},
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
  if (isObj(src.hexExplored)) {
    for (const [k, v] of Object.entries(src.hexExplored)) if (v === true) out.hexExplored[k] = true
  }
  if (isObj(src.hexClaimed)) {
    for (const [k, v] of Object.entries(src.hexClaimed)) if (v === true) out.hexClaimed[k] = true
  }
  if (isObj(src.hexNotes)) {
    for (const [k, v] of Object.entries(src.hexNotes)) if (typeof v === 'string' && v) out.hexNotes[k] = v
  }
  if (isObj(src.hexAliases)) {
    for (const [k, v] of Object.entries(src.hexAliases)) {
      if (typeof v === 'string' && v.trim()) out.hexAliases[k] = v.trim()
    }
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
  return out
}

// 旧备注里常被当成地名使用：单行、够短、没有句子标点，才当作别名迁移；备注本身保留
export function looksLikeAlias(text) {
  const s = String(text ?? '').trim()
  if (!s || s.length > 24) return false
  if (/[\n\r，。！？；：、,.!?;:]/.test(s)) return false
  return true
}

// 一次性的备注转别名，返回迁移数量
export function migrateNoteAliases(target) {
  if (!isObj(target) || !isObj(target.hexNotes)) return 0
  if (!isObj(target.hexAliases)) target.hexAliases = {}
  let count = 0
  for (const [key, note] of Object.entries(target.hexNotes)) {
    if (!looksLikeAlias(note)) continue
    if (target.hexAliases[key]) continue
    target.hexAliases[key] = String(note).trim()
    count += 1
  }
  return count
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

function hasMapData(v) {
  if (!isObj(v)) return false
  for (const k of MAP_FIELDS) {
    const field = v[k]
    if (isObj(field) && Object.keys(field).length) return true
  }
  return false
}
function readLocalSavedAt() {
  if (typeof localStorage === 'undefined') return 0
  try {
    const n = Number(localStorage.getItem(SAVED_AT_KEY))
    if (Number.isFinite(n) && n > 0) return n
    const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null')
    const t = meta ? Date.parse(meta.lastSavedAt) : 0
    return Number.isFinite(t) ? t : 0
  } catch (e) {
    return 0
  }
}

// 老版本留下的本地存档没有时间戳：以当前时间作为基线，避免被旧文件覆盖
if (typeof localStorage !== 'undefined' && hasMapData(state) && !readLocalSavedAt()) {
  try { localStorage.setItem(SAVED_AT_KEY, String(Date.now())) } catch (e) { /* 忽略 */ }
}

// 从文件存档接管：本地有数据且不比文件旧时保留本地，刷新不会丢刚改的内容
export function applyRemote(raw) {
  const remoteAt = Number(raw && raw.savedAt) || 0
  const localAt = readLocalSavedAt()
  // 本地有保存时间且不比文件旧时保留本地；旧文件没有时间戳时也不覆盖已有本地数据
  if (localAt > 0 && (!remoteAt || localAt > remoteAt)) return false
  if (!localAt && hasMapData(state) && !remoteAt) return false
  const next = normalizeMapFields(raw)
  Object.assign(state, next)
  lastWritten = stableStringify(next)
  if (remoteAt) {
    try { localStorage.setItem(SAVED_AT_KEY, String(remoteAt)) } catch (e) { /* 忽略 */ }
  }
  return true
}

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
  let payload
  try {
    payload = stableStringify(normalizeMapFields(state))
  } catch (e) {
    lastError = `序列化失败：${e.message || e}`
    writeMeta()
    return false
  }
  const savedAt = Date.now()
  // 本地写入失败（隐私模式/禁用存储）时仍然提交到文件存档
  if (typeof localStorage !== 'undefined') {
    try {
      const current = localStorage.getItem(KEY)
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
      try { localStorage.setItem(SAVED_AT_KEY, String(savedAt)) } catch (e) { /* 忽略 */ }
      // 可读快照：外部排查时直接看这个键，或从控制台导出
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
          app: 'stolen-lands-map',
          savedAt: new Date().toISOString(),
          reason,
          data: JSON.parse(payload),
        }, null, 1))
      } catch (e) { /* 忽略 */ }
      writeMeta()
      lastError = ''
    } catch (e) {
      lastError = `本地写入失败：${e.message || e}`
    }
  }
  lastWritten = payload
  try { saveRemote(KEY, { ...JSON.parse(payload), savedAt }) } catch (e) { /* 忽略 */ }
  return true
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

// 输入框失焦时立即落盘，不必等 400ms 防抖
export function flushMapSave() {
  flushSave()
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
  // 旧存档第一次升级：把像地名的备注复制成别名，备注保留；只跑一次
  try {
    if (!localStorage.getItem(ALIAS_MIGRATED_KEY)) {
      const added = migrateNoteAliases(state)
      localStorage.setItem(ALIAS_MIGRATED_KEY, '1')
      if (added) saveNow('alias-migrate')
    }
  } catch (e) { /* 忽略迁移失败 */ }

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
