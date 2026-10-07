<script setup>
defineProps({
  title: { type: String, default: '' },
});
const emit = defineEmits(['close']);
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-box">
      <div class="drawer-header">
        <h3>{{ title }}</h3>
        <button class="close-x" @click="emit('close')">✕</button>
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-box {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 22px;
  width: 420px;
  max-width: calc(100vw - 40px);
}
</style>
