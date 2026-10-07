import { Router } from 'express';
import { configStore } from '../config.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(configStore.getSettings());
});

router.put('/', async (req, res) => {
  const settings = await configStore.saveSettings(req.body);
  res.json(settings);
});

export default router;
