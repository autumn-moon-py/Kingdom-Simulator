<script setup>
import { ref, computed } from 'vue'
import { state, attrMod, pushLog, logCalc, skillFeatBonus, kingdomSkillMod, hasFeat, leaderStatusBonus, isMouse, kingdomControlDC } from '../store.js'
import { mouseTierOf, mouseDC } from '../rules.js'
import roles from '../data/roles.json'
import skills from '../data/skills.json'
import feats from '../data/feats.json'
import levels from '../data/levels.json'
import CheckRoll from './CheckRoll.vue'

const tab = ref('check')
const q = ref('')
const rank = ref('受训')
const skillList = skills.skills || []

const RANKS = ['未受训', '受训', '专家', '大师', '传奇']

const controlDC = computed(() => kingdomControlDC())

// 熟练加值（原文：未受训 +0；受训 等级+2；专家 +4；大师 +6；传奇 +8）
function profBonus(name) {
  const r = state.proficiencies[name] || '未受训'
  const table = { 未受训: 0, 受训: 2, 专家: 4, 大师: 6, 传奇: 8 }
  return r === '未受训' ? 0 : state.level + table[r]
}
// 状态加值：仅「已任命」的领导角色按其关键属性提供（同一属性不叠加；8 级 +2、16 级 +3）
function statusBonus(attr) {
  return leaderStatusBonus(attr)
}
function skillMod(s) {
  // 统一口径：属性+熟练+领导状态+专长 − 动荡状态减值 − 对应祸患物品减值
  return kingdomSkillMod(s.name, s.attribute)
}
const sign = (n) => (n >= 0 ? '+' : '') + n

// --- 结算（骰子由玩家在桌上掷，这里只输入结果）---
const rollSkill = ref('')
const rollDC = ref('')
const rollInput = ref('')
const rollTier = ref('')
const rollOut = ref(null)
const rollErr = ref('')
const targetDC = computed(() => (rollDC.value === '' ? controlDC.value : Number(rollDC.value)))
function doRoll() {
  const s = skillList.find((x) => x.name === rollSkill.value)
  if (!s) return
  const mouse = isMouse()
  const dc = targetDC.value
  if (mouse) {
    const mt = mouseTierOf(rollTier.value)
    if (mt < 0) { rollErr.value = '请先选择鼠鼠检定结果。'; return }
    rollErr.value = ''
    const out = ['大失败', '失败', '成功', '大成功'][mt]
    rollOut.value = { mouse: true, dc, out }
    logCalc(`技能检定·${s.name}`, {
      rule: '鼠鼠模式：桌上掷 2d6 + 背景/优势，对抗按《检定转换》换算后的 DC；界面只录结果档。',
      input: { 技能: s.name, PF控制DC: dc, 换算2d6DC: mouseDC(dc, state.mouseBase), 鼠鼠结果: rollTier.value },
      formula: '2d6 + 背景加值 ≥ 2d6 DC；双 1 大失败、双 6 大成功',
      output: out,
    })
    pushLog(`${s.name}：2d6 DC ${mouseDC(dc, state.mouseBase)} → ${out}`)
    rollTier.value = ''
    return
  }
  const r = Number(rollInput.value)
  if (!r || r < 1 || r > 20) { rollErr.value = '请填入你的 d20 结果（1–20）。'; return }
  rollErr.value = ''
  const m = skillMod(s)
  const total = r + m
  let out = '失败'
  if (total >= dc + 10) out = '大成功'
  else if (total >= dc) out = '成功'
  else if (total <= dc - 10) out = '大失败'
  rollOut.value = { r, m, total, dc, out }
  logCalc(`技能检定·${s.name}`, {
    rule: '检定结果 = d20 + 技能调整值；技能调整值 = 关键属性调整值 + 熟练加值 + 状态加值。结果 ≥ DC 为成功，超出 DC 达 10 为大成功，低于 DC 达 10 为大失败（王国规则 进行王国技能检定）。d20 由玩家在桌上掷出后录入。',
    input: {
      技能: s.name, 关键属性: s.attribute, 属性值: state.attributes[s.attribute],
      熟练度: state.proficiencies[s.name] || '未受训', 王国等级: state.level, DC: dc, 玩家掷出的d20: r,
    },
    formula: 'd20 + (属性调整值 + 熟练加值 + 状态加值 + 专长加值)',
    steps: {
      技能调整值合计: m,
      检定结果: total,
      '与 DC 之差': total - dc,
    },
    output: out,
  })
  pushLog(`${s.name}检定：d20 ${r} ${sign(m)} ＝ ${total} 对抗 DC ${dc} → ${out}`)
}

function takeTen() {
  const s = skillList.find((x) => x.name === rollSkill.value)
  if (!s) return
  if (!hasFeat('王国保障')) { rollErr.value = '需要先选取王国专长「王国保障」才能使用（前置：至少 3 项技能受训）。'; return }
  rollErr.value = ''
  const prof = profBonus(s.name)
  const total = 10 + prof
  const dc = targetDC.value
  const out = total >= dc ? '成功' : '失败'
  rollOut.value = { r: '取10', m: prof, total, dc, out }
  logCalc(`技能检定·${s.name}（王国保障·取 10）`, {
    rule: '王国保障（专长）：每个王国回合一次，可放弃掷骰，改为取结果等于 10 + 你的熟练加值，不应用任何其他加值、减值或调整值（王国规则 王国专长 王国保障）',
    input: { 技能: s.name, 熟练度: state.proficiencies[s.name] || '未受训', 熟练加值: prof, DC: dc },
    formula: '检定结果 = 10 + 熟练加值（不加属性调整值、状态加值与专长加值）',
    output: { 检定结果: total, 结果: out },
  })
  pushLog(`${s.name}：王国保障取 10 + ${prof} ＝ ${total} 对抗 DC ${dc} → ${out}`)
}

const filtered = computed(() => {
  const k = q.value.trim()
  if (!k) return skillList
  return skillList
    .map((x) => ({ ...x, activities: (x.activities || []).filter((a) => (a.name + a.effect + a.dc).includes(k)) }))
    .filter((x) => x.name.includes(k) || x.activities.length)
})
</script>

<template>
  <div class="panel">
    <h2>参考</h2>
    <nav class="tabs">
      <button :class="{ active: tab === 'check' }" @click="tab = 'check'">技能检定</button>
      <button :class="{ active: tab === 'skills' }" @click="tab = 'skills'">技能活动</button>
      <button :class="{ active: tab === 'roles' }" @click="tab = 'roles'">领导角色</button>
      <button :class="{ active: tab === 'levels' }" @click="tab = 'levels'">等级与专长</button>
    </nav>
  </div>

  <!-- 技能检定 -->
  <div class="panel" v-if="tab === 'check'">
    <template v-if="state.ruleset !== 'mouse'">
      <h2>技能调整值</h2>
      <p class="muted">
        技能调整值 ＝ 关键属性调整值 ＋ 熟练加值 ＋ 状态加值。熟练加值：未受训 +0、受训 等级+2、专家 +4、大师 +6、传奇 +8（当前王国 {{ state.level }} 级）。状态加值来自已授职的领导角色，同一属性不叠加；资深领导让它在 8 级升到 +2、16 级升到 +3。
      </p>
      <table>
        <thead><tr><th>技能</th><th style="width: 64px">关键属性</th><th style="width: 70px">属性调整值</th><th style="width: 110px">熟练度</th><th style="width: 80px">熟练加值</th><th style="width: 80px">状态加值</th><th style="width: 80px">专长加值</th><th style="width: 90px">技能调整值</th></tr></thead>
        <tbody>
          <tr v-for="s in skillList" :key="s.name">
            <td>{{ s.name }}</td>
            <td class="muted">{{ s.attribute }}</td>
            <td class="num">{{ sign(attrMod(state.attributes[s.attribute] || 10)) }}</td>
            <td>
              <select v-model="state.proficiencies[s.name]">
                <option value="">未受训</option>
                <option v-for="r in RANKS.slice(1)" :key="r">{{ r }}</option>
              </select>
            </td>
            <td class="num">{{ sign(profBonus(s.name)) }}</td>
            <td class="num">{{ sign(statusBonus(s.attribute)) }}</td>
            <td class="num">{{ sign(skillFeatBonus(s.name, s.attribute)) }}</td>
            <td class="num"><b>{{ sign(skillMod(s)) }}</b></td>
          </tr>
        </tbody>
      </table>
    </template>
    <p class="muted" v-else>
      鼠鼠模式：桌上掷 2d6 + 背景/优势，对抗按《检定转换》换算后的 DC；双 1 大失败、双 6 大成功。界面只记结果档，PF 的技能调整值不参与判定。
    </p>

    <h2 style="margin-top: 24px">掷一次检定</h2>
    <div class="row">
      <div class="field">
        <label>技能</label>
        <select v-model="rollSkill">
          <option value="">选择技能</option>
          <option v-for="s in skillList" :key="s.name">{{ s.name }}</option>
        </select>
      </div>
      <div class="field">
        <label>DC（留空用控制 DC {{ controlDC }}）</label>
        <input type="number" v-model="rollDC" style="width: 110px" />
      </div>
      <CheckRoll v-model:dice="rollInput" v-model:tier="rollTier" :dc="targetDC" label="桌上掷出的 d20" width="100px" />
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="!rollSkill" @click="doRoll">结算</button></div>
      <div class="field" v-if="state.ruleset !== 'mouse'"><label>&nbsp;</label><button class="act" :disabled="!rollSkill || !hasFeat('王国保障')" @click="takeTen">王国保障：取 10＋熟练</button></div>
    </div>
    <p class="muted" v-if="rollErr">{{ rollErr }}</p>
    <p v-if="rollOut" style="margin-top: 10px">
      <template v-if="rollOut.mouse">2d6 DC <b class="num">{{ mouseDC(rollOut.dc, state.mouseBase) }}</b> → <b>{{ rollOut.out }}</b></template>
      <template v-else>d20 <b class="num">{{ rollOut.r }}</b> {{ sign(rollOut.m) }} ＝ <b class="num">{{ rollOut.total }}</b>，对抗 DC {{ rollOut.dc }} → <b>{{ rollOut.out }}</b>
        <span class="muted">　（超出 DC 达 10 为大成功，低于 DC 达 10 为大失败）</span></template>
    </p>
  </div>

  <!-- 技能活动 -->
  <div class="panel" v-if="tab === 'skills'">
    <div class="field" style="margin-bottom: 14px">
      <label>搜索技能或活动</label>
      <input v-model="q" placeholder="如 征税、占卜、贸易" style="width: 220px" />
    </div>
    <div v-for="s in filtered" :key="s.name" style="margin-bottom: 20px">
      <h2>{{ s.name }}<span class="muted"> · {{ s.attribute }} · 调整值 {{ sign(skillMod(s)) }}</span></h2>
      <div v-for="a in s.activities" :key="a.name" style="margin-bottom: 10px">
        <p style="margin-bottom: 2px"><b>{{ a.name }}</b> <span class="tag">{{ a.dc }}</span></p>
        <p class="prose" style="margin: 0">{{ a.effect }}</p>
      </div>
    </div>
  </div>

  <div class="panel" v-if="tab === 'roles'">
    <div v-for="r in roles" :key="r.name" style="margin-bottom: 16px">
      <h2>{{ r.name }}<span class="muted"> · {{ r.attribute }} · {{ state.leaders[r.name] || '空缺' }}</span></h2>
      <p class="prose" style="margin-bottom: 4px">{{ r.text }}</p>
      <p class="prose muted" v-if="r.vacancy" style="margin: 0">空缺：{{ r.vacancy }}</p>
    </div>
  </div>

  <div class="panel" v-if="tab === 'levels'">
    <table>
      <thead><tr><th style="width: 60px">等级</th><th style="width: 80px">控制 DC</th><th v-if="state.ruleset === 'mouse'" style="width: 80px">2d6 DC</th><th style="width: 160px">进阶</th><th>说明</th></tr></thead>
      <tbody>
        <tr v-for="l in levels" :key="l.level" :class="{ cur: l.level === state.level }">
          <td class="num">{{ l.level }}</td>
          <td class="num">{{ l.controlDC }}</td>
          <td v-if="state.ruleset === 'mouse'" class="num">{{ mouseDC(l.controlDC, state.mouseBase) }}</td>
          <td>{{ l.feature }}</td>
          <td>{{ l.text }}</td>
        </tr>
      </tbody>
    </table>
    <h2 style="margin-top: 24px">王国专长</h2>
    <div v-for="f in feats" :key="f.name" style="margin-bottom: 14px">
      <p style="margin-bottom: 2px"><b>{{ f.name }}</b> <span class="tag">专长 {{ f.level }}</span></p>
      <p class="prose" style="margin: 0">{{ f.text }}</p>
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; gap: 20px; margin-bottom: 4px; }
.tabs button { appearance: none; border: 0; background: transparent; padding: 0 0 8px; font: inherit; font-size: 14px; color: var(--ink-2); cursor: pointer; border-bottom: 2px solid transparent; }
.tabs button.active { color: var(--ink); font-weight: 600; border-bottom-color: var(--ochre); }
.panel h2 { display: flex; justify-content: space-between; }
.num { font-variant-numeric: tabular-nums; padding-top: 7px; }
td.num { padding-top: 9px; }
tr.cur td { background: var(--cover-old); }
select { min-width: 96px; }
</style>
