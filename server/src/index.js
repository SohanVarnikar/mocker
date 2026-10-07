import { createMockServer } from './mockServer.js';
import { createAdminServer } from './adminServer.js';
import { configStore } from './config.js';
import { ensureEntityStoresInitialized } from './store.js';

await ensureEntityStoresInitialized(configStore.listEntities());

const settings = configStore.getSettings();
const mockPort = Number(process.env.MOCK_PORT) || settings.mockPort || 4000;
const adminPort = Number(process.env.ADMIN_PORT) || settings.adminPort || 4001;

const mockApp = createMockServer();
const adminApp = createAdminServer();

mockApp.listen(mockPort, () => {
  console.log(`[api-mocker] Mock server running at   http://localhost:${mockPort}`);
});

adminApp.listen(adminPort, () => {
  console.log(`[api-mocker] Admin UI/API running at  http://localhost:${adminPort}`);
});
