<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';

const props = defineProps({
  mode: { type: String, default: 'create' },
  id: { type: String, default: null },
});

const router = useRouter();
const entities = ref([]);
const saving = ref(false);
const errorMsg = ref('');

const STATUS_OPTIONS = [200, 201, 204, 400, 401, 403, 404, 409, 422, 500, 502, 503];
const RESULT_TOKEN = '{{result}}';
const REQUEST_BODY_TOKEN = '{{request.body.field}}';
const OPERATIONS = [
  { value: 'list', label: 'list — GET collection' },
  { value: 'getById', label: 'getById — GET single record' },
  { value: 'create', label: 'create — POST new record' },
  { value: 'update', label: 'update — PUT/PATCH modify record by id' },
  { value: 'delete', label: 'delete — DELETE record by id' },
];

function tempId() {
  return Math.random().toString(36).slice(2, 10);
}

function blankScenario(overrides = {}) {
  return {
    id: tempId(),
    name: 'Success',
    statusCode: 200,
    delayMs: 0,
    headers: 'Content-Type: application/json',
    body: '{}',
    usesEntity: true,
    ...overrides,
  };
}

function blankEndpoint() {
  const first = blankScenario();
  return {
    id: undefined,
    method: 'GET',
    path: '/api/resource',
    description: '',
    tag: '',
    enabled: true,
    requestShape: { pathParams: '', queryParams: '', body: '' },
    entityLink: null,
    activeScenarioId: first.id,
    scenarios: [first],
  };
}

const endpoint = ref(blankEndpoint());
const entityLinkEnabled = ref(false);
const selectedEntityName = ref('');
const selectedOperation = ref('list');
const expandText = ref('');
const embedText = ref('');

onMounted(async () => {
  try {
    entities.value = await api.listEntities();
  } catch (err) {
    errorMsg.value = err.message;
  }

  if (props.mode === 'edit' && props.id) {
    try {
      const loaded = await api.getEndpoint(props.id);
      loaded.requestShape = loaded.requestShape || { pathParams: '', queryParams: '', body: '' };
      endpoint.value = loaded;
      if (loaded.entityLink) {
        entityLinkEnabled.value = true;
        selectedEntityName.value = loaded.entityLink.entityName;
        selectedOperation.value = loaded.entityLink.operation;
        expandText.value = (loaded.entityLink.expand || []).join(', ');
        embedText.value = (loaded.entityLink.embed || []).join(', ');
      }
    } catch (err) {
      errorMsg.value = err.message;
    }
  }
});

function addScenario() {
  const s = blankScenario({ name: 'New Scenario', usesEntity: false });
  endpoint.value.scenarios.push(s);
}

function removeScenario(index) {
  const removed = endpoint.value.scenarios[index];
  endpoint.value.scenarios.splice(index, 1);
  if (endpoint.value.activeScenarioId === removed.id) {
    endpoint.value.activeScenarioId = endpoint.value.scenarios[0]?.id;
  }
}

const entityOptions = computed(() => entities.value.map((e) => e.name));

const selectedEntity = computed(() => entities.value.find((e) => e.name === selectedEntityName.value));
const expandOptions = computed(() => (selectedEntity.value?.relations || []).map((r) => r.as));
const embedOptions = computed(() =>
  entities.value
    .filter((e) => (e.relations || []).some((r) => r.entity === selectedEntityName.value))
    .map((e) => e.name),
);
const splitNames = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

async function save() {
  saving.value = true;
  errorMsg.value = '';
  try {
    const payload = { ...endpoint.value };
    payload.entityLink = entityLinkEnabled.value && selectedEntityName.value
      ? {
          // Keeps config-only settings (nested, bodyTemplate) that this form doesn't edit.
          ...(endpoint.value.entityLink || {}),
          entityName: selectedEntityName.value,
          operation: selectedOperation.value,
          expand: splitNames(expandText.value),
          embed: splitNames(embedText.value),
        }
      : null;

    if (props.mode === 'edit') {
      await api.updateEndpoint(props.id, payload);
    } else {
      await api.createEndpoint(payload);
    }
    router.push('/');
  } catch (err) {
    errorMsg.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <router-link to="/" class="back-link">← Back to Endpoints</router-link>
  <div class="topbar">
    <div>
      <h1>{{ mode === 'edit' ? 'Edit Endpoint' : 'New Endpoint' }}</h1>
      <p class="subtitle mono">{{ endpoint.method }} {{ endpoint.path }}</p>
    </div>
    <div class="topbar-actions">
      <router-link to="/" class="btn">Cancel</router-link>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : 'Save Endpoint' }}
      </button>
    </div>
  </div>

  <p v-if="errorMsg" class="text-muted" style="color: var(--danger)">{{ errorMsg }}</p>

  <!-- Basic Info -->
  <div class="card">
    <div class="card-header"><h2>Basic Info</h2></div>
    <div class="field-row">
      <div class="field" style="max-width: 140px">
        <label>Method</label>
        <select v-model="endpoint.method">
          <option v-for="m in ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
      <div class="field" style="flex: 2">
        <label>Path</label>
        <input type="text" v-model="endpoint.path" />
        <div class="hint">Use :param syntax for path parameters, e.g. /api/products/:id</div>
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Description</label>
        <input type="text" v-model="endpoint.description" />
      </div>
      <div class="field" style="max-width: 180px">
        <label>Tag / Group</label>
        <input type="text" v-model="endpoint.tag" />
      </div>
    </div>
    <div class="field" style="flex-direction: row; align-items: center; gap: 10px">
      <span class="toggle" :class="{ on: endpoint.enabled }" @click="endpoint.enabled = !endpoint.enabled">
        <span class="knob"></span>
      </span>
      <label style="margin: 0">Endpoint enabled</label>
      <span class="hint" style="margin: 0">Disabled endpoints return 404 on the mock server</span>
    </div>
  </div>

  <!-- Request Shape -->
  <div class="card">
    <div class="card-header">
      <h2>Request Shape <span class="text-faint" style="font-weight: 400">(optional, for reference)</span></h2>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Path Params</label>
        <textarea rows="2" v-model="endpoint.requestShape.pathParams" placeholder="id (number) — from :id"></textarea>
      </div>
      <div class="field">
        <label>Query Params</label>
        <textarea rows="2" v-model="endpoint.requestShape.queryParams" placeholder="none"></textarea>
      </div>
    </div>
    <div class="field">
      <label>Example Request Body</label>
      <textarea rows="5" class="mono" v-model="endpoint.requestShape.body" placeholder='{ "name": "example" }'></textarea>
    </div>
  </div>

  <!-- Entity Link -->
  <div class="card">
    <div class="card-header">
      <h2>Entity Link <span class="text-faint" style="font-weight: 400">(optional)</span></h2>
    </div>
    <div class="field" style="flex-direction: row; align-items: center; gap: 10px; margin-bottom: 14px">
      <span class="toggle" :class="{ on: entityLinkEnabled }" @click="entityLinkEnabled = !entityLinkEnabled">
        <span class="knob"></span>
      </span>
      <label style="margin: 0">Link this endpoint to an entity's data store</label>
    </div>
    <div class="field-row" v-if="entityLinkEnabled">
      <div class="field">
        <label>Entity</label>
        <select v-model="selectedEntityName">
          <option value="" disabled>Select an entity…</option>
          <option v-for="name in entityOptions" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>
      <div class="field" style="flex: 2">
        <label>Operation</label>
        <select v-model="selectedOperation">
          <option v-for="op in OPERATIONS" :key="op.value" :value="op.value">{{ op.label }}</option>
        </select>
      </div>
    </div>
    <div class="field-row" v-if="entityLinkEnabled && selectedEntityName && selectedOperation !== 'delete'">
      <div class="field">
        <label>Expand related records</label>
        <input type="text" v-model="expandText" :placeholder="expandOptions.join(', ') || 'no relations declared'" />
        <div class="hint">
          Adds the referenced record under its alias.
          <template v-if="expandOptions.length">Available: <span class="mono">{{ expandOptions.join(', ') }}</span></template>
        </div>
      </div>
      <div class="field">
        <label>Embed child records</label>
        <input type="text" v-model="embedText" :placeholder="embedOptions.join(', ') || 'no entity references this one'" />
        <div class="hint">
          Adds arrays of records that point at this one.
          <template v-if="embedOptions.length">Available: <span class="mono">{{ embedOptions.join(', ') }}</span></template>
        </div>
      </div>
    </div>
    <div class="hint" v-if="entityLinkEnabled">
      When a scenario below has "Uses entity data" checked, this endpoint reads/writes
      <span class="mono">data/store/{{ selectedEntityName || '&lt;entity&gt;' }}.json</span> automatically using path params.
      Reference the result with <span class="mono">{{ RESULT_TOKEN }}</span> in that scenario's response body.
      Scenarios without "Uses entity data" return their static body and leave stored data untouched.
    </div>
  </div>

  <!-- Response Scenarios -->
  <div class="card">
    <div class="card-header">
      <h2>Response Scenarios</h2>
      <button class="btn btn-sm" @click="addScenario">+ Add Scenario</button>
    </div>

    <div class="scenarios-list">
      <div
        v-for="(scenario, index) in endpoint.scenarios"
        :key="scenario.id"
        class="scenario-card"
        :class="{ 'is-active': endpoint.activeScenarioId === scenario.id }"
      >
        <div class="scenario-head">
          <label class="radio-active">
            <input
              type="radio"
              name="active-scenario"
              :checked="endpoint.activeScenarioId === scenario.id"
              @change="endpoint.activeScenarioId = scenario.id"
            />
            Active
          </label>
          <input type="text" v-model="scenario.name" />
          <select v-model.number="scenario.statusCode" style="width: 110px">
            <option v-for="code in STATUS_OPTIONS" :key="code" :value="code">{{ code }}</option>
          </select>
          <input type="number" v-model.number="scenario.delayMs" style="width: 80px" title="Delay (ms)" />
          <span class="hint" style="margin: 0">ms delay</span>
          <label v-if="entityLinkEnabled" class="hint" style="margin: 0; display: flex; align-items: center; gap: 4px; white-space: nowrap">
            <input type="checkbox" v-model="scenario.usesEntity" /> Uses entity data
          </label>
          <button class="btn-icon" title="Delete scenario" @click="removeScenario(index)">✕</button>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Headers</label>
            <textarea rows="2" class="mono" v-model="scenario.headers"></textarea>
          </div>
          <div class="field" style="flex: 2">
            <label>Response Body <span class="text-faint">(supports :id, {{ REQUEST_BODY_TOKEN }}, {{ RESULT_TOKEN }} templates)</span></label>
            <textarea rows="4" class="mono" v-model="scenario.body"></textarea>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
