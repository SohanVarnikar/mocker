<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import AlertBanner from '../components/AlertBanner.vue';

const settings = ref({ mockPort: 4000, adminPort: 4001, corsEnabled: true });
const fileInput = ref(null);
const importMode = ref('merge');
const reseed = ref(true);
const includeData = ref(false);

const importing = ref(false);
const importingFile = ref('');
const dragging = ref(false);
const importStatus = ref(null);
const exporting = ref(false);
const exportStatus = ref(null);
const savingSettings = ref(false);
const settingsStatus = ref(null);

onMounted(async () => {
  try {
    settings.value = await api.getSettings();
  } catch (err) {
    settingsStatus.value = { type: 'error', title: 'Could not load settings', message: err.message };
  }
});

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const plural = (n, word) => `${n} ${n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;

async function exportConfig() {
  exporting.value = true;
  exportStatus.value = null;
  try {
    const data = await api.exportConfig(includeData.value);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'api-mocker-config.json';
    a.click();
    URL.revokeObjectURL(url);
    exportStatus.value = {
      type: 'success',
      title: 'Export ready',
      message: `Downloaded api-mocker-config.json (${formatSize(blob.size)}) with ${plural(data.endpoints.length, 'endpoint')} and ${plural(data.entities.length, 'entity')}.`,
    };
  } catch (err) {
    exportStatus.value = { type: 'error', title: 'Export failed', message: err.message };
  } finally {
    exporting.value = false;
  }
}

function pickFile() {
  if (!importing.value) fileInput.value?.click();
}

function onFileChosen(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) importFile(file);
}

function onDrop(e) {
  dragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file && !importing.value) importFile(file);
}

async function importFile(file) {
  if (
    importMode.value === 'overwrite' &&
    !confirm('Overwrite replaces ALL existing endpoints and entities with the contents of this file. Continue?')
  ) {
    return;
  }
  importing.value = true;
  importingFile.value = `${file.name} (${formatSize(file.size)})`;
  importStatus.value = null;
  try {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      throw new Error(`${file.name} is not valid JSON: ${err.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${file.name} must contain a JSON object with "endpoints" and/or "entities".`);
    }
    const result = await api.importConfig({ ...parsed, mode: importMode.value, reseed: reseed.value });
    const { endpoints: ep, entities: en } = result;
    const details = [
      `Endpoints: ${ep.added} added, ${ep.updated} updated`,
      `Entities: ${en.added} added, ${en.updated} updated`,
      result.reseeded.length
        ? `Stored data reset to seed data for: ${result.reseeded.join(', ')}`
        : 'Stored data of existing entities was kept',
      `Now configured: ${plural(result.totals.endpoints, 'endpoint')}, ${plural(result.totals.entities, 'entity')}`,
    ];
    importStatus.value = {
      type: 'success',
      title: `Imported ${file.name} (${result.mode})`,
      details,
    };
  } catch (err) {
    importStatus.value = { type: 'error', title: `Import of ${file.name} failed`, message: err.message };
  } finally {
    importing.value = false;
  }
}

async function saveSettings() {
  savingSettings.value = true;
  settingsStatus.value = null;
  try {
    settings.value = await api.saveSettings(settings.value);
    settingsStatus.value = {
      type: 'success',
      title: 'Settings saved',
      message: 'Restart the server for port or CORS changes to take effect.',
    };
  } catch (err) {
    settingsStatus.value = { type: 'error', title: 'Could not save settings', message: err.message };
  } finally {
    savingSettings.value = false;
  }
}
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Import / Export</h1>
      <p class="subtitle">Backup, share, or restore your mock configuration</p>
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h2>Export Configuration</h2></div>
    <AlertBanner v-if="exportStatus" :type="exportStatus.type" :title="exportStatus.title" @close="exportStatus = null">
      {{ exportStatus.message }}
    </AlertBanner>
    <p class="text-muted" style="margin-top: 0">
      Download all endpoints, scenarios, and entity definitions (including their seed data) as a single JSON file.
    </p>
    <div class="field" style="margin-bottom: 12px">
      <label><input type="checkbox" v-model="includeData" /> Use current stored data as seed data (share the dataset as it is now)</label>
    </div>
    <button class="btn btn-primary" :disabled="exporting" @click="exportConfig">
      {{ exporting ? 'Exporting…' : '⭳ Export config.json' }}
    </button>
  </div>

  <div class="card">
    <div class="card-header"><h2>Import Configuration</h2></div>
    <AlertBanner v-if="importing" type="busy" title="Importing…">
      {{ importingFile }} — large files can take a few seconds.
    </AlertBanner>
    <AlertBanner v-else-if="importStatus" :type="importStatus.type" :title="importStatus.title" @close="importStatus = null">
      <template v-if="importStatus.message">{{ importStatus.message }}</template>
      <ul v-if="importStatus.details">
        <li v-for="line in importStatus.details" :key="line">{{ line }}</li>
      </ul>
    </AlertBanner>
    <div
      class="drop-zone"
      :class="{ dragging, disabled: importing }"
      @click="pickFile"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p v-if="importing">Importing {{ importingFile }}…</p>
      <p v-else>Click to choose or drop <span class="mono">config.json</span> here</p>
      <p class="text-faint" style="font-size: 11.5px">Endpoints, scenarios, entities and their seed data are imported</p>
    </div>
    <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="onFileChosen" />
    <div class="field-row" style="margin-top: 14px">
      <div class="field">
        <label><input type="radio" value="merge" v-model="importMode" /> Merge with existing endpoints</label>
      </div>
      <div class="field">
        <label><input type="radio" value="overwrite" v-model="importMode" /> Overwrite all endpoints</label>
      </div>
    </div>
    <div class="field" style="margin-top: 10px">
      <label><input type="checkbox" v-model="reseed" /> Reset stored data of imported entities to the file's seed data</label>
    </div>
  </div>

  <div class="card">
    <div class="card-header"><h2>Server Settings</h2></div>
    <AlertBanner v-if="settingsStatus" :type="settingsStatus.type" :title="settingsStatus.title" @close="settingsStatus = null">
      {{ settingsStatus.message }}
    </AlertBanner>
    <div class="field-row">
      <div class="field">
        <label>Mock Server Port</label>
        <input type="number" v-model.number="settings.mockPort" />
      </div>
      <div class="field">
        <label>Admin UI Port</label>
        <input type="number" v-model.number="settings.adminPort" />
      </div>
    </div>
    <div class="field" style="flex-direction: row; align-items: center; gap: 10px">
      <span class="toggle" :class="{ on: settings.corsEnabled }" @click="settings.corsEnabled = !settings.corsEnabled">
        <span class="knob"></span>
      </span>
      <label style="margin: 0">Enable CORS on mock server</label>
    </div>
    <hr class="divider" />
    <button class="btn btn-primary" :disabled="savingSettings" @click="saveSettings">
      {{ savingSettings ? 'Saving…' : 'Save Settings' }}
    </button>
  </div>
</template>
