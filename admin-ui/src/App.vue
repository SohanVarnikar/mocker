<script setup>
import { ref, onMounted } from 'vue';
import { api } from './api.js';

const settings = ref({ mockPort: 4000, adminPort: 4001 });

onMounted(async () => {
  try {
    settings.value = await api.getSettings();
  } catch {
    // admin API not reachable yet; keep defaults
  }
});
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">◆</span> API Mocker</div>
      <nav>
        <router-link to="/" class="nav-item" exact-active-class="active">Endpoints</router-link>
        <router-link to="/entities" class="nav-item" active-class="active">Entities</router-link>
        <router-link to="/logs" class="nav-item" active-class="active">Request Log</router-link>
        <router-link to="/settings" class="nav-item" active-class="active">Import / Export</router-link>
      </nav>
      <div class="sidebar-footer">
        <div class="server-status"><span class="dot dot-green"></span> Mock server :{{ settings.mockPort }}</div>
        <div class="server-status muted"><span class="dot dot-gray"></span> Admin UI :{{ settings.adminPort }}</div>
      </div>
    </aside>

    <main class="content">
      <router-view />
    </main>
  </div>
</template>
