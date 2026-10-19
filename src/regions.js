// 第二章「六角格」的 19 个区域：编号前缀 → 区域名。地图页与王国卡共用
export const REGIONS = [
  ['RL', '罗斯特兰腹地'], ['GB', '翠绿之地'], ['TW', '獠牙湖'], ['KL', '卡姆兰德'], ['NM', '纳马彻斯森林'],
  ['SH', '塞伦丘陵'], ['DS', '邓斯沃德'], ['NH', '诺门高地'], ['LV', '勒维尼斯山峦'], ['HT', '钩舌沼泽'],
  ['DR', '德雷列夫'], ['TL', '虎领主领'], ['RU', '灯火'], ['GL', '格莱尼邦低地'], ['PX', '皮塔克斯'],
  ['GU', '格莱尼邦高地'], ['NU', '努梅里亚'], ['TV', '千声之地'], ['BR', '布兰特伦德山脉'],
]

export const REGION_NAME = Object.fromEntries(REGIONS)

// 编号前缀即区域码；未收录的前缀归到「其他区域」，避免下拉里漏掉整片格
export function regionOf(code) {
  const m = String(code).match(/^[A-Z]+/)
  return m ? m[0] : ''
}

export function groupByRegion(list) {
  const by = new Map()
  for (const l of list) {
    const r = regionOf(l.code)
    if (!by.has(r)) by.set(r, [])
    by.get(r).push(l)
  }
  return [...by.entries()].map(([code, items]) => ({ code, name: REGION_NAME[code] || '其他区域', items }))
}
