const MAX_LOG_ENTRIES = 200;
const logs = [];
let seq = 0;

export function addLogEntry(entry) {
  logs.unshift({ id: ++seq, timestamp: new Date().toISOString(), ...entry });
  if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
}

export function listLogs() {
  return logs;
}

export function clearLogs() {
  logs.length = 0;
}
