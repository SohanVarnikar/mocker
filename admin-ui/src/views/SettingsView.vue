<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';

const settings = ref({ mockPort: 4000, adminPort: 4001, corsEnabled: true });
const fileInput = ref(null);
const importMode = ref('merge');
const reseed = ref(true);
const includeData = ref(false);
const statusMsg = ref('');

onMounted(async () => {
  settings.value = await api.getSettings();
});

async function exportConfig() {
  const data = await api.exportConfig(includeData.value);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'api-mocker-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

function pickFile() {
  fileInput.value?.click();
}

async function handleFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    await api.importConfig({ ...parsed, mode: importMode.value, reseed: reseed.value });
    statusMsg.value = 'Configuration imported successfully.';
  } catch (err) {
    statusMsg.value = `Import failed: ${err.message}`;
  } finally {
    e.target.value = '';
  }
}

async function saveSettings() {
  settings.value = await api.saveSettings(settings.value);
  statusMsg.value = 'Settings saved. Restart the server for port changes to take effect.';
}
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Import / Export</h1>
      <p class="subtitle">Backup, share, or restore your mock configuration</p>
    </div>
  </div>

  <p v-if="statusMsg" class="text-muted">{{ statusMsg }}</p>

  <div class="card">
    <div class="card-header"><h2>Export Configuration</h2></div>
    <p class="text-muted" style="margin-top: 0">
      Download all endpoints, scenarios, and entity definitions (including their seed data) as a single JSON file.
    </p>
    <div class="field" style="margin-bottom: 12px">
      <label><input type="checkbox" v-model="includeData" /> Use current stored data as seed data (share the dataset as it is now)</label>
    </div>
    <button class="btn btn-primary" @click="exportConfig">⭳ Export config.json</button>
  </div>

  <div class="card">
    <div class="card-header"><h2>Import Configuration</h2></div>
    <div class="drop-zone" @click="pickFile">
      <p>Click to choose <span class="mono">config.json</span></p>
      <p class="text-faint" style="font-size: 11.5px">Endpoints, scenarios, entities and their seed data are imported</p>
    </div>
    <input ref="fileInput" type="file" accept="application/json" style="display: none" @change="handleFile" />
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
    <button class="btn btn-primary" @click="saveSettings">Save Settings</button>
  </div>
</template>
