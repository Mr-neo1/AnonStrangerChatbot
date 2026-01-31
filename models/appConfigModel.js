const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connectionPool');

/**
 * AppConfig Model
 * Stores dynamic configuration that can be updated via admin dashboard
 * without requiring bot restart
 */
const AppConfig = sequelize.define('AppConfig', {
  key: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false,
    comment: 'Configuration key (e.g., vip_price_299, lock_chat_enabled)'
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Configuration value (stored as string, parsed as needed)'
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'updatedAt'
  }
}, {
  tableName: 'app_config',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['key']
    }
  ]
});

// Lightweight in-memory cache to reduce DB reads for frequently accessed config
const CACHE_TTL_MS = 30 * 1000; // 30 seconds
const cache = new Map();

/**
 * Read a config value with simple TTL cache
 * @param {string} key
 * @param {any} defaultValue
 */
AppConfig.getValue = async function getValue(key, defaultValue = null) {
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const row = await AppConfig.findOne({ where: { key } });
    const value = row?.value ?? defaultValue;
    cache.set(key, { value, ts: Date.now() });
    return value;
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    const missingTable = msg.includes('relation') && msg.includes('app_config') && msg.includes('does not exist');
    if (missingTable) {
      console.warn(`⚠️ AppConfig table missing; returning default for key: ${key}`);
      cache.set(key, { value: defaultValue, ts: Date.now() });
      return defaultValue;
    }
    throw err;
  }
};

/**
 * Set a config value and refresh cache
 * @param {string} key
 * @param {any} value
 */
AppConfig.setValue = async function setValue(key, value) {
  try {
    await AppConfig.upsert({ key, value, updatedAt: new Date() });
    cache.set(key, { value, ts: Date.now() });
    return true;
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    const missingTable = msg.includes('relation') && msg.includes('app_config') && msg.includes('does not exist');
    if (missingTable) {
      console.warn(`⚠️ AppConfig table missing; cannot persist key: ${key}`);
      cache.set(key, { value, ts: Date.now() });
      return false;
    }
    throw err;
  }
};

AppConfig.clearCache = function clearCache(key) {
  if (key) cache.delete(key); else cache.clear();
};

module.exports = AppConfig;
