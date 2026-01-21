const ConfigService = require('../services/configService');

// Get dynamic pricing from config, fallback to defaults
async function getVipPlans() {
  try {
    // Try to get dynamic plans from JSON config
    const plansConfig = await ConfigService.get('vip_plans_config', null);
    
    if (plansConfig) {
      try {
        const plans = typeof plansConfig === 'string' ? JSON.parse(plansConfig) : plansConfig;
        if (Array.isArray(plans) && plans.length > 0) {
          // Convert array to object format (for backward compatibility)
          const plansObj = {};
          plans.forEach(plan => {
            if (plan.enabled !== false) { // Only include enabled plans
              plansObj[plan.id.toUpperCase()] = {
                id: plan.id,
                name: plan.name || plan.id.toUpperCase(),
                stars: plan.stars || 0,
                days: plan.days || 0
              };
            }
          });
          if (Object.keys(plansObj).length > 0) {
            return plansObj;
          }
        }
      } catch (e) {
        console.error('Error parsing vip_plans_config:', e);
      }
    }
    
    // Fallback to legacy individual config keys (for migration)
    const basicName = await ConfigService.get('vip_plan_basic_name', 'BASIC') || 'BASIC';
    const plusName = await ConfigService.get('vip_plan_plus_name', 'PLUS') || 'PLUS';
    const proName = await ConfigService.get('vip_plan_pro_name', 'PRO') || 'PRO';
    const halfYearName = await ConfigService.get('vip_plan_half_year_name', 'HALF_YEAR') || 'HALF_YEAR';
    const yearlyName = await ConfigService.get('vip_plan_yearly_name', 'YEARLY') || 'YEARLY';
    
    return {
      BASIC: {
        id: 'basic',
        name: basicName,
        stars: await ConfigService.get('vip_plan_basic_stars', 100),
        days: await ConfigService.get('vip_plan_basic_days', 4)
      },
      PLUS: {
        id: 'plus',
        name: plusName,
        stars: await ConfigService.get('vip_plan_plus_stars', 200),
        days: await ConfigService.get('vip_plan_plus_days', 7)
      },
      PRO: {
        id: 'pro',
        name: proName,
        stars: await ConfigService.get('vip_plan_pro_stars', 300),
        days: await ConfigService.get('vip_plan_pro_days', 30)
      },
      HALF_YEAR: {
        id: 'half_year',
        name: halfYearName,
        stars: await ConfigService.get('vip_plan_half_year_stars', 900),
        days: await ConfigService.get('vip_plan_half_year_days', 182)
      },
      YEARLY: {
        id: 'yearly',
        name: yearlyName,
        stars: await ConfigService.get('vip_plan_yearly_stars', 1500),
        days: await ConfigService.get('vip_plan_yearly_days', 365)
      }
    };
  } catch (err) {
    console.error('Error getting VIP plans:', err);
    // Fallback to hardcoded defaults
    return {
      BASIC: { id: 'basic', name: 'BASIC', stars: 100, days: 4 },
      PLUS: { id: 'plus', name: 'PLUS', stars: 200, days: 7 },
      PRO: { id: 'pro', name: 'PRO', stars: 300, days: 30 },
      HALF_YEAR: { id: 'half_year', name: 'HALF_YEAR', stars: 900, days: 182 },
      YEARLY: { id: 'yearly', name: 'YEARLY', stars: 1500, days: 365 }
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