const { redisClient } = require('../database/redisClient');
const VipService = require('./vipService');
const LockChatService = require('./lockChatService');
const ReferralService = require('./referralService');
const config = require('../config/config');
const Payment = require('../models/starTransactionModel');
const { sequelize } = require('../database/connectionPool');
const starsPricing = require('../constants/starsPricing');
const fs = require('fs');

class PaymentService {
  constructor(bot) {
    this.bot = bot;
    // Listen for successful_payment messages
    this.bot.on('message', async (msg) => {
      try {
        if (msg.successful_payment) {
          await this.handleSuccessfulPayment(msg);
        }
      } catch (err) {
        console.error('Payment handling error:', err);
      }
    });

    // Handle callback queries for invoice initiation (e.g., buy buttons)
    this.bot.on('callback_query', async (cb) => {
      try {
        if (!cb || !cb.data) return;
        // Expected format: STAR_BUY:TYPE:IDENT (e.g. STAR_BUY:VIP:BASIC or STAR_BUY:LOCK:10)
        const parts = String(cb.data || '').split(':');
        if (parts[0] !== 'STAR_BUY') return;
        const chatId = cb.from && cb.from.id ? cb.from.id : (cb.message && cb.message.chat && cb.message.chat.id);
        await this.bot.answerCallbackQuery(cb.id).catch(() => {});
        const featureFlags = require('../config/featureFlags');
        // For Telegram Stars (digital goods), provider_token should be empty string
        // Currency must be "XTR" for Telegram Stars
        if (!featureFlags.isFeatureEnabled('ENABLE_STARS_PAYMENTS')) {
          return this.bot.sendMessage(chatId, '⭐ Payments are currently unavailable. Please try later or contact admin.');
        }

        const type = parts[1];
        const ident = parts[2];
        const starsPricing = require('../constants/starsPricing');
        // Empty string for provider_token (required for Telegram Stars/digital goods)
        const providerToken = '';
        // Currency must be "XTR" for Telegram Stars
        const currency = 'XTR';

        if (type === 'VIP') {
          const planId = ident;
          const vipPlans = await starsPricing.getVipPlans();
          const plan = vipPlans[planId];
          if (!plan) return this.bot.sendMessage(chatId, '❌ Invalid VIP plan selected.');
          const title = `VIP ${planId}`;
          const description = `${plan.days} day(s) VIP — ${plan.stars} Stars`;
          const payload = JSON.stringify({ type: 'VIP', planId, days: plan.days });
          // For Telegram Stars (XTR), amount is in Stars directly (no multiplication by 100)
          const prices = [{ label: `${plan.stars} Stars`, amount: plan.stars }];
          // sendInvoice signature: (chatId, title, description, payload, providerToken, currency, prices, options)
          // start_parameter goes in options object, not as separate parameter
          await this.bot.sendInvoice(chatId, title, description, payload, providerToken, currency, prices, { 
            start_parameter: 'start',
            need_name: false, 
            need_phone_number: false 
          });
        } else if (type === 'LOCK') {
          const duration = parseInt(ident, 10);
          const lockPricing = await require('../constants/starsPricing').getLockPricing();
          const amountStars = lockPricing[duration];
          if (!amountStars) return this.bot.sendMessage(chatId, '❌ Invalid lock duration selected.');
          const title = `Lock Chat — ${duration} min`;
          const description = `${duration} minute lock — ${amountStars} Stars`;
          const payload = JSON.stringify({ type: 'LOCK', duration });
          // For Telegram Stars (XTR), amount is in Stars directly (no multiplication by 100)
          const prices = [{ label: `${amountStars} Stars`, amount: amountStars }];
          // sendInvoice signature: (chatId, title, description, payload, providerToken, currency, prices, options)
          // start_parameter goes in options object, not as separate parameter
          await this.bot.sendInvoice(chatId, title, description, payload, providerToken, currency, prices, { 
            start_parameter: 'start',
            need_name: false, 
            need_phone_number: false 
          });
        }
      } catch (err) {
        console.error('Error handling callback_query in PaymentService:', err);
      }
    });

    // Handle pre-checkout queries (validate payload/amounts before letting Telegram proceed)
    this.bot.on('pre_checkout_query', async (q) => {
      try {
        const payload = (q.invoice_payload) ? (function () { try { return JSON.parse(q.invoice_payload); } catch (e) { return {}; } })() : {};
        const starsPricing = require('../constants/starsPricing');
        if (payload && payload.type === 'VIP' && payload.planId) {
          const vipPlans = await starsPricing.getVipPlans();
          const plan = vipPlans[payload.planId];
          // For Telegram Stars (XTR), total_amount is in Stars directly (not multiplied by 100)
          const amount = q.total_amount ? q.total_amount : 0;
          if (!plan || plan.stars !== amount) {
            return this.bot.answerPreCheckoutQuery(q.id, false, 'Payment amount or plan mismatch.');
          }
          // Validate currency is XTR for Telegram Stars
          if (q.currency !== 'XTR') {
            return this.bot.answerPreCheckoutQuery(q.id, false, 'Invalid currency. Must use Telegram Stars (XTR).');
          }
        } else if (payload && payload.type === 'LOCK' && payload.duration) {
          // For Telegram Stars (XTR), total_amount is in Stars directly (not multiplied by 100)
          const amount = q.total_amount ? q.total_amount : 0;
          const expected = (starsPricing.LOCK || {})[payload.duration];
          if (!expected || expected !== amount) {
            return this.bot.answerPreCheckoutQuery(q.id, false, 'Payment amount or lock duration mismatch.');
          }
          // Validate currency is XTR for Telegram Stars
          if (q.currency !== 'XTR') {
            return this.bot.answerPreCheckoutQuery(q.id, false, 'Invalid currency. Must use Telegram Stars (XTR).');
          }
        }
        // Otherwise accept
        await this.bot.answerPreCheckoutQuery(q.id, true);
      } catch (err) {
        console.error('pre_checkout_query handler error:', err);
        await this.bot.answerPreCheckoutQuery(q.id, false, 'Internal error validating payment.');
      }
    });
  }

  async handleSuccessfulPayment(msg) {
    const payment = msg.successful_payment;
    const userId = msg.from.id;
    const telegramChargeId = payment.provider_payment_charge_id || payment.telegram_payment_charge_id || `${msg.message_id}:${payment.invoice_payload}`;

    // Basic feature flag
    const featureFlags = require('../config/featureFlags');
    const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
    if (!featureFlags.isFeatureEnabled('ENABLE_STARS_PAYMENTS')) {
      await this.bot.sendMessage(userId, 'Payments are currently disabled. Please contact admin.');
      return;
    }

    // Idempotency: check unique telegramChargeId
    const existing = await Payment.findOne({ where: { telegramChargeId } });
    if (existing) {
      // Notify user and optionally alert admin about duplicate attempt
      await this.bot.sendMessage(userId, 'Payment already processed. Thank you.');
      if (adminId && require('../config/featureFlags').isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
        try {
          // For Telegram Stars (XTR), total_amount is in Stars directly
          const amount = payment.currency === 'XTR' ? payment.total_amount : Math.round(payment.total_amount/100);
          await this.bot.sendMessage(adminId, `⚠️ Duplicate payment attempt: user=${userId}, charge=${telegramChargeId}, amount=${amount} ${payment.currency}`);
        } catch (err) {
          console.error('Failed to send duplicate payment alert to admin:', err?.message);
        }
      }
      return;
    }

    // Parse invoice payload to determine type (simple JSON expected)
    let payload = {};
    try {
      payload = JSON.parse(payment.invoice_payload || '{}');
    } catch (err) {
      // Fallback: try key=value pairs like "type=VIP;days=7"
      const kv = (payment.invoice_payload || '').split(';').reduce((acc, p) => {
        const [k, v] = p.split('='); if (k) acc[k] = v; return acc;
      }, {});
      payload = kv;
    }

    // Validate invoice amount against pricing constants
    // For Telegram Stars (XTR), total_amount is in Stars directly (not multiplied by 100)
    const amountStars = payment.total_amount || 0;
    if (payload.type === 'VIP') {
      // Support both old format (days) and new format (planId)
      const planId = payload.planId;
      const vipPlans = await starsPricing.getVipPlans();
      const days = payload.days || (planId && vipPlans[planId]?.days);
      
      let expected;
      if (planId && vipPlans[planId]) {
        // New format: use planId
        expected = vipPlans[planId].stars;
      } else if (days && starsPricing.VIP[days]) {
        // Old format: use days
        expected = starsPricing.VIP[days];
      } else {
        expected = null;
      }
      
      if (!expected || expected !== amountStars) {
        // suspicious payment amount
        if (adminId && require('../config/featureFlags').isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
          try {
            await this.bot.sendMessage(adminId, `⚠️ Payment amount mismatch for VIP: user=${userId}, paid=${amountStars}, expected=${expected}, planId=${planId || 'none'}, days=${days || 'none'}, charge=${telegramChargeId}`);
          } catch (err) {
            console.error('Failed to send VIP amount mismatch alert to admin:', err?.message);
          }
        }
        await this.bot.sendMessage(userId, '❌ Payment amount does not match the VIP pricing. Please contact support.');
        return;
      }
    } else if (payload.type === 'LOCK') {
      const duration = parseInt(payload.duration || '5');
      const lockPricing = await starsPricing.getLockPricing();
      const expected = lockPricing[duration];
      if (!expected || expected !== amountStars) {
        if (adminId && require('../config/featureFlags').isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
          try {
            await this.bot.sendMessage(adminId, `⚠️ Payment amount mismatch for LOCK: user=${userId}, paid=${amountStars}, expected=${expected}, duration=${duration}, charge=${telegramChargeId}`);
          } catch (err) {
            console.error('Failed to send LOCK amount mismatch alert to admin:', err?.message);
          }
        }
        await this.bot.sendMessage(userId, '❌ Payment amount does not match the Lock pricing. Please contact support.');
        return;
      }
    }

    // Transactional processing (DB operations only)
    const t = await sequelize.transaction();
    let postActions = [];
    try {
      const createdPayment = await Payment.create({ userId, telegramChargeId, amount: amountStars, currency: payment.currency, payload: JSON.stringify(payload) }, { transaction: t });

      // Affiliate reward crediting (inside transaction, idempotent) - non-fatal
      try {
        const AffiliateService = require('../services/affiliateService');
        await AffiliateService.creditAffiliate(userId, createdPayment.id || createdPayment.userId || telegramChargeId, amountStars, payload.type, { transaction: t });
      } catch (err) {
        console.error('Affiliate crediting failed (non-fatal):', err);
      }

      // Route payment (DB changes inside transaction; defer Redis side-effects until after commit)
      if (payload.type === 'VIP' && featureFlags.isFeatureEnabled('ENABLE_VIP')) {
        // Support both old format (days) and new format (planId)
        let days;
        const vipPlans = await starsPricing.getVipPlans();
        if (payload.planId && vipPlans[payload.planId]) {
          days = vipPlans[payload.planId].days;
        } else {
          days = parseInt(payload.days || '7');
        }
        // Defer setting Redis key until after commit
        const expiry = await VipService.activateVip(userId, days, { source: 'stars', transaction: t, deferSetRedis: true });
        postActions.push(async () => {
          // set Redis key for vip after commit
          await VipService.setRedisVip(userId, expiry);
          const planName = payload.planId || 'VIP';
          await this.bot.sendMessage(userId, `✅ VIP ${planName} activated for ${days} day(s). Enjoy priority matching!`);
        });
      } else if (payload.type === 'LOCK' && featureFlags.isFeatureEnabled('ENABLE_LOCK_CHAT')) {
        const duration = parseInt(payload.duration || '5');
        // For lock purchases, create LockCredit instead of activating lock directly
        // User can use credits later when they want to lock a chat
        const LockCredit = require('../models/lockCreditModel');
        await LockCredit.create({ 
          telegramId: userId, 
          minutes: duration, 
          consumed: 0 
        }, { transaction: t });
        postActions.push(async () => {
          await this.bot.sendMessage(userId, `✅ Lock Credits added: ${duration} minutes. Use "🔒 Lock Chat" during a chat to activate.`);
        });
      } else {
        await this.bot.sendMessage(userId, 'Payment received, but could not route to any feature. Please contact admin.');
      }

      // Referral processing (if enabled) - referrals are DB ops and can be inside txn
      if (require('../config/featureFlags').isFeatureEnabled('ENABLE_REFERRALS')) {
        const referralPost = await ReferralService.processReferralForPayment(userId, payment, { transaction: t });
        if (Array.isArray(referralPost) && referralPost.length > 0) {
          postActions.push(...referralPost);
        }
      }

      await t.commit();

      // Execute deferred post-commit actions (Redis, messages)
      for (const fn of postActions) {
        try { await fn(); } catch (err) { console.error('Post-action error:', err); }
      }

      // Persist payment log
      try {
        const logLine = JSON.stringify({ ts: new Date().toISOString(), userId, type: payload.type || 'unknown', amount: amountStars, currency: payment.currency, telegramChargeId }) + '\n';
        fs.appendFileSync('logs/payments.log', logLine);
      } catch (err) { console.error('Failed writing payment log:', err); }

      // Notify admin about payment
      if (adminId && require('../config/featureFlags').isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
        try {
          await this.bot.sendMessage(adminId, `💳 Payment: user=${userId}, type=${payload.type || 'unknown'}, amount=${amountStars} ${payment.currency}`);
        } catch (err) {
          console.error('Failed to send payment notification to admin:', err?.message);
        }
      }

    } catch (err) {
      await t.rollback();
      console.error('Payment processing failed:', err);
      await this.bot.sendMessage(userId, '❌ Payment processing failed. Please contact support.');
    }
  }
}

module.exports = PaymentService;
module.exports.Payment = Payment;
