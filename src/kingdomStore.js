import { reactive, watch } from 'vue'
import { saveRemote } from './persist.js'
import { defaultKingdomState, normalizeKingdomState } from './kingdom/model.js'

// 王国经营存档独立于地图：地图仍用 kingdom-map-v1，两边互不覆盖。
const KEY = 'kingdom-manage-v1'
const SNAPSHOT_KEY = 'kingdom-manage-v1.snapshot'
const BACKUP_PREFIX = 'kingdom-manage-v1.bak.'
const CORRUPT_PREFIX = 'kingdom-manage-v1.corrupt.'
const BACKUP_COUNT = 3
const SAVE_DELAY = 400

function parseState(raw) {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? normalizeKingdomState(parsed)
      : null
  } catch (e) {
    return null
  }
}

function load() {
  if (typeof localStorage === 'undefined') return defaultKingdomState()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = parseState(raw)
      if (parsed) return parsed
      try { localStorage.setItem(CORRUPT_PREFIX + Date.now(), raw) } catch (e) { /* 忽略 */ }
    }
    for (let i = 0; i < BACKUP_COUNT; i++) {
      const bak = localStorage.getItem(BACKUP_PREFIX + i)
      if (!bak) continue
      const restored = parseState(bak)
      if (restored) return restored
    }
  } catch (e) { /* 存储不可用时退回默认值 */ }
  return defaultKingdomState()
}

export const state = reactive(load())

let lastWritten = JSON.stringify(normalizeKingdomState(state))
let saveTimer = null

// 从文件存档接管：优先使用服务器里的 saves/，不覆盖 localStorage 的兜底
export function applyRemote(raw) {
  const next = normalizeKingdomState(raw)
  Object.assign(state, next)
  lastWritten = JSON.stringify(next)
}

function saveNow(reason = 'auto') {
  if (typeof localStorage === 'undefined') return false
  let payload
  try {
    payload = JSON.stringify(normalizeKingdomState(state))
  } catch (e) {
    return false
  }
  try {
    const current = localStorage.getItem(KEY)
    if (payload === lastWritten && current === payload) return true
    if (current && current !== payload && parseState(current)) {
      for (let i = BACKUP_COUNT - 1; i > 0; i--) {
        const prev = localStorage.getItem(BACKUP_PREFIX + (i - 1))
        if (prev) localStorage.setItem(BACKUP_PREFIX + i, prev)
      }
      localStorage.setItem(BACKUP_PREFIX + '0', current)
    }
    localStorage.setItem(KEY, payload)
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      app: 'stolen-lands-kingdom',
      savedAt: new Date().toISOString(),
      reason,
      data: JSON.parse(payload),
    }, null, 1))
    lastWritten = payload
    try { saveRemote(KEY, JSON.parse(payload)) } catch (e) { /* 忽略 */ }
    return true
  } catch (e) {
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

export function resetKingdom() {
  Object.assign(state, normalizeKingdomState(defaultKingdomState()))
  lastWritten = ''
  saveNow('reset')
}

export function exportSaveFile() {
  if (typeof document === 'undefined') return
  const text = JSON.stringify({
    app: 'stolen-lands-kingdom',
    savedAt: new Date().toISOString(),
    data: normalizeKingdomState(state),
  }, null, 1)
  const blob = new Blob([text], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  a.download = `王国存档-${stamp}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

// 接受导出文件本身，也接受直接粘贴的状态对象；导入后立刻覆盖并落盘
export function importSaveText(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return false
  }
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.data
    ? parsed.data
    : parsed
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false
  Object.assign(state, normalizeKingdomState(source))
  lastWritten = ''
  return saveNow('import')
}

if (typeof window !== 'undefined') {
  watch(state, scheduleSave, { deep: true })
  window.addEventListener('beforeunload', flushSave)
  window.addEventListener('pagehide', flushSave)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave()
    })
  }
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return
    const next = parseState(e.newValue)
    if (!next) return
    Object.assign(state, next)
    lastWritten = JSON.stringify(next)
  })
  window.__kingdomManageSave = {
    key: KEY,
    snapshotKey: SNAPSHOT_KEY,
    read: () => normalizeKingdomState(state),
    raw: () => localStorage.getItem(KEY),
    snapshot: () => localStorage.getItem(SNAPSHOT_KEY),
    saveNow: () => saveNow('manual'),
    reset: resetKingdom,
    exportFile: exportSaveFile,
    importText: importSaveText,
  }
}
