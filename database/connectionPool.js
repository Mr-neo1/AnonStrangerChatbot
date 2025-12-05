const { Sequelize } = require("sequelize");
const config = require("../config/config");

// Optimized connection pool for performance
const sequelize = new Sequelize(config.POSTGRES_URI, {
  dialect: "sqlite",
  storage: "./chatbot.db",
  logging: false, // Disable logging in production for performance
  pool: {
    max: 5,         // SQLite doesn't need many connections
    min: 1,         // Minimum connections
    acquire: 30000, // Maximum time to get connection
    idle: 10000,    // Maximum idle time
  },
  // Additional performance settings
  benchmark: false,
  omitNull: true,
  native: false,
  define: {
    freezeTableName: true,
    timestamps: true,
    underscored: false,
  },
});

// Connection health check
sequelize.authenticate()
  .then(() => console.log("✅ SQLite Database Connected"))
  .catch((err) => {
    console.error("❌ PostgreSQL Connection Error:", err);
    process.exit(1);
  });

module.exports = { sequelize };