<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import ModalDialog from '../components/ModalDialog.vue';

const props = defineProps({
  name: { type: String, required: true },
});

const entity = ref(null);
const records = ref([]);
const activeTab = ref('table');
const rawJsonText = ref('[]');
const errorMsg = ref('');
const loading = ref(true);

const editingRecord = ref(null);
const editingText = ref('');
const showAddModal = ref(false);
const addText = ref('{}');

async function load() {
  loading.value = true;
  try {
    entity.value = await api.getEntity(props.name);
    records.value = await api.listRecords(props.name);
    rawJsonText.value = JSON.stringify(records.value, null, 2);
  } catch (err) {
    errorMsg.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const idField = computed(() => entity.value?.idField || 'id');

const columns = computed(() => {
  const keys = new Set();
  for (const r of records.value) Object.keys(r).forEach((k) => keys.add(k));
  return [...keys];
});

function nextIdHint() {
  if (!entity.value) return '';
  if (entity.value.idStrategy === 'uuid') return '"<generated-on-save>"';
  const nums = records.value.map((r) => Number(r[idField.value])).filter((n) => Number.isFinite(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

function openEdit(record) {
  editingRecord.value = record;
  editingText.value = JSON.stringify(record, null, 2);
}

async function saveEdit() {
  try {
    const parsed = JSON.parse(editingText.value);
    await api.updateRecord(props.name, editingRecord.value[idField.value], parsed);
    editingRecord.value = null;
    await load();
  } catch (err) {
    alert(`Could not save record: ${err.message}`);
  }
}

async function deleteRecord(record) {
  if (!confirm(`Delete record ${record[idField.value]}?`)) return;
  await api.deleteRecord(props.name, record[idField.value]);
  await load();
}

function openAdd() {
  addText.value = `{\n  "${idField.value}": ${nextIdHint()}\n}`;
  showAddModal.value = true;
}

async function saveAdd() {
  try {
    const parsed = JSON.parse(addText.value);
    await api.addRecord(props.name, parsed);
    showAddModal.value = false;
    await load();
  } catch (err) {
    alert(`Could not add record: ${err.message}`);
  }
}

async function saveRawJson() {
  try {
    const parsed = JSON.parse(rawJsonText.value);
    if (!Array.isArray(parsed)) throw new Error('Root value must be a JSON array');
    await api.replaceRecords(props.name, parsed);
    await load();
  } catch (err) {
    alert(`Could not save: ${err.message}`);
  }
}

async function reseed() {
  if (!confirm('Reset this entity to its seed data? Current records will be replaced.')) return;
  await api.reseedEntity(props.name);
  await load();
}

async function clearAll() {
  if (!confirm('Delete all records for this entity?')) return;
  await api.clearEntity(props.name);
  await load();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(records.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${props.name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <router-link to="/entities" class="back-link">← Back to Entities</router-link>

  <p v-if="errorMsg" class="text-muted" style="color: var(--danger)">{{ errorMsg }}</p>

  <template v-if="!loading && entity">
    <div class="topbar">
      <div>
        <h1 class="mono">{{ entity.name }}</h1>
        <p class="subtitle">
          {{ records.length }} records · id field: <span class="mono">{{ idField }}</span> · store/{{ entity.name }}.json
        </p>
      </div>
      <div class="topbar-actions">
        <button class="btn" @click="exportJson">Export JSON</button>
        <button class="btn btn-danger-ghost" @click="clearAll">Clear All</button>
        <button class="btn" @click="reseed">Reseed</button>
        <button class="btn btn-primary" @click="openAdd">+ Add Record</button>
      </div>
    </div>

    <div class="tabs-wrap">
      <div class="tabs">
        <div class="tab" :class="{ active: activeTab === 'table' }" @click="activeTab = 'table'">Table</div>
        <div class="tab" :class="{ active: activeTab === 'json' }" @click="activeTab = 'json'">Raw JSON</div>
      </div>

      <div v-if="activeTab === 'table'" class="tab-panel active">
        <div v-if="records.length === 0" class="empty-state">
          <p>No records stored yet.</p>
        </div>
        <table v-else>
          <thead>
            <tr>
              <th v-for="col in columns" :key="col">{{ col }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in records" :key="record[idField]">
              <td v-for="col in columns" :key="col" :class="{ mono: col === idField }">{{ record[col] }}</td>
              <td class="icon-btn-row">
                <button class="btn-icon" @click="openEdit(record)">✎</button>
                <button class="btn-icon" @click="deleteRecord(record)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="tab-panel active">
        <textarea rows="18" class="mono" style="width: 100%" v-model="rawJsonText"></textarea>
        <div class="topbar-actions" style="justify-content: flex-end; margin-top: 10px">
          <button class="btn btn-primary" @click="saveRawJson">Save Raw JSON</button>
        </div>
        <p class="footnote">Editing here and saving overwrites store/{{ entity.name }}.json directly.</p>
      </div>
    </div>
  </template>

  <ModalDialog v-if="editingRecord" title="Edit Record" @close="editingRecord = null">
    <textarea rows="10" class="mono" style="width: 100%" v-model="editingText"></textarea>
    <div class="topbar-actions" style="justify-content: flex-end; margin-top: 10px">
      <button class="btn" @click="editingRecord = null">Cancel</button>
      <button class="btn btn-primary" @click="saveEdit">Save</button>
    </div>
  </ModalDialog>

  <ModalDialog v-if="showAddModal" title="Add Record" @close="showAddModal = false">
    <textarea rows="10" class="mono" style="width: 100%" v-model="addText"></textarea>
    <div class="topbar-actions" style="justify-content: flex-end; margin-top: 10px">
      <button class="btn" @click="showAddModal = false">Cancel</button>
      <button class="btn btn-primary" @click="saveAdd">Add</button>
    </div>
  </ModalDialog>
</template>
