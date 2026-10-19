import { state } from './store.js'

// 勇敢鼠鼠兼容层：只负责判定换算与录入格式，不改动应用内的资源、等级、货币数值。
// 换算依据：拥王者战役/杂项转换/检定转换.md

export const MOUSE_TIERS = ['大失败', '失败', '成功', '大成功']

// 2d6 达到 K 点的累计成功率（K = 2..12）
const P2D6 = [0, 0, 1, 0.972, 0.917, 0.833, 0.722, 0.583, 0.417, 0.278, 0.167, 0.083, 0.028]

// PF DC → 2d6 DC：先取不低于 PF 成功率的最大 K，再降两档；原 DC ≥25 封顶 12。
// 基准加值默认 0，对应转换文档里的 T = 原DC。
export function mouseDC(pfDC, base = 0) {
  const dc = Number(pfDC)
  if (!Number.isFinite(dc)) return 12
  if (dc >= 25) return 12
  const t = Math.max(1, dc - (Number(base) || 0))
  const p = Math.min(1, Math.max(0, (21 - t) / 20))
  let k0 = 2
  for (let k = 12; k >= 2; k--) {
    if (P2D6[k] >= p) { k0 = k; break }
  }
  return Math.max(2, k0 - 2)
}

// 平值检定 → 幸运骰 X-in-6（X = 成功率×6 向上取整，钳 1–6）
export function luckDie(pfDC) {
  const dc = Number(pfDC)
  if (!Number.isFinite(dc)) return 6
  const p = Math.min(1, Math.max(0, (21 - dc) / 20))
  return Math.min(6, Math.max(1, Math.ceil(p * 6)))
}

export function mouseTierOf(name) {
  return MOUSE_TIERS.indexOf(name)
}

// 鼠鼠模式只报 2d6 DC 与档位；建筑、熟练等 PF 加值由 GM 在桌上折算。
export function rollLine({ mouse, dc, d, mod, total, tier }) {
  if (mouse) {
    const note = mod ? `（桌上另计 ${mod >= 0 ? '+' : ''}${mod}）` : ''
    return `2d6 DC ${mouseDC(dc, state.mouseBase)}${note} → ${tier}`
  }
  return `d20 ${d}${mod >= 0 ? '+' : ''}${mod} = ${total} 对抗 DC ${dc} → ${tier}`
}

export function flatLine({ mouse, dc, d, ok }) {
  if (mouse) return `幸运骰 ${luckDie(dc)}-in-6 → ${ok ? '成功' : '失败'}`
  return `d20 ${d} 对抗 DC ${dc} → ${ok ? '成功' : '失败'}`
}
