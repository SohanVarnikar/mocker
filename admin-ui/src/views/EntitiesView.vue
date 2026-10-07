<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import ModalDialog from '../components/ModalDialog.vue';

const router = useRouter();
const entities = ref([]);
const loading = ref(true);
const errorMsg = ref('');
const showCreate = ref(false);
const newEntity = ref({ name: '', idField: 'id', idStrategy: 'increment' });

async function load() {
  loading.value = true;
  try {
    entities.value = await api.listEntities();
  } catch (err) {
    errorMsg.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openEntity(name) {
  router.push({ name: 'entity-detail', params: { name } });
}

function openCreate() {
  newEntity.value = { name: '', idField: 'id', idStrategy: 'increment' };
  showCreate.value = true;
}

async function createEntity() {
  if (!newEntity.value.name.trim()) return;
  const created = await api.createEntity({ ...newEntity.value, seedData: [] });
  entities.value.push({ ...created, recordCount: 0 });
  showCreate.value = false;
}

async function removeEntity(entity) {
  if (!confirm(`Delete entity "${entity.name}" and all its stored data?`)) return;
  await api.deleteEntity(entity.name);
  entities.value = entities.value.filter((e) => e.name !== entity.name);
}
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Entities</h1>
      <p class="subtitle">File-backed data stores shared across linked endpoints</p>
    </div>
    <div class="topbar-actions">
      <button class="btn btn-primary" @click="openCreate">+ New Entity</button>
    </div>
  </div>

  <p v-if="errorMsg" class="text-muted" style="color: var(--danger)">{{ errorMsg }}</p>

  <div v-if="!loading && entities.length === 0" class="empty-state">
    <p>No entities yet.</p>
    <p>Create one to back linked endpoints with persisted mock data.</p>
  </div>

  <table v-else-if="!loading">
    <thead>
      <tr>
        <th>Name</th>
        <th>ID Field</th>
        <th>Records</th>
        <th>Store File</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="entity in entities" :key="entity.name" style="cursor: pointer" @click="openEntity(entity.name)">
        <td class="mono">{{ entity.name }}</td>
        <td class="mono text-muted">{{ entity.idField }}</td>
        <td :class="{ 'text-faint': entity.recordCount === 0 }">{{ entity.recordCount }}</td>
        <td class="mono text-faint">store/{{ entity.name }}.json</td>
        <td class="icon-btn-row" @click.stop>
          <button class="btn-icon" title="View data" @click="openEntity(entity.name)">▤</button>
          <button class="btn-icon" title="Delete" @click="removeEntity(entity)">✕</button>
        </td>
      </tr>
    </tbody>
  </table>

  <ModalDialog v-if="showCreate" title="New Entity" @close="showCreate = false">
    <div class="field">
      <label>Name</label>
      <input type="text" v-model="newEntity.name" placeholder="e.g. products" />
    </div>
    <div class="field-row">
      <div class="field">
        <label>ID Field</label>
        <input type="text" v-model="newEntity.idField" />
      </div>
      <div class="field">
        <label>ID Strategy</label>
        <select v-model="newEntity.idStrategy">
          <option value="increment">Auto-increment number</option>
          <option value="uuid">Generated id (uuid)</option>
        </select>
      </div>
    </div>
    <div class="topbar-actions" style="justify-content: flex-end; margin-top: 8px">
      <button class="btn" @click="showCreate = false">Cancel</button>
      <button class="btn btn-primary" @click="createEntity">Create Entity</button>
    </div>
  </ModalDialog>
</template>
