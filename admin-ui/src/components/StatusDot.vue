<script setup>
import { computed } from 'vue';

const props = defineProps({
  statusCode: { type: Number, required: true },
});

const dotClass = computed(() => {
  if (props.statusCode < 300) return 'dot-green';
  if (props.statusCode < 500) return 'dot-amber';
  return 'dot-red';
});
</script>

<template>
  <span class="status-pill">
    <span class="dot" :class="dotClass"></span>{{ statusCode }}
  </span>
</template>
