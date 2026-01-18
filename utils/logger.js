const fs = require('fs');
const path = require('path');

function ensureLogsDir() {
  const dir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendJsonLog(fileName, obj) {
  try {
    const dir = ensureLogsDir();
    const line = JSON.stringify(obj) + '\n';
    fs.appendFileSync(path.join(dir, fileName), line);
  } catch (err) {
    console.error('Failed to write log file:', err);
  }
}

function appendErrorLog(err, context = {}) {
  try {
    const obj = {
      ts: new Date().toISOString(),
      name: err && err.name ? err.name : (context && context.name) || 'Error',
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : (err && err.stack) || null,
      context: context || null
    };
    appendJsonLog('error.log', obj);
    console.error('[ERROR]', obj.name, obj.message, obj.stack || '');
  } catch (e) {
    console.error('Failed to append error log:', e);
  }
}

module.exports = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  appendJsonLog,
  appendErrorLog
};