<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

const props = defineProps({
  enabled: { type: Boolean, default: true },
  min: { type: Number, default: 4 },
})

const items = ref([])
const active = ref('')
const open = ref(typeof window === 'undefined' ? true : window.innerWidth >= 1400)
const show = computed(() => props.enabled && items.value.length >= props.min)

let mainEl = null
let observer = null
let raf = 0
let seq = 0

function build() {
  if (!props.enabled) { items.value = []; return }
  mainEl = document.querySelector('main')
  if (!mainEl) { items.value = []; return }
  const heads = [...mainEl.querySelectorAll('h2')].filter((el) => {
    if (el.closest('nav')) return false
    // v-show 隐藏的面板不列；<details> 内的标题仍列出，点击时先展开
    if (el.offsetParent === null && !el.closest('details')) return false
    return true
  })
  items.value = heads.map((el) => {
    if (!el.id) el.id = `page-toc-${Date.now().toString(36)}-${(seq++)}`
    // 去掉说明点、灰色副标题与标签，只留章节名
    const clone = el.cloneNode(true)
    clone.querySelectorAll('.muted, .hint, button, .tag').forEach((n) => n.remove())
    const text = (clone.textContent || el.textContent || '').replace(/\s+/g, ' ').trim()
    return { id: el.id, text: text.length > 30 ? text.slice(0, 30) + '…' : text }
  })
  nextTick(updateActive)
}

function updateActive() {
  if (!show.value) return
  const line = 120
  let cur = ''
  for (const it of items.value) {
    const el = document.getElementById(it.id)
    if (el && el.getBoundingClientRect().top <= line) cur = it.id
  }
  active.value = cur
}

function go(it) {
  const el = document.getElementById(it.id)
  if (!el) return
  const d = el.closest('details')
  if (d && !d.open) d.open = true
  requestAnimationFrame(() => {
    const top = el.getBoundingClientRect().top + window.scrollY - 100
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    active.value = it.id
  })
}

function scheduleBuild() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(build)
}

watch(() => props.enabled, () => nextTick(build))

onMounted(() => {
  build()
  mainEl = document.querySelector('main')
  if (mainEl) {
    observer = new MutationObserver(scheduleBuild)
    observer.observe(mainEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    })
  }
  window.addEventListener('scroll', updateActive, { passive: true })
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  cancelAnimationFrame(raf)
  window.removeEventListener('scroll', updateActive)
})
</script>

<template>
  <button v-if="show && !open" class="tocTab" title="打开本页目录" @click="open = true">目录</button>
  <aside v-else-if="show" class="pageToc" aria-label="本页目录">
    <div class="tocHead">
      <b>本页目录</b>
      <button class="act tocX" title="收起" @click="open = false">收起</button>
    </div>
    <nav>
      <button
        v-for="it in items"
        :key="it.id"
        class="tocItem"
        :class="{ on: active === it.id }"
        @click="go(it)"
      >{{ it.text }}</button>
    </nav>
  </aside>
</template>

<style scoped>
.pageToc {
  position: fixed;
  left: 14px;
  top: 104px;
  z-index: 20;
  width: 190px;
  max-height: calc(100vh - 130px);
  overflow: auto;
  padding: 9px 9px 10px;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 4px;
  box-shadow: 0 6px 18px rgba(40, 30, 10, 0.08);
  font-size: 12px;
}
.tocHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding: 0 2px; }
.tocHead b { font-size: 13px; letter-spacing: 0.04em; }
.tocX { padding: 2px 7px !important; font-size: 11px !important; }
.tocItem {
  display: block;
  width: 100%;
  text-align: left;
  appearance: none;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0 3px 3px 0;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  line-height: 1.35;
  padding: 5px 7px;
  cursor: pointer;
}
.tocItem:hover { color: var(--ink); background: var(--cover-old); }
.tocItem.on { color: var(--ochre); border-left-color: var(--ochre); background: var(--wash-ochre); font-weight: 600; }
.tocTab {
  position: fixed;
  left: 0;
  top: 150px;
  z-index: 20;
  writing-mode: vertical-rl;
  padding: 10px 6px;
  border: 1px solid var(--rule);
  border-left: 0;
  border-radius: 0 4px 4px 0;
  background: var(--paper-2);
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.tocTab:hover { color: var(--ochre); border-color: var(--ochre-soft); }
@media (max-width: 1399px) {
  .pageToc { width: 176px; }
}
</style>
