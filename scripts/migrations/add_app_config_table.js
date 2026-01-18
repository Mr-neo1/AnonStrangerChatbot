/**
 * Migration: Add app_config table for dynamic configuration
 * Run: node scripts/migrations/add_app_config_table.js
 */

require('dotenv').config({ path: '.env.local' });
const { sequelize } = require('../../database/connectionPool');
const logger = require('../../utils/logger');

async function migrate() {
  try {
    logger.info('Starting app_config table migration...');

    // Create app_config table if not exists
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    logger.info('✅ app_config table created successfully');

    // Insert default configuration values
    const defaults = [
      // VIP Pricing
      { key: 'vip_price_299', value: '299' },
      { key: 'vip_price_399', value: '399' },
      { key: 'vip_price_499', value: '499' },
      { key: 'vip_duration_days', value: '30' },
      { key: 'vip_enabled', value: 'true' },
      
      // Lock Chat Pricing
      { key: 'lock_price_5min', value: '50' },
      { key: 'lock_price_10min', value: '90' },
      { key: 'lock_price_15min', value: '120' },
      { key: 'lock_enabled', value: 'true' },
      
      // Required Channel
      { key: 'required_channel', value: '' },
      { key: 'enforce_channel', value: 'false' },
      
      // Referral Settings
      { key: 'referral_commission', value: '0.8' },
      { key: 'referral_vip_days', value: '10' },
      { key: 'referral_enabled', value: 'true' },
      
      // Admin Channels
      { key: 'admin_media_channel', value: '' },
      { key: 'admin_abuse_channel', value: '' },
      { key: 'admin_logs_channel', value: '' }
    ];

    logger.info('Inserting default configuration values...');

    for (const config of defaults) {
      await sequelize.query(`
        INSERT INTO app_config (key, value, "updatedAt")
        VALUES (:key, :value, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO NOTHING;
      `, {
        replacements: { key: config.key, value: config.value }
      });
    }

    logger.info('✅ Default configuration values inserted');

    // Verify table
    const [rows] = await sequelize.query('SELECT COUNT(*) as count FROM app_config;');
    logger.info(`📊 Total config entries: ${rows[0].count}`);

    logger.info('✅ Migration completed successfully');
    process.exit(0);

  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
