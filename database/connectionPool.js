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
      max: 50,        // Scale up for high concurrency (30-40k DAU)
      min: 10,        // Keep warm connections
      acquire: 30000,
      idle: 10000,
    },
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    },
    benchmark: false,
    omitNull: true,
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

module.exports = { sequelize };