<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { state } from '../store.js'
import { mouseDC, luckDie, MOUSE_TIERS } from '../rules.js'
import { activeQuick, nextQuickId } from '../checkBus.js'
import CheckQuickRef from './CheckQuickRef.vue'

const props = defineProps({
  dice: { type: [String, Number], default: '' },
  tier: { type: String, default: '' },
  dc: { type: [String, Number], default: 0 },
  flat: { type: Boolean, default: false },
  label: { type: String, default: '' },
  width: { type: String, default: '80px' },
  disabled: { type: Boolean, default: false },
  bare: { type: Boolean, default: false },
  noDc: { type: Boolean, default: false },
})
const emit = defineEmits(['update:dice', 'update:tier'])

const mouse = computed(() => state.ruleset === 'mouse')
const dcNum = computed(() => Number(props.dc) || 0)
const tiers = computed(() => (props.flat ? ['失败', '成功'] : MOUSE_TIERS))
const labelText = computed(() => {
  if (mouse.value) return props.flat ? '鼠鼠平值检定' : '鼠鼠检定结果'
  return props.label || (props.flat ? '平值检定 d20' : '桌上掷出的 d20')
})

// 每个检定位置自带一个速查面板；同一时间只展开一个
const id = nextQuickId()
const open = computed(() => activeQuick.value === id)
const root = ref(null)
const side = ref('right')
function toggleQuick() {
  if (open.value) { activeQuick.value = 0; return }
  const r = root.value && root.value.getBoundingClientRect()
  if (r) side.value = (window.innerWidth - r.right) > 260 ? 'right' : 'left'
  activeQuick.value = id
}
onBeforeUnmount(() => {
  if (open.value) activeQuick.value = 0
})
</script>

<template>
  <div ref="root" :class="[bare ? 'mfield' : 'field', 'checkRoll']">
    <label>{{ labelText }}</label>
    <div v-if="!mouse" class="rollLine">
      <input
        type="number"
        min="1"
        max="20"
        :value="dice"
        :disabled="disabled"
        :style="{ width }"
        @input="emit('update:dice', $event.target.value)"
      />
    </div>
    <div v-else class="rollLine">
      <div class="mroll">
        <span v-if="!noDc" class="mdc">{{ flat ? `幸运骰 ${luckDie(dcNum)}-in-6` : `2d6 DC ${mouseDC(dcNum, state.mouseBase)}` }}</span>
        <button
          v-for="t in tiers"
          :key="t"
          class="act"
          :class="{ on: tier === t }"
          :disabled="disabled"
          @click="emit('update:tier', t)"
        >{{ t }}</button>
      </div>
      <button class="act quickBtn" :class="{ on: open }" title="换算与速查表" @click="toggleQuick">速查</button>
      <CheckQuickRef v-if="open" :dc="dcNum" :flat="flat" :side="side" @close="activeQuick = 0" />
    </div>
  </div>
</template>
