<script setup>
import { hintText } from '../hintBus.js'

const props = defineProps({ text: { type: String, required: true } })
</script>

<template>
  <button
    type="button"
    class="hint"
    :class="{ open: hintText === props.text }"
    :aria-label="props.text"
    :aria-expanded="hintText === props.text"
    @click.stop="hintText = hintText === props.text ? '' : props.text"
  >?</button>
</template>
