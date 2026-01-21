const AppConfig = require('../models/appConfigModel');

/**
 * Dynamic Configuration Service
 * Manages runtime configuration that can be updated via admin dashboard
 * All values have safe defaults if not found in database
 */
class ConfigService {
  /**
   * Get a config value with fallback to default
   * @param {string} key - Config key
   * @param {any} defaultValue - Default value if not found
   * @returns {Promise<any>} - Parsed config value
   */
  static async get(key, defaultValue = null) {
    try {
      const config = await AppConfig.findOne({ where: { key } });
      if (!config || config.value === null) {
        return defaultValue;
      }
      
      // Try to parse as JSON for objects/arrays/booleans/numbers
      try {
        return JSON.parse(config.value);
      } catch {
        // If not JSON, return as string
        return config.value;
      }
    } catch (error) {
      console.error(`ConfigService.get error for key "${key}":`, error.message);
      return defaultValue;
    }
  }

  /**
   * Set a config value
   * @param {string} key - Config key
   * @param {any} value - Value to store (will be JSON stringified if not string)
   * @param {number} adminId - Telegram ID of admin making the change
   * @returns {Promise<boolean>} - Success status
   */
  static async set(key, value, adminId = null) {
    try {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      await AppConfig.upsert({
        key,
        value: stringValue,
        updatedAt: new Date()
      });

      // Log the change for audit
      console.log(`[ConfigService] "${key}" updated to "${stringValue}" by admin ${adminId || 'system'}`);
      return true;
    } catch (error) {
      console.error(`ConfigService.set error for key "${key}":`, error.message);
      return false;
    }
  }

  /**
   * Get multiple config values at once
   * @param {Object} keysWithDefaults - Object mapping keys to default values
   * @returns {Promise<Object>} - Object with all config values
   */
  static async getMany(keysWithDefaults) {
    const result = {};
    for (const [key, defaultValue] of Object.entries(keysWithDefaults)) {
      result[key] = await this.get(key, defaultValue);
    }
    return result;
  }

  /**
   * Delete a config key
   * @param {string} key - Config key to delete
   * @returns {Promise<boolean>} - Success status
   */
  static async delete(key) {
    try {
      await AppConfig.destroy({ where: { key } });
      console.log(`[ConfigService] Deleted key "${key}"`);
      return true;
    } catch (error) {
      console.error(`ConfigService.delete error for key "${key}":`, error.message);
      return false;
    }
  }

  /**
   * Initialize default config values if they don't exist
   * Safe to run on every startup
   */
  static async initializeDefaults() {
    // Default dynamic VIP plans (JSON array)
    const defaultVipPlans = [
      { id: 'basic', name: 'BASIC', stars: 100, days: 4, enabled: true },
      { id: 'plus', name: 'PLUS', stars: 200, days: 7, enabled: true },
      { id: 'pro', name: 'PRO', stars: 300, days: 30, enabled: true },
      { id: 'half_year', name: 'HALF_YEAR', stars: 900, days: 182, enabled: true },
      { id: 'yearly', name: 'YEARLY', stars: 1500, days: 365, enabled: true }
    ];

    const defaults = {
      // VIP Plans (dynamic - stored as JSON array)
      'vip_plans_config': JSON.stringify(defaultVipPlans),
      
      // Legacy VIP Plans (for backward compatibility during migration)
      'vip_plan_basic_stars': 100,
      'vip_plan_basic_days': 4,
      'vip_plan_basic_name': 'BASIC',
      'vip_plan_plus_stars': 200,
      'vip_plan_plus_days': 7,
      'vip_plan_plus_name': 'PLUS',
      'vip_plan_pro_stars': 300,
      'vip_plan_pro_days': 30,
      'vip_plan_pro_name': 'PRO',
      'vip_plan_half_year_stars': 900,
      'vip_plan_half_year_days': 182,
      'vip_plan_half_year_name': 'HALF_YEAR',
      'vip_plan_yearly_stars': 1500,
      'vip_plan_yearly_days': 365,
      'vip_plan_yearly_name': 'YEARLY',
      'vip_enabled': true,

      // Lock Chat Pricing (dynamic)
      'lock_chat_5min_price': 15,
      'lock_chat_10min_price': 25,
      'lock_chat_15min_price': 35,
      'lock_chat_enabled': true,

      // Required Join Channels (for promotions - dynamic)
      'required_channel_enabled': !!(process.env.REQUIRED_CHANNEL_1 || process.env.REQUIRED_CHANNEL_2),
      'required_channel_1': process.env.REQUIRED_CHANNEL_1 || '',
      'required_channel_2': process.env.REQUIRED_CHANNEL_2 || '',

      // Affiliate & Referral
      'affiliate_commission': 0.8,
      'referral_vip_days': 10,
      'referral_enabled': true,

      // Admin Channels
      'admin_media_channel': process.env.ADMIN_MEDIA_CHANNEL_ID || '',
      'admin_abuse_channel': '',
      'admin_logs_channel': '',
      
      // Bot Management
      'bot_tokens': process.env.BOT_TOKENS || process.env.BOT_TOKEN || ''
    };

    for (const [key, defaultValue] of Object.entries(defaults)) {
      const existing = await AppConfig.findOne({ where: { key } });
      if (!existing) {
        await this.set(key, defaultValue, 0); // 0 = system
      }
    }

    console.log('✅ ConfigService defaults initialized');
  }
}

module.exports = ConfigService;
