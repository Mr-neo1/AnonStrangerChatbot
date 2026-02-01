/**
 * Centralized Graceful Shutdown Handler
 * Ensures all resources are properly cleaned up on process exit
 */

const { sequelize } = require('../database/connectionPool');
const { redisClient } = require('../database/redisClient');

let isShuttingDown = false;
let httpServer = null;
let shutdownCallbacks = [];

/**
 * Set the HTTP server instance for graceful close
 */
function setHttpServer(server) {
  httpServer = server;
}

/**
 * Register a callback to be called during shutdown
 * @param {Function} callback - Async function to call during shutdown
 */
function onShutdown(callback) {
  shutdownCallbacks.push(callback);
}

/**
 * Perform graceful shutdown
 * @param {string} signal - The signal that triggered shutdown
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  isShuttingDown = true;
  
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  // Set a hard timeout for shutdown
  const timeout = setTimeout(() => {
    console.error('❌ Shutdown timeout (30s) - forcing exit');
    process.exit(1);
  }, 30000);
  
  try {
    // 1. Stop accepting new HTTP connections
    if (httpServer) {
      await new Promise((resolve) => {
        httpServer.close((err) => {
          if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
            console.warn('Warning closing HTTP server:', err.message);
          }
          console.log('✅ HTTP server closed');
          resolve();
        });
      });
    }
    
    // 2. Run all registered shutdown callbacks
    console.log(`📋 Running ${shutdownCallbacks.length} shutdown callbacks...`);
    for (const callback of shutdownCallbacks) {
      try {
        await callback();
      } catch (err) {
        console.error('Shutdown callback error:', err.message);
      }
    }
    
    // 3. Close Redis connection
    try {
      if (redisClient && typeof redisClient.quit === 'function') {
        await redisClient.quit();
        console.log('✅ Redis connection closed');
      }
    } catch (err) {
      console.warn('Redis close warning:', err.message);
    }
    
    // 4. Close database connection
    try {
      await sequelize.close();
      console.log('✅ Database connection closed');
    } catch (err) {
      console.warn('Database close warning:', err.message);
    }
    
    clearTimeout(timeout);
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('❌ Shutdown error:', err);
    clearTimeout(timeout);
    process.exit(1);
  }
}

/**
 * Register signal handlers for graceful shutdown
 */
function registerShutdownHandlers() {
  // Only register once
  if (process.listenerCount('SIGINT') > 0 || process.listenerCount('SIGTERM') > 0) {
    return;
  }
  
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  console.log('📋 Shutdown handlers registered');
}

/**
 * Check if shutdown is in progress
 */
function isShuttingDownNow() {
  return isShuttingDown;
}

module.exports = {
  gracefulShutdown,
  registerShutdownHandlers,
  setHttpServer,
  onShutdown,
  isShuttingDownNow
};
