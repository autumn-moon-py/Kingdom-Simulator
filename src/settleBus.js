import { ref } from 'vue'
import { state, pushLog } from './store.js'

// 回合页的结算锁与撤销快照。放在组件外，切到聚落/军团再回来时不会重置。
export const settled = ref({})
export const undoSnap = ref('')

export function beginSettle(key) {
  if (settled.value[key]) return false
  undoSnap.value = JSON.stringify(state)
  settled.value[key] = true
  return true
}

// 恢复到上一次结算前的状态；返回是否成功
export function undoSettle() {
  if (!undoSnap.value) return false
  const snap = JSON.parse(undoSnap.value)
  for (const k of Object.keys(state)) if (!(k in snap)) delete state[k]
  Object.assign(state, snap)
  settled.value = {}
  undoSnap.value = ''
  pushLog('撤销上一次结算')
  return true
}

export function resetSettles() {
  settled.value = {}
  undoSnap.value = ''
}
