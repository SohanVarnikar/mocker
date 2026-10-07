<script setup>
defineProps({
  method: { type: String, required: true },
});
</script>

<template>
  <span class="badge-method" :class="`m-${method.toLowerCase()}`">{{ method }}</span>
</template>
