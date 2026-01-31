/**
 * Process lock mechanism to prevent multiple bot instances from running simultaneously
 * Uses file-based locking with PID tracking + automatic cleanup
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const LOCK_FILE = path.join(__dirname, '..', '.bot.lock');
const LOCK_TIMEOUT_MS = 5000; // 5 seconds - timeout for stale locks

class ProcessLock {
  /**
   * Kill any existing Node.js processes that might be running the bot
   * This is called automatically on startup to prevent 409 conflicts
   */
  static killExistingBotProcesses() {
    const currentPid = process.pid;
    console.log('🔍 Checking for existing bot processes...');
    
    try {
      if (process.platform === 'win32') {
        // Get list of node.exe processes
        const output = execSync('wmic process where "name=\'node.exe\'" get processid,commandline /format:csv', {
          encoding: 'utf-8',
          timeout: 5000
        });
        
        const lines = output.split('\n').filter(line => line.includes('node.exe'));
        let killedCount = 0;
        
        for (const line of lines) {
          // Check if this is our bot process (contains start-all.js, bot.js, or bots.js)
          if (line.includes('start-all.js') || line.includes('bots.js') || line.includes('AnonStrangerChatbot')) {
            // Extract PID from CSV line
            const parts = line.split(',');
            const pid = parseInt(parts[parts.length - 1]?.trim(), 10);
            
            if (pid && pid !== currentPid && !isNaN(pid)) {
              try {
                execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf-8', timeout: 3000 });
                console.log(`  ✅ Killed old bot process (PID: ${pid})`);
                killedCount++;
              } catch (e) {
                // Process might have already exited
              }
            }
          }
        }
        
        if (killedCount > 0) {
          console.log(`🧹 Cleaned up ${killedCount} old process(es). Waiting 2 seconds...`);
          // Wait for processes to fully terminate
          spawnSync('timeout', ['/t', '2', '/nobreak'], { shell: true, stdio: 'ignore' });
        } else {
          console.log('  ✅ No conflicting processes found');
        }
      } else {
        // Unix/Linux - kill old processes but NOT the current one
        try {
          // Get PIDs of matching processes, excluding current PID
          const output = execSync(`pgrep -f "start-all.js|bots.js" 2>/dev/null || true`, { encoding: 'utf-8' });
          const pids = output.trim().split('\n').filter(p => p && parseInt(p) !== currentPid);
          
          for (const pid of pids) {
            try {
              process.kill(parseInt(pid), 'SIGTERM');
              console.log(`  ✅ Killed old bot process (PID: ${pid})`);
            } catch (e) {
              // Process might have already exited
            }
          }
          
          if (pids.length > 0) {
            console.log(`🧹 Cleaned up ${pids.length} old process(es). Waiting 2 seconds...`);
            execSync('sleep 2', { encoding: 'utf-8' });
          }
        } catch (e) {
          // Ignore errors
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not check for existing processes:', err.message);
    }
  }

  /**
   * Acquire an exclusive lock for the bot process
   * Checks for existing lock and validates the process is actually running
   * @param {boolean} autoKill - If true, automatically kill conflicting processes
   * @returns {boolean} true if lock acquired, false if already locked
   */
  static acquire(autoKill = true) {
    try {
      // Auto-kill existing processes if enabled
      if (autoKill) {
        ProcessLock.killExistingBotProcesses();
      }
      
      // Check if lock file exists
      if (fs.existsSync(LOCK_FILE)) {
        const lockContent = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const [pidStr, timestampStr] = lockContent.split('|');
        const lockPid = parseInt(pidStr, 10);
        const lockTimestamp = parseInt(timestampStr, 10);
        const lockAge = Date.now() - lockTimestamp;

        // Check if the process with this PID is still running
        const isProcessRunning = ProcessLock._isProcessRunning(lockPid);

        if (isProcessRunning && lockPid !== process.pid) {
          if (autoKill) {
            // Try to kill the old process
            console.warn(`⚠️ Bot already running (PID: ${lockPid}). Killing it...`);
            try {
              if (process.platform === 'win32') {
                execSync(`taskkill /PID ${lockPid} /F`, { encoding: 'utf-8', timeout: 3000 });
              } else {
                execSync(`kill -9 ${lockPid}`, { encoding: 'utf-8', timeout: 3000 });
              }
              console.log(`  ✅ Killed old bot process (PID: ${lockPid})`);
              fs.unlinkSync(LOCK_FILE);
            } catch (e) {
              console.error(`❌ Could not kill process ${lockPid}:`, e.message);
              return false;
            }
          } else {
            console.error(`❌ Bot is already running (PID: ${lockPid})`);
            console.error(`   Please stop it first with: taskkill /PID ${lockPid} /F`);
            return false;
          }
        } else if (!isProcessRunning || lockAge > LOCK_TIMEOUT_MS) {
          // Lock is stale (process died without cleanup)
          console.warn(`⚠️ Found stale lock file. Removing and acquiring new lock.`);
          fs.unlinkSync(LOCK_FILE);
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
