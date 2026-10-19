import { ref } from 'vue'

// 同一时间只允许一个检定速查面板展开；0 表示全部关闭
export const activeQuick = ref(0)

let seq = 0
export function nextQuickId() {
  seq += 1
  return seq
}
