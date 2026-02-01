const { Sequelize } = require("sequelize");
const config = require("../config/config");

// Determine database configuration based on environment
let sequelize;

if (config.POSTGRES_URI) {
  // PostgreSQL (production-ready, scalable to 40k+ DAU)
  sequelize = new Sequelize(config.POSTGRES_URI, {
    dialect: "postgres",
    logging: false,
    pool: {
      max: 25,        // Optimal for 10-15k DAU without exhausting PG connections
      min: 5,         // Fewer warm connections to reduce idle resource usage
      acquire: 30000,
      idle: 10000,
      evict: 1000,    // Check for idle connections every 1s
    },
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    },
    benchmark: false,
    omitNull: true,
    retry: {
      max: 3,         // Retry failed queries up to 3 times
      timeout: 3000,  // Wait 3s between retries
    },
    define: {
      freezeTableName: true,
      timestamps: true,
      underscored: false,
    },
  });
} else {
  // SQLite (development/small scale only - max 5k DAU)
  console.warn('⚠️ Using SQLite - NOT recommended for production or >5k DAU');
  console.warn('   Set POSTGRES_URI for production deployment');
  
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./chatbot.db",
    logging: false,
    pool: {
      max: 5,         // SQLite doesn't benefit from many connections
      min: 1,
      acquire: 30000,
      idle: 10000,
    },
    benchmark: false,
    omitNull: true,
    native: false,
    define: {
      freezeTableName: true,
      timestamps: true,
      underscored: false,
    },
  });
}

// Connection health check with retry logic
let retryCount = 0;
const maxRetries = 5;
const retryDelay = 2000; // 2 seconds

async function connectWithRetry() {
  try {
    await sequelize.authenticate();
    const dbType = config.POSTGRES_URI ? 'PostgreSQL' : 'SQLite';
    console.log(`✅ ${dbType} Database Connected`);
    retryCount = 0; // Reset on success
  } catch (err) {
    retryCount++;
    const dbType = config.POSTGRES_URI ? 'PostgreSQL' : 'SQLite';
    console.error(`❌ ${dbType} Connection Error (attempt ${retryCount}/${maxRetries}):`, err.message);
    
    if (retryCount < maxRetries) {
      console.log(`   Retrying in ${retryDelay}ms...`);
      setTimeout(connectWithRetry, retryDelay);
    } else {
      console.error(`❌ Failed to connect after ${maxRetries} attempts. Exiting...`);
      process.exit(1);
    }
  }
}

connectWithRetry();

// ==================== CONNECTION POOL MONITORING ====================

/**
 * Get connection pool statistics
 * @returns {Object} Pool stats including size, available, pending connections
 */
function getPoolStats() {
  try {
    const pool = sequelize.connectionManager.pool;
    if (!pool) {
      return { available: false, reason: 'Pool not initialized' };
    }
    
    return {
      available: true,
      size: pool.size || 0,
      availableConnections: pool.available || 0,
      pendingRequests: pool.pending || 0,
      maxConnections: pool.max || (config.POSTGRES_URI ? 100 : 5),
      minConnections: pool.min || (config.POSTGRES_URI ? 20 : 1),
      utilizationPercent: pool.size ? Math.round(((pool.size - (pool.available || 0)) / pool.size) * 100) : 0,
      isHealthy: pool.available > 0 || pool.pending < 10
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * Check database health with latency measurement
 * @returns {Object} Health status with latency
 */
async function checkHealth() {
  const start = Date.now();
  try {
    await sequelize.authenticate();
    const latency = Date.now() - start;
    
    return {
      status: 'ok',
      latencyMs: latency,
      dialect: config.POSTGRES_URI ? 'postgresql' : 'sqlite',
      pool: getPoolStats()
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
      latencyMs: Date.now() - start
    };
  }
}

/**
 * Log pool stats periodically (for monitoring)
 */
let poolMonitorInterval = null;

function startPoolMonitoring(intervalMs = 60000) {
  if (poolMonitorInterval) return;
  
  poolMonitorInterval = setInterval(() => {
    const stats = getPoolStats();
    if (stats.available && stats.utilizationPercent > 80) {
      console.warn(`⚠️ DB Pool high utilization: ${stats.utilizationPercent}% (${stats.size - stats.availableConnections}/${stats.size} connections in use)`);
    }
    if (stats.pendingRequests > 20) {
      console.warn(`⚠️ DB Pool queue growing: ${stats.pendingRequests} pending requests`);
    }
  }, intervalMs);
}

function stopPoolMonitoring() {
  if (poolMonitorInterval) {
    clearInterval(poolMonitorInterval);
    poolMonitorInterval = null;
  }
}

// Start monitoring in production
if (process.env.NODE_ENV === 'production') {
  startPoolMonitoring(30000); // Check every 30s in production
}

module.exports = { 
  sequelize,
  getPoolStats,
  checkHealth,
  startPoolMonitoring,
  stopPoolMonitoring
};