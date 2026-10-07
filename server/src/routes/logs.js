import { Router } from 'express';
import { listLogs, clearLogs } from '../requestLog.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listLogs());
});

router.delete('/', (req, res) => {
  clearLogs();
  res.status(204).end();
});

export default router;
