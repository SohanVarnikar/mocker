<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '../api.js';
import MethodBadge from '../components/MethodBadge.vue';
import StatusDot from '../components/StatusDot.vue';

const logs = ref([]);
const search = ref('');
const selected = ref(null);
let pollTimer = null;

async function load() {
  try {
    logs.value = await api.listLogs();
  } catch {
    // admin API not reachable; keep last known logs
  }
}

onMounted(() => {
  load();
  pollTimer = setInterval(load, 3000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return logs.value;
  return logs.value.filter((l) => l.path.toLowerCase().includes(q) || l.method.toLowerCase().includes(q));
});

async function clearLog() {
  if (!confirm('Clear the request log?')) return;
  await api.clearLogs();
  selected.value = null;
  await load();
}

function select(entry) {
  selected.value = entry;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString();
}
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Request Log</h1>
      <p class="subtitle">Recent requests handled by the mock server · click a row for details</p>
    </div>
    <div class="topbar-actions">
      <div class="search-box">
        <span>⌕</span>
        <input type="text" v-model="search" placeholder="Filter by path…" />
      </div>
      <button class="btn btn-danger-ghost" @click="clearLog">Clear Log</button>
    </div>
  </div>

  <div v-if="filtered.length === 0" class="empty-state">
    <p>No requests logged yet.</p>
    <p>Call your mock server from the front-end app to see traffic here.</p>
  </div>

  <table v-else>
    <thead>
      <tr>
        <th>Time</th>
        <th>Method</th>
        <th>Path</th>
        <th>Matched Endpoint</th>
        <th>Scenario</th>
        <th>Status</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="entry in filtered"
        :key="entry.id"
        :class="{ 'row-selected': selected && selected.id === entry.id }"
        style="cursor: pointer"
        @click="select(entry)"
      >
        <td class="mono text-faint">{{ formatTime(entry.timestamp) }}</td>
        <td><MethodBadge :method="entry.method" /></td>
        <td class="path-cell">{{ entry.path }}</td>
        <td class="mono text-muted">{{ entry.endpointLabel || '— unmatched —' }}</td>
        <td class="text-muted">{{ entry.scenarioName || '—' }}</td>
        <td><StatusDot :status-code="entry.statusCode" /></td>
        <td class="mono text-faint">{{ entry.durationMs }}ms</td>
      </tr>
    </tbody>
  </table>

  <div class="drawer-overlay" :class="{ open: selected }" @click="selected = null"></div>
  <div class="drawer" :class="{ open: selected }">
    <template v-if="selected">
      <div class="drawer-header">
        <div>
          <h3 class="mono">{{ selected.method }} {{ selected.path }}</h3>
          <p class="subtitle">{{ selected.endpointLabel || '— unmatched —' }} · scenario: {{ selected.scenarioName || '—' }}</p>
        </div>
        <button class="close-x" @click="selected = null">✕</button>
      </div>
      <StatusDot :status-code="selected.statusCode" />
      <div class="section-label">Request Body</div>
      <pre class="code-block">{{ JSON.stringify(selected.requestBody ?? {}, null, 2) }}</pre>
      <div class="section-label">Response Body</div>
      <pre class="code-block">{{ JSON.stringify(selected.responseBody ?? {}, null, 2) }}</pre>
    </template>
  </div>
</template>
