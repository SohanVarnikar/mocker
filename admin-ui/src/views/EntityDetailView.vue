<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import ModalDialog from '../components/ModalDialog.vue';
import AlertBanner from '../components/AlertBanner.vue';

const props = defineProps({
  name: { type: String, required: true },
});

const route = useRoute();
const router = useRouter();

// Above this many records the Raw JSON tab asks before loading everything into a textarea.
const RAW_RECORD_LIMIT = 2000;
const PAGE_SIZES = [25, 50, 100, 250];
const ON_DELETE_OPTIONS = [
  { value: 'none', label: 'Keep related records' },
  { value: 'cascade', label: 'Delete related records (cascade)' },
  { value: 'setNull', label: 'Set reference to null' },
  { value: 'restrict', label: 'Block the delete (restrict)' },
];

const entity = ref(null);
const allEntities = ref([]);
const loading = ref(true);
const loadError = ref('');
const status = ref(null);
const activeTab = ref('table');

const page = ref({ total: 0, items: [], columns: [] });
const pageLoading = ref(false);
const search = ref('');
const sortBy = ref('');
const sortDir = ref('asc');
const offset = ref(0);
const limit = ref(50);
const fieldFilter = ref(null); // { field, value } from relation links
let lastQueriedSearch = '';

const rawState = ref('idle'); // idle | loading | tooLarge | loaded
const rawJsonText = ref('');
const rawSaving = ref(false);

const editingRecord = ref(null);
const editingText = ref('');
const showAddModal = ref(false);
const addText = ref('{}');
const modalError = ref('');
const busy = ref(false);
const importInput = ref(null);

const relationsDraft = ref([]);
const relationsSaving = ref(false);

const idField = computed(() => entity.value?.idField || 'id');
const recordCount = computed(() => entity.value?.recordCount ?? 0);
const entityNames = computed(() => allEntities.value.map((e) => e.name));

const outgoingByField = computed(() => {
  const map = new Map();
  for (const rel of entity.value?.relations || []) map.set(rel.field, rel);
  return map;
});

const incomingRelations = computed(() =>
  allEntities.value.flatMap((e) =>
    (e.relations || []).filter((r) => r.entity === props.name).map((r) => ({ child: e.name, ...r })),
  ),
);

const pageEnd = computed(() => Math.min(offset.value + limit.value, page.value.total));

function setStatus(type, title, message = '') {
  status.value = { type, title, message };
}

function describeRelated(related) {
  const parts = Object.entries(related || {}).map(([name, { deleted, unlinked }]) => {
    const bits = [];
    if (deleted) bits.push(`${deleted} deleted`);
    if (unlinked) bits.push(`${unlinked} unlinked`);
    return `${name}: ${bits.join(', ')}`;
  });
  return parts.length ? `Related records — ${parts.join('; ')}` : '';
}

async function loadEntity() {
  entity.value = await api.getEntity(props.name);
}

async function loadPage() {
  pageLoading.value = true;
  lastQueriedSearch = search.value.trim();
  try {
    page.value = await api.queryRecords(props.name, {
      offset: offset.value,
      limit: limit.value,
      q: lastQueriedSearch,
      field: fieldFilter.value?.field,
      value: fieldFilter.value?.value,
      sortBy: sortBy.value,
      sortDir: sortBy.value ? sortDir.value : undefined,
    });
    // Deleting the last records of the last page leaves us past the end.
    if (!page.value.items.length && offset.value > 0 && page.value.total > 0) {
      offset.value = Math.max(0, Math.floor((page.value.total - 1) / limit.value) * limit.value);
      return loadPage();
    }
  } catch (err) {
    setStatus('error', 'Could not load records', err.message);
  } finally {
    pageLoading.value = false;
  }
}

async function refresh() {
  await Promise.all([loadEntity(), loadPage()]);
  if (rawState.value === 'loaded' || rawState.value === 'tooLarge') rawState.value = 'idle';
  if (activeTab.value === 'json') openRawTab();
}

async function init() {
  loading.value = true;
  loadError.value = '';
  status.value = null;
  rawState.value = 'idle';
  rawJsonText.value = '';
  offset.value = 0;
  sortBy.value = '';
  search.value = typeof route.query.q === 'string' ? route.query.q : '';
  fieldFilter.value =
    typeof route.query.field === 'string'
      ? { field: route.query.field, value: String(route.query.value ?? '') }
      : null;
  if (activeTab.value === 'json') activeTab.value = 'table';
  try {
    const [, entities] = await Promise.all([loadEntity(), api.listEntities()]);
    allEntities.value = entities;
    relationsDraft.value = (entity.value.relations || []).map((r) => ({ ...r }));
    await loadPage();
  } catch (err) {
    loadError.value = err.message;
  } finally {
    loading.value = false;
  }
}

watch(() => [props.name, route.query.field, route.query.value, route.query.q], init, { immediate: true });

let searchTimer = null;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (search.value.trim() === lastQueriedSearch) return;
    offset.value = 0;
    loadPage();
  }, 250);
});
onBeforeUnmount(() => clearTimeout(searchTimer));

function toggleSort(col) {
  if (sortBy.value === col) {
    if (sortDir.value === 'asc') sortDir.value = 'desc';
    else sortBy.value = '';
  } else {
    sortBy.value = col;
    sortDir.value = 'asc';
  }
  offset.value = 0;
  loadPage();
}

function goToPage(delta) {
  offset.value = Math.max(0, offset.value + delta * limit.value);
  loadPage();
}

function changePageSize() {
  offset.value = 0;
  loadPage();
}

function clearFieldFilter() {
  router.replace({ name: 'entity-detail', params: { name: props.name } });
}

function formatCell(value) {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function relationLink(col, value) {
  const rel = outgoingByField.value.get(col);
  if (!rel || value === null || value === undefined || value === '') return null;
  const target = allEntities.value.find((e) => e.name === rel.entity);
  if (!target) return null;
  return { name: 'entity-detail', params: { name: rel.entity }, query: { field: target.idField || 'id', value: String(value) } };
}

function childLink(record, rel) {
  return { name: 'entity-detail', params: { name: rel.child }, query: { field: rel.field, value: String(record[idField.value]) } };
}

// ---- Record editing ----

function openEdit(record) {
  modalError.value = '';
  editingRecord.value = record;
  editingText.value = JSON.stringify(record, null, 2);
}

async function saveEdit() {
  modalError.value = '';
  try {
    const parsed = JSON.parse(editingText.value);
    await api.updateRecord(props.name, editingRecord.value[idField.value], parsed);
    editingRecord.value = null;
    setStatus('success', 'Record saved');
    await refresh();
  } catch (err) {
    modalError.value = err.message;
  }
}

async function deleteRecord(record) {
  const id = record[idField.value];
  const cascades = incomingRelations.value.filter((r) => r.onDelete === 'cascade').map((r) => r.child);
  const extra = cascades.length ? `\nRelated ${cascades.join(', ')} records will be deleted too.` : '';
  if (!confirm(`Delete record ${id}?${extra}`)) return;
  try {
    const result = await api.deleteRecord(props.name, id);
    setStatus('success', `Deleted record ${id}`, describeRelated(result?.related));
    await refresh();
  } catch (err) {
    setStatus('error', `Could not delete record ${id}`, err.message);
  }
}

function openAdd() {
  modalError.value = '';
  addText.value = '{\n  \n}';
  showAddModal.value = true;
}

async function saveAdd() {
  modalError.value = '';
  try {
    const parsed = JSON.parse(addText.value);
    const created = await api.addRecord(props.name, parsed);
    showAddModal.value = false;
    setStatus('success', `Added record ${created[idField.value]}`);
    await refresh();
  } catch (err) {
    modalError.value = err.message;
  }
}

// ---- Raw JSON ----

async function openRawTab(force = false) {
  activeTab.value = 'json';
  if (rawState.value === 'loaded' || rawState.value === 'loading') return;
  if (!force && recordCount.value > RAW_RECORD_LIMIT) {
    rawState.value = 'tooLarge';
    return;
  }
  rawState.value = 'loading';
  try {
    const records = await api.listRecords(props.name);
    rawJsonText.value = JSON.stringify(records, null, 2);
    rawState.value = 'loaded';
  } catch (err) {
    rawState.value = 'idle';
    setStatus('error', 'Could not load raw JSON', err.message);
  }
}

async function saveRawJson() {
  rawSaving.value = true;
  try {
    const parsed = JSON.parse(rawJsonText.value);
    if (!Array.isArray(parsed)) throw new Error('Root value must be a JSON array');
    const { count } = await api.replaceRecords(props.name, parsed);
    setStatus('success', 'Raw JSON saved', `${count} records stored.`);
    rawState.value = 'idle';
    await refresh();
  } catch (err) {
    setStatus('error', 'Could not save raw JSON', err.message);
  } finally {
    rawSaving.value = false;
  }
}

// ---- Bulk actions ----

async function runBulk(title, action) {
  busy.value = true;
  try {
    const message = await action();
    setStatus('success', title, message || '');
    await refresh();
  } catch (err) {
    setStatus('error', `${title} failed`, err.message);
  } finally {
    busy.value = false;
  }
}

function reseed() {
  if (!confirm('Reset this entity to its seed data? Current records will be replaced.')) return;
  runBulk('Reseeded', async () => {
    const { count } = await api.reseedEntity(props.name);
    return `${count} records restored from seed data.`;
  });
}

function clearAll() {
  if (!confirm('Delete all records for this entity? Relation delete rules are not applied.')) return;
  runBulk('Cleared all records', () => api.clearEntity(props.name).then(() => ''));
}

function saveAsSeed() {
  if (
    !confirm(
      `Replace this entity's seed data with the ${recordCount.value} current records?\n` +
        'Date tokens like {{today+30d}} in the existing seed data will be replaced by fixed dates.',
    )
  )
    return;
  runBulk('Seed data updated', async () => {
    const { seedCount } = await api.seedFromRecords(props.name);
    return `${seedCount} records are now the seed data (used by Reseed and config export).`;
  });
}

async function exportJson() {
  busy.value = true;
  try {
    const records = await api.listRecords(props.name);
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${props.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus('error', 'Export failed', err.message);
  } finally {
    busy.value = false;
  }
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let records;
  try {
    records = JSON.parse(await file.text());
    if (!Array.isArray(records)) throw new Error('The file must contain a JSON array of records');
  } catch (err) {
    setStatus('error', `Could not read ${file.name}`, err.message);
    return;
  }
  if (!confirm(`Replace all ${recordCount.value} stored records with ${records.length} records from ${file.name}?`)) return;
  runBulk(`Imported ${file.name}`, async () => {
    const { count } = await api.replaceRecords(props.name, records);
    return `${count} records stored.`;
  });
}

// ---- Relations ----

function addRelation() {
  relationsDraft.value.push({ field: '', entity: '', as: '', onDelete: 'none', validate: false });
}

async function saveRelations() {
  relationsSaving.value = true;
  try {
    const relations = relationsDraft.value
      .filter((r) => r.field.trim() && r.entity)
      .map((r) => ({ ...r, as: r.as?.trim() || undefined }));
    const saved = await api.updateEntity(props.name, { relations });
    // The server omits `relations` when empty, so set it explicitly rather than merging.
    entity.value = { ...entity.value, ...saved, relations: saved.relations || [] };
    relationsDraft.value = (entity.value.relations || []).map((r) => ({ ...r }));
    allEntities.value = await api.listEntities();
    setStatus('success', 'Relations saved');
  } catch (err) {
    setStatus('error', 'Could not save relations', err.message);
  } finally {
    relationsSaving.value = false;
  }
}
</script>

<template>
  <router-link to="/entities" class="back-link">← Back to Entities</router-link>

  <AlertBanner v-if="loadError" type="error" title="Could not load entity" :dismissible="false">{{ loadError }}</AlertBanner>

  <template v-if="!loading && entity">
    <div class="topbar">
      <div>
        <h1 class="mono">{{ entity.name }}</h1>
        <p class="subtitle">
          {{ recordCount.toLocaleString() }} records · {{ (entity.seedCount ?? 0).toLocaleString() }} seed records · id field:
          <span class="mono">{{ idField }}</span> · store/{{ entity.name }}.json
        </p>
      </div>
      <div class="topbar-actions">
        <button class="btn" :disabled="busy" @click="exportJson">Export JSON</button>
        <button class="btn" :disabled="busy" @click="importInput?.click()">Import JSON</button>
        <input ref="importInput" type="file" accept="application/json,.json" style="display: none" @change="onImportFile" />
        <button class="btn" :disabled="busy" title="Use the current records as this entity's seed data" @click="saveAsSeed">Save as Seed</button>
        <button class="btn" :disabled="busy" @click="reseed">Reseed</button>
        <button class="btn btn-danger-ghost" :disabled="busy" @click="clearAll">Clear All</button>
        <button class="btn btn-primary" @click="openAdd">+ Add Record</button>
      </div>
    </div>

    <AlertBanner v-if="status" :type="status.type" :title="status.title" @close="status = null">{{ status.message }}</AlertBanner>

    <div class="tabs-wrap">
      <div class="tabs">
        <div class="tab" :class="{ active: activeTab === 'table' }" @click="activeTab = 'table'">Table</div>
        <div class="tab" :class="{ active: activeTab === 'json' }" @click="openRawTab()">Raw JSON</div>
        <div class="tab" :class="{ active: activeTab === 'relations' }" @click="activeTab = 'relations'">
          Relations <span class="text-faint">({{ (entity.relations || []).length + incomingRelations.length }})</span>
        </div>
      </div>

      <!-- Table -->
      <div v-if="activeTab === 'table'" class="tab-panel active">
        <div class="table-toolbar">
          <div class="search-box">
            <span class="text-faint">⌕</span>
            <input type="search" v-model="search" placeholder="Search all fields…" />
          </div>
          <span v-if="fieldFilter" class="filter-chip mono">
            {{ fieldFilter.field }} = {{ fieldFilter.value }}
            <button title="Clear filter" @click="clearFieldFilter">✕</button>
          </span>
          <span v-if="pageLoading" class="spinner" aria-label="Loading"></span>
        </div>

        <div v-if="page.total === 0" class="empty-state">
          <p v-if="search || fieldFilter">No records match.</p>
          <p v-else>No records stored yet.</p>
        </div>
        <template v-else>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th v-for="col in page.columns" :key="col" class="sortable" @click="toggleSort(col)">
                    {{ col }}
                    <span v-if="outgoingByField.has(col)" class="text-faint" :title="`→ ${outgoingByField.get(col).entity}`">↗</span>
                    <span v-if="sortBy === col">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(record, i) in page.items" :key="`${record[idField]}-${i}`">
                  <td v-for="col in page.columns" :key="col" class="cell" :class="{ mono: col === idField, 'text-faint': record[col] === null }" :title="formatCell(record[col])">
                    <router-link v-if="relationLink(col, record[col])" :to="relationLink(col, record[col])" class="cell-link">{{ formatCell(record[col]) }}</router-link>
                    <template v-else>{{ formatCell(record[col]) }}</template>
                  </td>
                  <td class="icon-btn-row">
                    <router-link
                      v-for="rel in incomingRelations"
                      :key="`${rel.child}.${rel.field}`"
                      :to="childLink(record, rel)"
                      class="btn-icon"
                      :title="`Show ${rel.child} where ${rel.field} = ${record[idField]}`"
                    >⤵</router-link>
                    <button class="btn-icon" title="Edit" @click="openEdit(record)">✎</button>
                    <button class="btn-icon" title="Delete" @click="deleteRecord(record)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pager">
            <span>{{ (offset + 1).toLocaleString() }}–{{ pageEnd.toLocaleString() }} of {{ page.total.toLocaleString() }}</span>
            <div class="pager-controls">
              <select v-model.number="limit" @change="changePageSize">
                <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }} / page</option>
              </select>
              <button class="btn btn-sm" :disabled="offset === 0 || pageLoading" @click="goToPage(-1)">← Prev</button>
              <button class="btn btn-sm" :disabled="pageEnd >= page.total || pageLoading" @click="goToPage(1)">Next →</button>
            </div>
          </div>
        </template>
      </div>

      <!-- Raw JSON -->
      <div v-else-if="activeTab === 'json'" class="tab-panel active">
        <AlertBanner v-if="rawState === 'tooLarge'" type="warn" title="Large dataset" :dismissible="false">
          This entity has {{ recordCount.toLocaleString() }} records. Editing that much JSON in the browser is slow.
          Use the Table tab to edit individual records, or <strong>Export JSON</strong> → edit in your editor →
          <strong>Import JSON</strong>.
          <div style="margin-top: 8px"><button class="btn btn-sm" @click="openRawTab(true)">Load anyway</button></div>
        </AlertBanner>
        <AlertBanner v-else-if="rawState === 'loading'" type="busy" title="Loading records…" />
        <template v-else-if="rawState === 'loaded'">
          <textarea rows="18" class="mono" style="width: 100%" spellcheck="false" v-model="rawJsonText"></textarea>
          <div class="topbar-actions" style="justify-content: flex-end; margin-top: 10px">
            <button class="btn btn-primary" :disabled="rawSaving" @click="saveRawJson">{{ rawSaving ? 'Saving…' : 'Save Raw JSON' }}</button>
          </div>
          <p class="footnote">Saving replaces all records in store/{{ entity.name }}.json.</p>
        </template>
      </div>

      <!-- Relations -->
      <div v-else class="tab-panel active">
        <p class="text-muted" style="margin-top: 0">
          Declare fields of <span class="mono">{{ entity.name }}</span> that reference another entity's id.
          Linked endpoints can then return related records with <span class="mono">?_expand=&lt;alias&gt;</span>
          (or the endpoint's Expand setting), and parents can include these records via <span class="mono">?_embed={{ entity.name }}</span>.
        </p>
        <table v-if="relationsDraft.length">
          <thead>
            <tr>
              <th>Field</th>
              <th>References entity</th>
              <th>Alias (expand as)</th>
              <th>When the referenced record is deleted</th>
              <th title="Reject creates/updates that reference a record which doesn't exist">Validate</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(rel, i) in relationsDraft" :key="i">
              <td><input type="text" v-model="rel.field" placeholder="e.g. rebateId" list="entity-columns" /></td>
              <td>
                <select v-model="rel.entity">
                  <option value="" disabled>Select…</option>
                  <option v-for="n in entityNames" :key="n" :value="n">{{ n }}</option>
                </select>
              </td>
              <td><input type="text" v-model="rel.as" placeholder="auto" /></td>
              <td>
                <select v-model="rel.onDelete">
                  <option v-for="o in ON_DELETE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </td>
              <td><input type="checkbox" v-model="rel.validate" /></td>
              <td><button class="btn-icon" title="Remove" @click="relationsDraft.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <datalist id="entity-columns">
          <option v-for="col in page.columns" :key="col" :value="col" />
        </datalist>
        <div class="topbar-actions" style="margin-top: 12px">
          <button class="btn btn-sm" @click="addRelation">+ Add Relation</button>
          <button class="btn btn-primary btn-sm" :disabled="relationsSaving" @click="saveRelations">
            {{ relationsSaving ? 'Saving…' : 'Save Relations' }}
          </button>
        </div>

        <div class="section-label">Referenced by</div>
        <p v-if="!incomingRelations.length" class="text-faint">No other entity declares a relation to {{ entity.name }}.</p>
        <ul v-else class="text-muted">
          <li v-for="rel in incomingRelations" :key="`${rel.child}.${rel.field}`">
            <router-link :to="{ name: 'entity-detail', params: { name: rel.child } }" class="cell-link mono">{{ rel.child }}.{{ rel.field }}</router-link>
            — embed with <span class="mono">?_embed={{ rel.child }}</span>; on delete: {{ rel.onDelete }}
          </li>
        </ul>
      </div>
    </div>
  </template>

  <ModalDialog v-if="editingRecord" title="Edit Record" @close="editingRecord = null">
    <AlertBanner v-if="modalError" type="error" :dismissible="false">{{ modalError }}</AlertBanner>
    <textarea rows="12" class="mono" style="width: 100%" spellcheck="false" v-model="editingText"></textarea>
    <div class="topbar-actions" style="justify-content: flex-end; margin-top: 10px">
      <button class="btn" @click="editingRecord = null">Cancel</button>
      <button class="btn btn-primary" @click="saveEdit">Save</button>
    </div>
  </ModalDialog>

  <ModalDialog v-if="showAddModal" title="Add Record" @close="showAddModal = false">
    <AlertBanner v-if="modalError" type="error" :dismissible="false">{{ modalError }}</AlertBanner>
    <textarea rows="12" class="mono" style="width: 100%" spellcheck="false" v-model="addText"></textarea>
    <p class="footnote">Leave out <span class="mono">"{{ idField }}"</span> to have it generated.</p>
    <div class="topbar-actions" style="justify-content: flex-end; margin-top: 10px">
      <button class="btn" @click="showAddModal = false">Cancel</button>
      <button class="btn btn-primary" @click="saveAdd">Add</button>
    </div>
  </ModalDialog>
</template>
