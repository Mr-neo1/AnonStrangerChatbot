const fs = require('fs');
const path = require('path');

// Log rotation configuration
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_LOG_FILES = 5; // Keep 5 rotated files

function ensureLogsDir() {
  const dir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE
 * Keeps up to MAX_LOG_FILES rotated versions
 */
function rotateLogFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    
    const stats = fs.statSync(filePath);
    if (stats.size < MAX_LOG_SIZE) return;
    
    // Rotate existing backup files
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const oldPath = `${filePath}.${i}`;
      const newPath = `${filePath}.${i + 1}`;
      if (fs.existsSync(oldPath)) {
        if (i === MAX_LOG_FILES - 1) {
          fs.unlinkSync(oldPath); // Delete oldest
        } else {
          fs.renameSync(oldPath, newPath);
        }
      }
    }
    
    // Rotate current file
    fs.renameSync(filePath, `${filePath}.1`);
  } catch (err) {
    // Fail silently - rotation is best effort
  }
}

function appendToFile(fileName, content) {
  try {
    const dir = ensureLogsDir();
    const filePath = path.join(dir, fileName);
    
    // Check rotation before write
    rotateLogFile(filePath);
    
    // Use async write to avoid blocking event loop
    fs.appendFile(filePath, content + '\n', (err) => {
      if (err) {
        // Fail silently
      }
    });
  } catch (err) {
    // Fail silently to prevent log spam
  }
}

function appendJsonLog(fileName, obj) {
  try {
    const dir = ensureLogsDir();
    const filePath = path.join(dir, fileName);
    
    // Check rotation before write
    rotateLogFile(filePath);
    
    const line = JSON.stringify(obj) + '\n';
    
    // Use async write
    fs.appendFile(filePath, line, (err) => {
      if (err) {
        // Fail silently
      }
    });
  } catch (err) {
    // Fail silently
  }
}

function appendErrorLog(err, context = {}) {
  try {
    const obj = {
      ts: getTimestamp(),
      name: err && err.name ? err.name : (context && context.name) || 'Error',
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null,
      context: context || null
    };
    appendJsonLog('error.log', obj);
    // Only show critical errors in console
    if (context.critical || context.showConsole) {
      console.error(`[ERROR] ${obj.name}: ${obj.message}`);
    }
  } catch (e) {
    // Fail silently
  }
}

function logInfo(message, data = {}) {
  const logEntry = `[${getTimestamp()}] [INFO] ${message} ${JSON.stringify(data)}`;
  appendToFile('app.log', logEntry);
}

function logError(message, error = null, context = {}) {
  const logEntry = {
    ts: getTimestamp(),
    level: 'ERROR',
    message,
    error: error ? { name: error.name, message: error.message, stack: error.stack } : null,
    context
  };
  appendJsonLog('error.log', logEntry);
  // Only show in console if critical
  if (context.critical) {
    console.error(`[ERROR] ${message}`);
  }
}

function logDebug(message, data = {}) {
  // Only write to file, never console
  const logEntry = `[${getTimestamp()}] [DEBUG] ${message} ${JSON.stringify(data)}`;
  appendToFile('debug.log', logEntry);
}

module.exports = {
  info: logInfo,
  warn: (msg, data) => appendToFile('app.log', `[${getTimestamp()}] [WARN] ${msg} ${JSON.stringify(data || {})}`),
  error: logError,
  debug: logDebug,
  appendJsonLog,
  appendErrorLog,
  rotateLogFile
};