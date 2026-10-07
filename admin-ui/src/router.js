import { createRouter, createWebHistory } from 'vue-router';
import EndpointsView from './views/EndpointsView.vue';
import EndpointEditView from './views/EndpointEditView.vue';
import EntitiesView from './views/EntitiesView.vue';
import EntityDetailView from './views/EntityDetailView.vue';
import LogsView from './views/LogsView.vue';
import SettingsView from './views/SettingsView.vue';

const routes = [
  { path: '/', name: 'endpoints', component: EndpointsView },
  { path: '/endpoints/new', name: 'endpoint-new', component: EndpointEditView, props: { mode: 'create' } },
  { path: '/endpoints/:id', name: 'endpoint-edit', component: EndpointEditView, props: (route) => ({ mode: 'edit', id: route.params.id }) },
  { path: '/entities', name: 'entities', component: EntitiesView },
  { path: '/entities/:name', name: 'entity-detail', component: EntityDetailView, props: true },
  { path: '/logs', name: 'logs', component: LogsView },
  { path: '/settings', name: 'settings', component: SettingsView },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
