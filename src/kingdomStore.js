import { reactive, watch } from 'vue'
import { saveRemote, beaconSave, hasFileSave } from './persist.js'
import { defaultKingdomState, normalizeKingdomState } from './kingdom/model.js'

// 王国经营存档独立于地图：地图仍用 kingdom-map-v1，两边互不覆盖。
const KEY = 'kingdom-manage-v1'
const SNAPSHOT_KEY = 'kingdom-manage-v1.snapshot'
const SAVED_AT_KEY = 'kingdom-manage-v1.saved-at'
const BACKUP_PREFIX = 'kingdom-manage-v1.bak.'
const CORRUPT_PREFIX = 'kingdom-manage-v1.corrupt.'
const BACKUP_COUNT = 3
const SAVE_DELAY = 400

// 保存状态供界面展示：最近保存时间、本地与文件两条路径是否可用
export const saveStatus = reactive({
  savedAt: 0,
  localOk: true,
  fileOk: null,
  error: '',
})

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
let lastRemoteSave = Promise.resolve(true)
let saveTimer = null

function readLocalSavedAt() {
  if (typeof localStorage === 'undefined') return 0
  try {
    const n = Number(localStorage.getItem(SAVED_AT_KEY))
    if (Number.isFinite(n) && n > 0) return n
    // 旧版本只在快照里记了保存时间，迁移时拿它当本地时间基线
    const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null')
    const t = snapshot ? Date.parse(snapshot.savedAt) : 0
    return Number.isFinite(t) && t > 0 ? t : 0
  } catch (e) {
    return 0
  }
}

function hasLocalSave() {
  if (typeof localStorage === 'undefined') return false
  try { return !!localStorage.getItem(KEY) } catch (e) { return false }
}

function markSavedAt(value) {
  saveStatus.savedAt = value
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(SAVED_AT_KEY, String(value)) } catch (e) { /* 忽略 */ }
}

if (typeof localStorage !== 'undefined') {
  saveStatus.savedAt = readLocalSavedAt()
  // 老本地存档没有时间戳：补一个基线，避免第一次启动就被旧文件覆盖
  if (!saveStatus.savedAt && hasLocalSave()) markSavedAt(Date.now())
}

// 从文件存档接管：本地较新时不接受旧文件，并把本地回写文件
export function applyRemote(raw) {
  const remoteAt = Number(raw && raw.savedAt) || 0
  const localAt = readLocalSavedAt()
  if (localAt > 0 && (!remoteAt || localAt > remoteAt)) {
    saveStatus.fileOk = true
    saveNow('local-newer', { force: true })
    return false
  }
  const next = normalizeKingdomState(raw)
  Object.assign(state, next)
  lastWritten = JSON.stringify(next)
  if (remoteAt) markSavedAt(remoteAt)
  saveStatus.fileOk = true
  return true
}

function writeSnapshot(data, reason, savedAt) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
      app: 'stolen-lands-kingdom',
      savedAt: new Date(savedAt).toISOString(),
      reason,
      data,
    }, null, 1))
  } catch (e) { /* 忽略 */ }
}

// 配额不足时清掉次要键，给主存档让位；坏档留档也一并清掉
function cleanupSecondary() {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(SNAPSHOT_KEY) } catch (e) { /* 忽略 */ }
  for (let i = 0; i < BACKUP_COUNT; i++) {
    try { localStorage.removeItem(BACKUP_PREFIX + i) } catch (e) { /* 忽略 */ }
  }
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(CORRUPT_PREFIX)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch (e) { /* 忽略 */ }
}

function saveNow(reason = 'auto', options = {}) {
  let data
  let payload
  try {
    data = normalizeKingdomState(state)
    payload = JSON.stringify(data)
  } catch (e) {
    saveStatus.error = `序列化失败：${e.message || e}`
    lastRemoteSave = Promise.resolve(false)
    return false
  }
  const savedAt = Date.now()
  // 文件存档成功也算保存时间；本地缓存被浏览器禁用时界面仍能显示最近保存
  saveStatus.savedAt = savedAt
  let current = null
  if (typeof localStorage !== 'undefined') {
    try { current = localStorage.getItem(KEY) } catch (e) { current = null }
  }
  // 内容没变且文件上次写入成功时不必重复落盘；本地较新回写文件时强制提交
  if (!options.force && payload === lastWritten && current === payload && saveStatus.fileOk === true) {
    saveStatus.localOk = true
    return true
  }

  let localOk = true
  let localError = ''
  if (typeof localStorage !== 'undefined') {
    // 备份是附加信息：配额不足时只丢备份，不阻止主存档写入
    try {
      if (current && current !== payload && parseState(current)) {
        for (let i = BACKUP_COUNT - 1; i > 0; i--) {
          const prev = localStorage.getItem(BACKUP_PREFIX + (i - 1))
          if (prev) localStorage.setItem(BACKUP_PREFIX + i, prev)
        }
        localStorage.setItem(BACKUP_PREFIX + '0', current)
      }
    } catch (e) { /* 忽略备份失败 */ }
    try {
      localStorage.setItem(KEY, payload)
    } catch (e) {
      localOk = false
      localError = `本地保存失败：${e.message || e}`
      // 配额通常被旧快照、备份或坏档占满：清掉次要键后重试一次
      cleanupSecondary()
      try {
        localStorage.setItem(KEY, payload)
        localOk = true
        localError = ''
      } catch (e2) {
        localError = `本地保存失败：${e2.message || e2}`
      }
    }
    if (localOk) {
      markSavedAt(savedAt)
      writeSnapshot(data, reason, savedAt)
    }
  }
  lastWritten = payload
  saveStatus.localOk = localOk
  if (localError) {
    saveStatus.error = localError
    console.warn('[kingdom-save]', localError)
  }

  // 本地写入失败也继续提交文件，保证至少有一条落盘路径
  const submit = options.beacon ? beaconSave : saveRemote
  lastRemoteSave = Promise.resolve(submit(KEY, { ...data, savedAt }))
    .then((ok) => {
      if (ok) {
        // 文件存档优先；本地缓存被禁用时不再提示为保存失败
        saveStatus.fileOk = true
        saveStatus.error = ''
        return true
      }
      saveStatus.fileOk = false
      saveStatus.error = localError || '文件存档未连接，改动只保存在此浏览器'
      return false
    })
    .catch((e) => {
      saveStatus.fileOk = false
      saveStatus.error = localError || `文件存档失败：${e.message || e}`
      return false
    })
  return localOk
}

function scheduleSave() {
  if (typeof window === 'undefined') return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; saveNow('auto') }, SAVE_DELAY)
}

function flushSave(reason = 'flush', useBeacon = false, force = false) {
  if (typeof window === 'undefined') return false
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  return saveNow(reason, { beacon: useBeacon, force })
}

// 关键操作后立即落盘，不等 400ms 防抖
export function flushKingdomSave() {
  return flushSave('manual')
}

// 手动保存按钮：即使内容没变也完整提交一次，返回文件存档结果
export async function saveKingdomNow() {
  if (typeof window === 'undefined') return false
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saveNow('manual', { force: true })
  return lastRemoteSave
}

export async function checkFileSave() {
  const ok = await hasFileSave()
  saveStatus.fileOk = ok
  if (ok) saveStatus.error = ''
  else saveStatus.error = saveStatus.localOk
    ? '文件存档未连接，改动只保存在此浏览器'
    : '文件存档与浏览器本地缓存均不可用'
  return ok
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
  saveNow('import')
  return true
}

if (typeof window !== 'undefined') {
  watch(state, scheduleSave, { deep: true })
  window.addEventListener('beforeunload', () => flushSave('beforeunload', true))
  window.addEventListener('pagehide', () => flushSave('pagehide', true))
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave('hidden', true)
    })
  }
  window.addEventListener('storage', (e) => {
    if (e.key === SAVED_AT_KEY) {
      const t = Number(e.newValue) || 0
      if (t) saveStatus.savedAt = t
      return
    }
    if (e.key !== KEY || !e.newValue) return
    const next = parseState(e.newValue)
    if (!next) return
    Object.assign(state, next)
    lastWritten = JSON.stringify(next)
  })
  window.__kingdomManageSave = {
    key: KEY,
    snapshotKey: SNAPSHOT_KEY,
    savedAtKey: SAVED_AT_KEY,
    read: () => normalizeKingdomState(state),
    raw: () => localStorage.getItem(KEY),
    snapshot: () => localStorage.getItem(SNAPSHOT_KEY),
    saveNow: () => saveNow('manual'),
    flush: flushKingdomSave,
    saveForce: saveKingdomNow,
    checkFile: checkFileSave,
    status: () => ({ ...saveStatus }),
    reset: resetKingdom,
    exportFile: exportSaveFile,
    importText: importSaveText,
  }
}
