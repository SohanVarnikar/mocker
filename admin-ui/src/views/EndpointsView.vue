<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import MethodBadge from '../components/MethodBadge.vue';
import StatusDot from '../components/StatusDot.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';

const router = useRouter();
const endpoints = ref([]);
const search = ref('');
const activeTag = ref('All');
const loading = ref(true);
const errorMsg = ref('');

async function load() {
  loading.value = true;
  try {
    endpoints.value = await api.listEndpoints();
  } catch (err) {
    errorMsg.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const tags = computed(() => {
  const counts = new Map();
  for (const ep of endpoints.value) {
    const tag = ep.tag || 'untagged';
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [{ name: 'All', count: endpoints.value.length }, ...[...counts.entries()].map(([name, count]) => ({ name, count }))];
});

const filtered = computed(() => {
  return endpoints.value.filter((ep) => {
    const matchesTag = activeTag.value === 'All' || (ep.tag || 'untagged') === activeTag.value;
    const q = search.value.trim().toLowerCase();
    const matchesSearch = !q || ep.method.toLowerCase().includes(q) || ep.path.toLowerCase().includes(q);
    return matchesTag && matchesSearch;
  });
});

function activeScenario(ep) {
  return ep.scenarios.find((s) => s.id === ep.activeScenarioId) || ep.scenarios[0];
}

function openEndpoint(id) {
  router.push({ name: 'endpoint-edit', params: { id } });
}

async function toggleEnabled(ep) {
  const updated = { ...ep, enabled: !ep.enabled };
  ep.enabled = updated.enabled; // optimistic
  await api.updateEndpoint(ep.id, updated);
}

async function duplicateEndpoint(ep) {
  const copy = { ...ep, id: undefined, path: ep.path, description: `${ep.description} (copy)` };
  const saved = await api.createEndpoint(copy);
  endpoints.value.push(saved);
}

async function removeEndpoint(ep) {
  if (!confirm(`Delete endpoint ${ep.method} ${ep.path}?`)) return;
  await api.deleteEndpoint(ep.id);
  endpoints.value = endpoints.value.filter((e) => e.id !== ep.id);
}
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Endpoints</h1>
      <p class="subtitle">Define and manage mocked API routes</p>
    </div>
    <div class="topbar-actions">
      <div class="search-box">
        <span>⌕</span>
        <input type="text" v-model="search" placeholder="Search method or path…" />
      </div>
      <router-link to="/endpoints/new" class="btn btn-primary">+ New Endpoint</router-link>
    </div>
  </div>

  <p v-if="errorMsg" class="text-muted">Could not load endpoints: {{ errorMsg }}</p>

  <div class="chip-row" v-if="tags.length">
    <span
      v-for="tag in tags"
      :key="tag.name"
      class="chip"
      :class="{ active: activeTag === tag.name }"
      @click="activeTag = tag.name"
    >{{ tag.name }} · {{ tag.count }}</span>
  </div>

  <div v-if="!loading && filtered.length === 0" class="empty-state">
    <p>No endpoints yet.</p>
    <p>Create your first mock endpoint to get started.</p>
  </div>

  <table v-else-if="!loading">
    <thead>
      <tr>
        <th>Method</th>
        <th>Path</th>
        <th>Tag</th>
        <th>Active Scenario</th>
        <th>Entity Link</th>
        <th>Enabled</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="ep in filtered"
        :key="ep.id"
        :class="{ 'row-disabled': !ep.enabled }"
        style="cursor: pointer"
        @click="openEndpoint(ep.id)"
      >
        <td><MethodBadge :method="ep.method" /></td>
        <td class="path-cell">{{ ep.path }}</td>
        <td class="text-muted">{{ ep.tag || '—' }}</td>
        <td>
          <span v-if="activeScenario(ep)" style="display: inline-flex; align-items: center; white-space: nowrap">
            <StatusDot :status-code="activeScenario(ep).statusCode" />
            <span style="margin-left: 4px">{{ activeScenario(ep).name }}</span>
          </span>
          <span v-else class="text-faint">— none —</span>
        </td>
        <td class="mono text-muted">
          <template v-if="ep.entityLink">{{ ep.entityLink.entityName }} <span class="text-faint">({{ ep.entityLink.operation }})</span></template>
          <span v-else class="text-faint">— none —</span>
        </td>
        <td @click.stop>
          <ToggleSwitch :model-value="ep.enabled" @update:model-value="toggleEnabled(ep)" />
        </td>
        <td class="icon-btn-row" @click.stop>
          <button class="btn-icon" title="Duplicate" @click="duplicateEndpoint(ep)">⧉</button>
          <button class="btn-icon" title="Delete" @click="removeEndpoint(ep)">✕</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
