/**
 * Process lock mechanism to prevent multiple bot instances from running simultaneously
 * Uses file-based locking with PID tracking
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOCK_FILE = path.join(__dirname, '..', '.bot.lock');
const LOCK_TIMEOUT_MS = 5000; // 5 seconds - timeout for stale locks

class ProcessLock {
  /**
   * Acquire an exclusive lock for the bot process
   * Checks for existing lock and validates the process is actually running
   * @returns {boolean} true if lock acquired, false if already locked
   */
  static acquire() {
    try {
      // Check if lock file exists
      if (fs.existsSync(LOCK_FILE)) {
        const lockContent = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const [pidStr, timestampStr] = lockContent.split('|');
        const lockPid = parseInt(pidStr, 10);
        const lockTimestamp = parseInt(timestampStr, 10);
        const lockAge = Date.now() - lockTimestamp;

        // Check if the process with this PID is still running
        const isProcessRunning = ProcessLock._isProcessRunning(lockPid);

        if (isProcessRunning) {
          console.error(`❌ Bot is already running (PID: ${lockPid})`);
          console.error(`   Please stop it first with: taskkill /PID ${lockPid} /F`);
          return false;
        }

        // Lock is stale (process died without cleanup)
        if (lockAge > LOCK_TIMEOUT_MS) {
          console.warn(`⚠️ Found stale lock file (age: ${lockAge}ms). Removing and acquiring new lock.`);
          fs.unlinkSync(LOCK_FILE);
        } else {
          console.error(`❌ Bot lock is active but process check failed. Lock age: ${lockAge}ms`);
          console.error(`   If you\'re sure no bot is running, delete: ${LOCK_FILE}`);
          return false;
        }
      }

      // Create new lock file with current PID and timestamp
      const currentPid = process.pid;
      const lockContent = `${currentPid}|${Date.now()}`;
      fs.writeFileSync(LOCK_FILE, lockContent, 'utf-8');
      console.log(`✅ Acquired bot lock (PID: ${currentPid})`);
      return true;
    } catch (err) {
      console.error('❌ Failed to acquire lock:', err.message);
      return false;
    }
  }

  /**
   * Release the lock file on process exit
   */
  static release() {
    try {
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
        console.log('✅ Released bot lock');
      }
    } catch (err) {
      console.error('⚠️ Failed to release lock:', err.message);
    }
  }

  /**
   * Check if a process with given PID is running
   * @private
   * @param {number} pid - Process ID to check
   * @returns {boolean} true if process is running
   */
  static _isProcessRunning(pid) {
    try {
      // On Windows, use tasklist; on Unix, use ps
      if (process.platform === 'win32') {
        const output = execSync(`tasklist /FI "PID eq ${pid}"`, { encoding: 'utf-8' });
        return output.includes(String(pid));
      } else {
        // Unix/Linux
        const output = execSync(`ps -p ${pid}`, { encoding: 'utf-8' });
        return output.includes(String(pid));
      }
    } catch (err) {
      // Command failed means process doesn't exist
      return false;
    }
  }
}

module.exports = ProcessLock;
