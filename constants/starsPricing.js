const ConfigService = require('../services/configService');

// Get dynamic pricing from config, fallback to defaults
async function getVipPlans() {
  try {
    return {
      BASIC: {
        stars: await ConfigService.get('vip_plan_basic_stars', 100),
        days: await ConfigService.get('vip_plan_basic_days', 4)
      },
      PLUS: {
        stars: await ConfigService.get('vip_plan_plus_stars', 200),
        days: await ConfigService.get('vip_plan_plus_days', 7)
      },
      PRO: {
        stars: await ConfigService.get('vip_plan_pro_stars', 300),
        days: await ConfigService.get('vip_plan_pro_days', 30)
      },
      HALF_YEAR: {
        stars: await ConfigService.get('vip_plan_half_year_stars', 900),
        days: await ConfigService.get('vip_plan_half_year_days', 182)
      },
      YEARLY: {
        stars: await ConfigService.get('vip_plan_yearly_stars', 1500),
        days: await ConfigService.get('vip_plan_yearly_days', 365)
      }
    };
  } catch (err) {
    // Fallback to defaults
    return {
      BASIC: { stars: 100, days: 4 },
      PLUS: { stars: 200, days: 7 },
      PRO: { stars: 300, days: 30 },
      HALF_YEAR: { stars: 900, days: 182 },
      YEARLY: { stars: 1500, days: 365 }
    };
  }
}

async function getLockPricing() {
  try {
    return {
      5: await ConfigService.get('lock_chat_5min_price', 15),
      10: await ConfigService.get('lock_chat_10min_price', 25),
      15: await ConfigService.get('lock_chat_15min_price', 35)
    };
  } catch (err) {
    return { 5: 15, 10: 25, 15: 35 };
  }
}

module.exports = {
  // Static defaults (for backwards compatibility)
  LOCK: { 5: 15, 10: 25, 15: 35 },
  VIP: { 7: 100, 30: 200, 90: 300 },
  VIP_PLANS: {
    BASIC: { stars: 100, days: 4 },
    PLUS: { stars: 200, days: 7 },
    PRO: { stars: 300, days: 30 },
    HALF_YEAR: { stars: 900, days: 182 },
    YEARLY: { stars: 1500, days: 365 }
  },
  
  // Dynamic getters (use these in code)
  getVipPlans,
  getLockPricing
};