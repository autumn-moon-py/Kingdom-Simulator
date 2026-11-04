// 地图同步报告：把物理格状态汇总成总览、区域进度与清单，并转成飞书文档 XML。
// 文档会给玩家看：未探索格的地点名与备注不写入正文，只保留编号与数量。

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\n/g, '<br/>')

const pct = (n, total) => (total ? ((n / total) * 100).toFixed(1) : '0.0')

// 编号排序：先按区域顺序，再按编号里的数字，RL2 排在 RL10 前面
function compareCode(a, b, regionIndex) {
  const ra = regionIndex.has(a.region) ? regionIndex.get(a.region) : 999
  const rb = regionIndex.has(b.region) ? regionIndex.get(b.region) : 999
  if (ra !== rb) return ra - rb
  const na = Number((a.code || '').replace(/\D+/g, ''))
  const nb = Number((b.code || '').replace(/\D+/g, ''))
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return String(a.code).localeCompare(String(b.code))
}

export function buildMapReport(cells, meta = {}) {
  const regionList = meta.regions || []
  const regionIndex = new Map(regionList.map((r, i) => [r.code, i]))
  const nameOf = new Map(regionList.map((r) => [r.code, r.name]))
  const rows = new Map()

  const specialExplored = []
  const specialUnexplored = []
  const notes = []
  let hiddenNotes = 0

  for (const c of cells || []) {
    if (!c || !c.region) continue
    if (!rows.has(c.region)) {
      rows.set(c.region, {
        code: c.region,
        name: nameOf.get(c.region) || c.region,
        cells: 0, explored: 0, special: 0, specialExplored: 0, plain: 0, plainExplored: 0,
      })
    }
    const row = rows.get(c.region)
    row.cells += 1
    if (c.explored) row.explored += 1
    if (c.special) {
      row.special += 1
      if (c.explored) row.specialExplored += 1
    } else {
      row.plain += 1
      if (c.explored) row.plainExplored += 1
    }
    if (c.special) {
      if (c.explored) specialExplored.push({ code: c.code, region: c.region, name: c.name || '' })
      else specialUnexplored.push({ code: c.code, region: c.region })
    }
    if (c.noted) {
      if (c.explored) notes.push({ code: c.code, region: c.region, name: c.name || '', note: c.note || '' })
      else hiddenNotes += 1
    }
  }

  const regionRows = [...rows.values()]
    .sort((a, b) => (regionIndex.get(a.code) ?? 999) - (regionIndex.get(b.code) ?? 999))

  const totalCells = regionRows.reduce((n, r) => n + r.cells, 0)
  const explored = regionRows.reduce((n, r) => n + r.explored, 0)
  const special = regionRows.reduce((n, r) => n + r.special, 0)
  const specialDone = regionRows.reduce((n, r) => n + r.specialExplored, 0)
  const plain = totalCells - special
  const plainDone = explored - specialDone
  const noted = notes.length + hiddenNotes

  specialExplored.sort((a, b) => compareCode(a, b, regionIndex))
  specialUnexplored.sort((a, b) => compareCode(a, b, regionIndex))
  notes.sort((a, b) => compareCode(a, b, regionIndex))

  return {
    generatedAt: meta.generatedAt || '',
    viewLabel: meta.viewLabel || '',
    totals: {
      cells: totalCells,
      explored,
      unexplored: totalCells - explored,
      plain,
      plainExplored: plainDone,
      special,
      specialExplored: specialDone,
      noted,
      hiddenNotes,
    },
    regions: regionRows,
    specialExplored,
    specialUnexplored,
    notes,
  }
}

// 同一区域的清单合并成一行，20 个区域最多 20 条，比逐格一行短得多
function groupLines(items, regionList) {
  const order = new Map((regionList || []).map((r, i) => [r.code, i]))
  const byRegion = new Map()
  for (const item of items) {
    if (!byRegion.has(item.region)) byRegion.set(item.region, [])
    byRegion.get(item.region).push(item)
  }
  return [...byRegion.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
    .map(([region, list]) => {
      const name = regionList.find((r) => r.code === region)?.name || region
      return { region, name, list }
    })
}

export function reportToXml(report, meta = {}) {
  const r = report
  const out = []
  out.push(`<p>最后同步：${esc(r.generatedAt)}　视图：${esc(r.viewLabel)}</p>`)
  out.push('<!--MAP_IMAGE-->')

  out.push('<h2>探索总览</h2>')
  out.push(`<p>已探索 <b>${r.totals.explored}</b> / ${r.totals.cells} 格（${pct(r.totals.explored, r.totals.cells)}%），待探索 ${r.totals.unexplored} 格。</p>`)
  out.push(`<p>普通格 ${r.totals.plainExplored} / ${r.totals.plain}；特殊格 ${r.totals.specialExplored} / ${r.totals.special}。</p>`)
  if (r.totals.noted) {
    const hidden = r.totals.hiddenNotes
    out.push(`<p>有备注的格 ${r.totals.noted} 个${hidden ? `，其中未探索 ${hidden} 个（玩家版不展示其备注）` : ''}。</p>`)
  } else {
    out.push('<p>暂无备注。</p>')
  }

  out.push('<h2>各区域探索进度</h2>')
  const head = ['区域', '可探索格', '已探索', '进度', '普通格（已探/总）', '特殊格（已探/总）']
  out.push('<table><thead><tr>' + head.map((h) => `<th><p>${esc(h)}</p></th>`).join('') + '</tr></thead><tbody>')
  for (const row of r.regions) {
    out.push('<tr>'
      + `<td><p>${esc(row.name)}</p></td>`
      + `<td><p>${row.cells}</p></td>`
      + `<td><p>${row.explored}</p></td>`
      + `<td><p>${pct(row.explored, row.cells)}%</p></td>`
      + `<td><p>${row.plainExplored} / ${row.plain}</p></td>`
      + `<td><p>${row.specialExplored} / ${row.special}</p></td>`
      + '</tr>')
  }
  out.push('</tbody></table>')

  if (r.totals.special) {
    out.push('<h2>特殊格（编号地点）</h2>')
    out.push(`<p><b>已探索 ${r.totals.specialExplored} 个</b></p>`)
    if (r.specialExplored.length) {
      out.push('<ul>' + groupLines(r.specialExplored, meta.regions).map((g) => (
        `<li>${esc(g.name)}：${g.list.map((x) => `${esc(x.code)}${x.name ? ` ${esc(x.name)}` : ''}`).join('、')}</li>`
      )).join('') + '</ul>')
    } else {
      out.push('<p>暂无已探索的特殊格。</p>')
    }
    out.push(`<p><b>未探索 ${r.totals.special - r.totals.specialExplored} 个</b>（只列编号）</p>`)
    if (r.specialUnexplored.length) {
      out.push('<ul>' + groupLines(r.specialUnexplored, meta.regions).map((g) => (
        `<li>${esc(g.name)}：${g.list.map((x) => esc(x.code)).join('、')}</li>`
      )).join('') + '</ul>')
    }
  }

  out.push('<h2>备注</h2>')
  if (r.notes.length) {
    out.push('<table><thead><tr>'
      + ['编号', '区域', '地点', '备注'].map((h) => `<th><p>${esc(h)}</p></th>`).join('')
      + '</tr></thead><tbody>')
    for (const n of r.notes) {
      out.push('<tr>'
        + `<td><p>${esc(n.code)}</p></td>`
        + `<td><p>${esc(meta.regions?.find((x) => x.code === n.region)?.name || n.region)}</p></td>`
        + `<td><p>${esc(n.name || '—')}</p></td>`
        + `<td><p>${esc(n.note)}</p></td>`
        + '</tr>')
    }
    out.push('</tbody></table>')
  } else {
    out.push('<p>暂无已探索格的备注。</p>')
  }
  if (r.totals.hiddenNotes) {
    out.push(`<p>另有 ${r.totals.hiddenNotes} 个未探索格带有备注，玩家版不展示。</p>`)
  }

  return out.join('')
}
