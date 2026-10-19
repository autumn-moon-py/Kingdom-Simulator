<script setup>
import { ref, computed } from 'vue'
import { state, ATTRS, attrMod, pushLog, logCalc, kingdomSkillMod, leaderStatusBonus, createTown, claimedCount } from '../store.js'
import founding from '../data/founding.json'
import roles from '../data/roles.json'
import skillsData from '../data/skills.json'

const skills = skillsData.skills || []

const emit = defineEmits(['go'])

// 建国向导：把《王国规则》「建立王国」的流程拆成一屏一步
// 每一步只写一句要做什么；选项自己带着规则书里的说明，不另设规则折叠区
// 编号按向导顺序从 1 起（规则书的第 1 步是给 GM 的桌边提示，不产生数值，不占一格）
const STEPS = [
  { n: 1, name: '选择特许状', intro: '王国的属性长短板由特许状决定，选定后不再更改。' },
  { n: 2, name: '选择腹地', intro: '新王国只占一个六角格，首都就建在这里。地形决定给哪项属性提升。' },
  { n: 3, name: '选择政体', intro: '政体给出三次属性提升、两项受训技能和一个奖励专长，选定后不可更改。' },
  { n: 4, name: '确定属性值', intro: '再挑两项属性各提升一次，汇总成最终属性值。' },
  { n: 5, name: '记录王国细节', intro: '给王国取个名字，其余初始数据已经按规则填好了。' },
  { n: 6, name: '选择领导者', intro: '八个领导角色各指派一人，再从里面挑四个任命。' },
  { n: 7, name: '第一座村庄', intro: '首都建在腹地那一格上，它就是王国的第一座聚落。' },
  { n: 8, name: '计算技能调整值', intro: '这是建好之后每项技能的调整值，确认无误就可以收尾。' },
]

const STEP_MIN = 1
const STEP_MAX = 8
const step = computed({
  get: () => {
    const v = Number(state.founding.step)
    return v >= STEP_MIN && v <= STEP_MAX ? v : STEP_MIN
  },
  set: (v) => { state.founding.step = v },
})
const cur = computed(() => STEPS.find((s) => s.n === step.value) || STEPS[0])

// ---- 第 2~5 步的基础选择 ----
const charter = ref(state.charter || '')
const heartland = ref(state.heartland || '')
const gov = ref(state.government || '')
const C = computed(() => founding.charters.find((c) => c.name === charter.value))
const H = computed(() => founding.heartlands.find((h) => h.name === heartland.value))
const G = computed(() => founding.governments.find((g) => g.name === gov.value))
// 自由提升不能落在该选项已经特别影响的属性上。规则原文举的例子：征服特别提升忠诚、
// 给文化施加缺陷，所以自由提升只能用在经济或稳定；政体的自由提升同样排除它已提升的那两项
const freeOf = (boosts, penalty) => ATTRS.filter((a) => ![...boosts, penalty].filter(Boolean).includes(a))
const charterFreeOptions = computed(() => (C.value ? freeOf(C.value.boosts, C.value.penalty) : ATTRS))
const govFreeOptions = computed(() => (G.value ? freeOf(G.value.boosts, '') : ATTRS))

// 效果行用具体属性名和数值写出来，不用「各 +2」这种空指代
function charterEffect(c) {
  const bits = []
  if (c.boosts.length) bits.push(`${c.boosts.join('、')} +2`)
  bits.push(`${freeOf(c.boosts, c.penalty).join('、')} 任选一项 +2`)
  if (c.penalty) bits.push(`${c.penalty} −2`)
  return bits.join('；')
}
function govEffect(g) {
  return [`${g.boosts.join('、')} +2`, `${freeOf(g.boosts, '').join('、')} 任选一项 +2`, `受训 ${g.skills.join('、')}`, `专长 ${g.feat}`].join('；')
}
// 换选项时，把已经落在非法属性上的自由提升清掉
function pickCharter(name) {
  charter.value = name
  const c = founding.charters.find((x) => x.name === name)
  if (c && state.founding.charterFree && !freeOf(c.boosts, c.penalty).includes(state.founding.charterFree)) state.founding.charterFree = ''
}
function pickGov(name) {
  gov.value = name
  const g = founding.governments.find((x) => x.name === name)
  if (g && state.founding.govFree && !freeOf(g.boosts, '').includes(state.founding.govFree)) state.founding.govFree = ''
}

// ---- 属性值汇总（向导第 4 步） ----
const tally = computed(() => {
  const t = Object.fromEntries(ATTRS.map((a) => [a, 0]))
  if (C.value) {
    C.value.boosts.forEach((a) => { t[a] += 1 })
    if (C.value.penalty) t[C.value.penalty] -= 1
    if (state.founding.charterFree) t[state.founding.charterFree] += 1
  }
  if (H.value) t[H.value.boost] += 1
  if (G.value) {
    G.value.boosts.forEach((a) => { t[a] += 1 })
    if (state.founding.govFree) t[state.founding.govFree] += 1
  }
  ;(state.founding.extraBoosts || []).filter(Boolean).forEach((a) => { t[a] += 1 })
  return t
})
const final = computed(() => Object.fromEntries(ATTRS.map((a) => [a, 10 + 2 * tally.value[a]])))
const mod = (v) => (Math.floor((v - 10) / 2) >= 0 ? '+' : '') + Math.floor((v - 10) / 2)

function apply() {
  logCalc('建国·属性值汇总', {
    rule: '王国属性值起始为 10；每次属性提升 +2，每个属性缺陷 −2（王国规则 第 5 步：确定属性值）',
    input: {
      特许状: charter.value || '未选', 特许状自由提升: state.founding.charterFree || '未选',
      腹地: heartland.value || '未选', 政体: gov.value || '未选', 政体自由提升: state.founding.govFree || '未选',
      第5步两次提升: (state.founding.extraBoosts || []).filter(Boolean),
    },
    formula: '最终属性值 = 10 + 2 × (提升次数 − 缺陷次数)',
    steps: Object.fromEntries(ATTRS.map((a) => [`${a} 的提升／缺陷笔数`, tally.value[a]])),
    output: Object.fromEntries(ATTRS.map((a) => [a, { 属性值: final.value[a], 调整值: mod(final.value[a]) }])),
  })
  ATTRS.forEach((a) => { state.attributes[a] = final.value[a] })
  state.charter = charter.value
  state.heartland = heartland.value
  state.government = gov.value
  state.bonusFeat = G.value ? G.value.feat : ''
  syncTrained()
  pushLog(`建国：${charter.value || '未选特许状'} · ${heartland.value || '未选腹地'} · ${gov.value || '未选政体'}`)
}

// ---- 领导者（向导第 6 步） ----
const investedCount = computed(() => (state.invested || []).length)
function isInvested(name) { return (state.invested || []).includes(name) }
function toggleInvest(name) {
  const cur2 = [...(state.invested || [])]
  const i = cur2.indexOf(name)
  if (i >= 0) cur2.splice(i, 1)
  else {
    if (cur2.length >= 4) return          // 最多任命 4 个
    cur2.push(name)
  }
  state.invested = cur2
  logCalc('建国·任命领导角色', {
    rule: '建国第 7 步选出 4 个要任命的领导角色；只有已任命的角色按其关键属性提供状态加值（同一属性不叠加）。',
    input: { 已任命: cur2.join('、') || '（无）' },
    output: Object.fromEntries(ATTRS.map((a) => [`${a} 的状态加值`, leaderStatusBonus(a)])),
  })
}
// 4 项受训技能：不能选政体已给的，也不能重复
function skillOptions(i) {
  const taken = (state.founding.investedSkills || []).filter((x, j) => x && j !== i)
  const govSkills = G.value ? G.value.skills : []
  return skills.map((s) => s.name).filter((n) => !govSkills.includes(n) && !taken.includes(n))
}
function syncTrained() {
  const govSkills = G.value ? G.value.skills : []
  const picked = (state.founding.investedSkills || []).filter(Boolean)
  state.trainedSkills = [...new Set([...govSkills, ...picked])]
  for (const s of state.trainedSkills) {
    if (!state.proficiencies[s] || state.proficiencies[s] === '未受训') state.proficiencies[s] = '受训'
  }
}

// ---- 首都（向导第 7 步） ----
// 首都即 state.towns[0]，别处的「首都」判定都以此为准（宫殿只能建在首都等）
// 首都在建国流程里只建一座：已有首座聚落时按钮不再新建，名称要改就先移除再建
const capitalName = ref('')
const capitalOut = ref('')
const capital = computed(() => (state.towns || [])[0] || null)
function foundCapital() {
  if (capital.value) { capitalOut.value = `首都「${capital.value.name}」已经建立，不会重复创建。`; return }
  const name = capitalName.value.trim() || '首都'
  const hex = state.heartlandHex || ''
  createTown(name, hex)
  // 腹地六角格从建国起就属于王国：顺手占据它，否则规模（以及依赖规模的控制 DC）会停在 0
  if (hex) state.hexClaimed[hex] = true
  capitalOut.value = `已建立首都「${name}」${hex ? `，并占据腹地六角格 ${hex}` : '（第 2 步未填腹地六角格，可去「格子索引」手动占据）'}`
  logCalc('建国·第一座村庄', {
    rule: '第 8 步：王国的第一座村庄即首都，坐落于腹地六角格；建立时可跳过建立聚落流程的第 1、2 步，并作为里程碑奖励获得 40 点王国 XP。',
    input: { 首都: name, 腹地六角格: hex || '未填', 腹地地形: state.heartland || '未选' },
    formula: '里程碑奖励：40 点王国 XP（本模拟器按里程碑管理等级，此条仅作记录）',
    output: { 现有聚落: state.towns.map((t) => t.name).join('、'), 规模: claimedCount() },
  })
  pushLog(`建立首都「${name}」（王国规则 第 8 步）`)
}
// 移除聚落：重复建立或想改名重建时在这里清掉，避免出现删不掉的聚落
function removeTown(i) {
  const t = (state.towns || [])[i]
  if (!t) return
  state.towns.splice(i, 1)
  state.settlements = state.towns.length
  capitalOut.value = `已移除聚落「${t.name}」`
  pushLog(`建国：移除聚落「${t.name}」`)
}

// ---- 技能调整值明细（向导第 8 步） ----
const PROFB = { 未受训: 0, 受训: 2, 专家: 4, 大师: 6, 传奇: 8 }
function parts(s) {
  const rank = state.proficiencies[s.name] || '未受训'
  const prof = rank === '未受训' ? 0 : state.level + PROFB[rank]
  return { attr: attrMod(state.attributes[s.attribute] || 10), prof, status: leaderStatusBonus(s.attribute), total: kingdomSkillMod(s.name, s.attribute) }
}
const sign = (n) => (n >= 0 ? '+' : '') + n

// ---- 进度：只标出「还缺什么」；最后一步是结果页，没有待办 ----
const missingMap = computed(() => ({
  1: !charter.value || (!!C.value && !state.founding.charterFree),
  2: !heartland.value,
  3: !gov.value || (!!G.value && !state.founding.govFree),
  4: (() => {
    const b = (state.founding.extraBoosts || []).filter(Boolean)
    return b.length !== 2 || new Set(b).size !== 2
  })(),
  5: !String(state.name || '').trim(),
  6: !roles.every((r) => state.leaders[r.name]) || investedCount.value !== 4 || (state.founding.investedSkills || []).filter(Boolean).length !== 4,
  7: (state.towns || []).length === 0,
}))
const missingCount = computed(() => Object.values(missingMap.value).filter(Boolean).length)
// 第 6 步差哪几项直接写出来，别让人对着虚线猜
const missing6 = computed(() => {
  const gaps = []
  const unassigned = roles.filter((r) => !state.leaders[r.name]).map((r) => r.name)
  if (unassigned.length) gaps.push(`未指派角色：${unassigned.join('、')}`)
  if (investedCount.value !== 4) gaps.push(`已任命 ${investedCount.value} / 4`)
  const picked = (state.founding.investedSkills || []).filter(Boolean).length
  if (picked !== 4) gaps.push(`受训技能已选 ${picked} / 4`)
  return gaps.join('；')
})

function finish() {
  // 可能没点「写入王国卡」就直接走到这里，补写一次，避免属性值没落到王国卡上
  if (ATTRS.some((a) => state.attributes[a] !== final.value[a])) apply()
  state.founded = true
  pushLog(`建国完成：${state.name}（${state.charter || '未选特许状'} · ${state.heartland || '未选腹地'} · ${state.government || '未选政体'}）`)
}
</script>

<template>
  <div class="panel">
    <h2>建立王国<span class="muted" v-if="missingCount">　还有 {{ missingCount }} 步未完成（虚线标记）</span></h2>
    <nav class="steps">
      <button v-for="s in STEPS" :key="s.n" :class="{ active: step === s.n, todo: missingMap[s.n] }" @click="step = s.n">
        <span class="no">{{ s.n }}</span>{{ s.name }}
      </button>
    </nav>
  </div>

  <div class="panel">
    <h2>第 {{ cur.n }} 步 · {{ cur.name }}</h2>
    <p>{{ cur.intro }}</p>

    <!-- 1 特许状 -->
    <div v-if="step === 1">
      <div class="opts">
        <button v-for="c in founding.charters" :key="c.name" class="opt" :class="{ on: charter === c.name }" @click="pickCharter(c.name)">
          <span class="oname">{{ c.name }}</span>
          <span class="omech">{{ charterEffect(c) }}</span>
          <span class="otext">{{ c.text }}</span>
        </button>
      </div>
      <div class="row" style="margin-top: 14px">
        <div class="field">
          <label>自由提升{{ C ? '（' + charterFreeOptions.join('、') + '）' : '' }}</label>
          <select v-model="state.founding.charterFree" :disabled="!C">
            <option value="">未选</option>
            <option v-for="a in charterFreeOptions" :key="a">{{ a }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 2 腹地 -->
    <div v-else-if="step === 2">
      <div class="opts">
        <button v-for="h in founding.heartlands" :key="h.name" class="opt" :class="{ on: heartland === h.name }" @click="heartland = h.name">
          <span class="oname">{{ h.name }}</span>
          <span class="omech">{{ h.boost }} +2</span>
          <span class="otext">{{ h.text }}</span>
        </button>
      </div>
      <div class="row" style="margin-top: 14px">
        <div class="field">
          <label>腹地六角格</label>
          <input v-model="state.heartlandHex" placeholder="例如 GB1" style="width: 130px" />
        </div>
      </div>
    </div>

    <!-- 3 政体 -->
    <div v-else-if="step === 3">
      <div class="opts">
        <button v-for="g in founding.governments" :key="g.name" class="opt" :class="{ on: gov === g.name }" @click="pickGov(g.name)">
          <span class="oname">{{ g.name }}</span>
          <span class="omech">{{ govEffect(g) }}</span>
          <span class="otext">{{ g.text }}</span>
        </button>
      </div>
      <div class="row" style="margin-top: 14px">
        <div class="field">
          <label>自由提升{{ G ? '（' + govFreeOptions.join('、') + '）' : '' }}</label>
          <select v-model="state.founding.govFree" :disabled="!G">
            <option value="">未选</option>
            <option v-for="a in govFreeOptions" :key="a">{{ a }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 4 属性值 -->
    <div v-else-if="step === 4">
      <div class="row">
        <div class="field">
          <label>额外提升一</label>
          <select v-model="state.founding.extraBoosts[0]"><option value="">未选</option><option v-for="a in ATTRS" :key="a">{{ a }}</option></select>
        </div>
        <div class="field">
          <label>额外提升二</label>
          <select v-model="state.founding.extraBoosts[1]"><option value="">未选</option><option v-for="a in ATTRS" :key="a">{{ a }}</option></select>
        </div>
      </div>
      <table style="margin-top: 12px">
        <thead><tr><th>属性</th><th style="width: 100px">提升／缺陷</th><th style="width: 100px">最终属性值</th><th style="width: 80px">调整值</th></tr></thead>
        <tbody>
          <tr v-for="a in ATTRS" :key="a">
            <td>{{ a }}</td>
            <td class="num">{{ tally[a] >= 0 ? '+' : '' }}{{ tally[a] }}</td>
            <td class="num">{{ final[a] }}</td>
            <td class="num">{{ mod(final[a]) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="row" style="margin-top: 12px">
        <div class="field"><label>&nbsp;</label><button class="act" @click="apply">写入王国卡</button></div>
        <div class="field"><label>当前王国属性</label><div class="num muted">{{ ATTRS.map(a => a + ' ' + state.attributes[a]).join('　') }}</div></div>
      </div>
    </div>

    <!-- 5 王国细节 -->
    <div v-else-if="step === 5">
      <div class="row">
        <div class="field"><label>王国名称</label><input v-model="state.name" style="width: 220px" /></div>
      </div>
      <table style="margin-top: 12px">
        <thead><tr><th>初始数据</th><th style="width: 140px">数值</th></tr></thead>
        <tbody>
          <tr><td>王国等级</td><td class="num">1</td></tr>
          <tr><td>王国规模</td><td class="num">1</td></tr>
          <tr><td>资源骰</td><td class="num">d4，共 5 颗</td></tr>
          <tr><td>控制 DC</td><td class="num">14</td></tr>
          <tr><td>消耗</td><td class="num">0</td></tr>
          <tr><td>动荡</td><td class="num">0</td></tr>
          <tr><td>四项祸患</td><td class="num">各 0，阈值各 10</td></tr>
          <tr><td>商品储备</td><td class="num">各 0，每类储存上限 4</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 6 领导者 -->
    <div v-else-if="step === 6">
      <p class="muted" v-if="missing6">{{ missing6 }}</p>
      <div class="row">
        <div class="field" v-for="r in roles" :key="r.name">
          <label>{{ r.name }}<span class="muted"> · {{ r.attribute }}</span></label>
          <input v-model="state.leaders[r.name]" placeholder="未指派" style="width: 130px" />
          <div class="check" style="margin-top: 4px">
            <input :id="'inv-' + r.name" type="checkbox" :checked="isInvested(r.name)" :disabled="!isInvested(r.name) && investedCount >= 4" @change="toggleInvest(r.name)" />
            <label :for="'inv-' + r.name">任命{{ isInvested(r.name) ? '（已任命）' : '' }}</label>
          </div>
        </div>
      </div>
      <p class="muted">已任命 {{ investedCount }} / 4</p>
      <table>
        <thead><tr><th>属性</th><th style="width: 130px">当前状态加值</th><th>来源</th></tr></thead>
        <tbody>
          <tr v-for="a in ATTRS" :key="a">
            <td>{{ a }}</td>
            <td class="num">{{ sign(leaderStatusBonus(a)) }}</td>
            <td class="muted">{{ (state.invested || []).filter(n => (roles.find(r => r.name === n) || {}).attribute === a).join('、') || '（无任命角色）' }}</td>
          </tr>
        </tbody>
      </table>

      <h3 style="margin-top: 18px">受授职的 4 项受训技能</h3>
      <div class="row">
        <div class="field" v-for="i in 4" :key="i">
          <label>受训技能{{ ['一', '二', '三', '四'][i - 1] }}</label>
          <select v-model="state.founding.investedSkills[i - 1]" @change="syncTrained">
            <option value="">未选</option>
            <option v-for="n in skillOptions(i - 1)" :key="n" :value="n">{{ n }}</option>
          </select>
        </div>
      </div>
      <p class="muted">政体已给：{{ G ? G.skills.join('、') : '（第 3 步未选政体）' }}</p>
    </div>

    <!-- 7 第一座村庄 -->
    <div v-else-if="step === 7">
      <div class="row">
        <div class="field"><label>首都名称</label><input v-model="capitalName" placeholder="首都" style="width: 200px" :disabled="!!capital" /></div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="act" :disabled="!!capital" @click="foundCapital">{{ capital ? '首都已建立' : '建立首都' }}</button>
        </div>
      </div>
      <p class="muted">建在腹地六角格 <b>{{ state.heartlandHex || '（第 2 步未填）' }}</b>；里程碑奖励 40 点王国 XP（本模拟器按里程碑管理等级，仅作记录）</p>
      <p class="muted" v-if="capitalOut">{{ capitalOut }}</p>
      <div class="row" v-for="(t, i) in state.towns" :key="t.id" style="margin-top: 8px">
        <div class="field">
          <label>{{ i === 0 ? '首都' : `第 ${i + 1} 座聚落` }}</label>
          <div class="num">{{ t.name }}{{ t.hex ? `　${t.hex}` : '' }}</div>
        </div>
        <div class="field"><label>&nbsp;</label><button class="act" @click="removeTown(i)">移除</button></div>
      </div>
      <div class="row" style="margin-top: 10px">
        <div class="field">
          <label>&nbsp;</label>
          <button class="act" @click="emit('go', 'towns')">去聚落页放置初始建筑</button>
        </div>
      </div>
    </div>

    <!-- 8 技能调整值 -->
    <div v-else>
      <table>
        <thead><tr><th>技能</th><th style="width: 70px">属性</th><th style="width: 90px">属性调整</th><th style="width: 90px">熟练加值</th><th style="width: 90px">状态加值</th><th style="width: 80px">合计</th></tr></thead>
        <tbody>
          <tr v-for="s in skills" :key="s.name">
            <td>{{ s.name }}</td>
            <td class="muted">{{ s.attribute }}</td>
            <td class="num">{{ sign(parts(s).attr) }}</td>
            <td class="num">{{ sign(parts(s).prof) }}</td>
            <td class="num">{{ sign(parts(s).status) }}</td>
            <td class="num"><b>{{ sign(parts(s).total) }}</b></td>
          </tr>
        </tbody>
      </table>
      <p class="muted">熟练加值：未受训 +0、受训 等级+2（当前 {{ state.level }} 级）</p>
      <div class="row" style="margin-top: 12px">
        <div class="field"><label>&nbsp;</label><button class="act" @click="finish" :disabled="state.founded">{{ state.founded ? '已完成建国' : '完成建国' }}</button></div>
        <div class="field" v-if="state.founded"><label>&nbsp;</label><button class="act" @click="emit('go', 'turn')">去「回合」开始第一个王国回合</button></div>
      </div>
    </div>

    <div class="row" style="margin-top: 18px">
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="step <= STEP_MIN" @click="step = step - 1">上一步</button></div>
      <div class="field"><label>&nbsp;</label><button class="act" :disabled="step >= STEP_MAX" @click="step = step + 1">下一步</button></div>
    </div>
  </div>
</template>

<style scoped>
.steps { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.steps button { padding: 6px 12px; border: 1px solid var(--rule); background: var(--paper-2); border-radius: 4px; font-size: 13px; color: var(--ink-2); cursor: pointer; }
.steps button .no { display: inline-block; min-width: 15px; margin-right: 6px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.steps button.todo { border-style: dashed; }
.steps button.todo .no { color: var(--warn); }
.steps button.active { border-color: var(--ochre); color: var(--ink); font-weight: 600; }
.steps button.active .no { color: var(--ochre); }
.opts { display: grid; gap: 8px; }
.opt { display: block; width: 100%; text-align: left; padding: 10px 14px; border: 1px solid var(--rule); background: var(--paper-2); border-radius: 4px; font: inherit; color: inherit; cursor: pointer; }
.opt:hover { border-color: var(--ochre-soft); }
.opt.on { border-color: var(--ochre); background: var(--cover-old); }
.opt .oname { display: block; font-weight: 600; font-size: 14px; }
.opt .omech { display: block; margin-top: 3px; font-size: 13px; font-variant-numeric: tabular-nums; }
.opt .otext { display: block; margin-top: 5px; font-size: 13px; color: var(--ink-2); line-height: 1.65; }
.num { font-variant-numeric: tabular-nums; padding-top: 7px; }
select { min-width: 140px; }
h3 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
</style>
