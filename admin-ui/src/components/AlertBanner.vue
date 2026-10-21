<script setup>
defineProps({
  type: { type: String, default: 'info' }, // success | error | info | warn | busy
  title: { type: String, default: '' },
  dismissible: { type: Boolean, default: true },
});
const emit = defineEmits(['close']);

const ICONS = { success: '✓', error: '✕', info: 'i', warn: '!' };
</script>

<template>
  <div class="alert" :class="`alert-${type}`" :role="type === 'error' ? 'alert' : 'status'" aria-live="polite">
    <span v-if="type === 'busy'" class="spinner" aria-hidden="true"></span>
    <span v-else class="alert-icon" aria-hidden="true">{{ ICONS[type] }}</span>
    <div class="alert-body">
      <strong v-if="title" class="alert-title">{{ title }}</strong>
      <div class="alert-text"><slot /></div>
    </div>
    <button v-if="dismissible && type !== 'busy'" class="close-x" title="Dismiss" @click="emit('close')">✕</button>
  </div>
</template>
