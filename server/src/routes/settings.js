import { asyncRouter } from '../asyncRouter.js';
import { configStore } from '../config.js';

const router = asyncRouter();

router.get('/', (req, res) => {
  res.json(configStore.getSettings());
});

router.put('/', async (req, res) => {
  const settings = await configStore.saveSettings(req.body);
  res.json(settings);
});

export default router;
