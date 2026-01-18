const User = require("../models/userModel");
const config = require('../config/config');
const { isFeatureEnabled } = require('../config/featureFlags');
const LockChatService = require('../services/lockChatService');
const VipService = require('../services/vipService');
const { Payment } = require('../services/paymentService') || {};

// Admin notifier registration (allows services to send admin alerts without creating bot instances)
let adminNotifier = null;
function registerAdminNotifier(fn) { adminNotifier = fn; }
async function notifyAdmin(text) { if (!adminNotifier) return; try { await adminNotifier(text); } catch (err) { console.error('notifyAdmin failed', err); } }

module.exports.registerAdminNotifier = registerAdminNotifier;
module.exports.notifyAdmin = notifyAdmin;

class AdminController {
  constructor(bot) {
    this.bot = bot;
    // Register notifier so other services can send admin alerts using this bot instance
    registerAdminNotifier(async (text) => {
      const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
      if (!adminId || !isFeatureEnabled('ENABLE_ADMIN_ALERTS')) return;
      try { await this.bot.sendMessage(adminId, text); } catch (err) { console.error('Admin alert send error:', err); }
    });
    this.initializeAdminCommands();
  }

  isAdmin(chatId) {
    const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
    if (!adminId) return false;
    return String(chatId) === String(adminId);
  }

  initializeAdminCommands() {
    // Protect admin commands with allowlist
    // /ban <userId>
    this.bot.onText(/\/ban (\d+)/, async (msg, match) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      const userIdToBan = match[1];
      try {
        const [user] = await User.findOrCreate({ where: { userId: userIdToBan } });
        await user.update({ banned: true });
        this.bot.sendMessage(msg.chat.id, `✅ User ${userIdToBan} has been banned.`);
      } catch (error) {
        console.error("Error in /ban:", error);
        this.bot.sendMessage(msg.chat.id, "Error banning user.");
      }
    });

    // /unban <userId>
    this.bot.onText(/\/unban (\d+)/, async (msg, match) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      const userIdToUnban = match[1];
      try {
        const user = await User.findOne({ where: { userId: userIdToUnban } });
        if (user) {
          await user.update({ banned: false });
          this.bot.sendMessage(msg.chat.id, `✅ User ${userIdToUnban} has been unbanned.`);
        } else {
          this.bot.sendMessage(msg.chat.id, "User not found.");
        }
      } catch (error) {
        console.error("Error in /unban:", error);
        this.bot.sendMessage(msg.chat.id, "Error unbanning user.");
      }
    });

    // /broadcast <message>
    this.bot.onText(/\/broadcast (.+)/, async (msg, match) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      const broadcastMsg = match[1];
      try {
        const users = await User.findAll();
        for (const user of users) {
          try { await this.bot.sendMessage(user.userId, `📢 Admin Broadcast: ${broadcastMsg}`); } catch (err) { /* continue */ }
        }
        this.bot.sendMessage(msg.chat.id, "✅ Broadcast job queued.");
      } catch (error) {
        console.error("Error in /broadcast:", error);
        this.bot.sendMessage(msg.chat.id, "Error sending broadcast.");
      }
    });

    // /stats - show basic counts
    this.bot.onText(/\/stats/, async (msg) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      try {
        const totalUsers = await User.count();
        const vipKeys = await (require('../database/redisClient').redisClient.keys)('user:vip:*');
        const vipCount = vipKeys ? vipKeys.length : 0;
        const reply = `📊 Stats\n\nTotal users: ${totalUsers}\nVIP users: ${vipCount}`;
        this.bot.sendMessage(msg.chat.id, reply);
      } catch (err) {
        console.error('/stats error', err);
        this.bot.sendMessage(msg.chat.id, 'Error fetching stats');
      }
    });

    // /locks - list active locks
    this.bot.onText(/\/locks/, async (msg) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      try {
        const locks = await LockChatService.getActiveLocks();
        if (!locks || locks.length === 0) return this.bot.sendMessage(msg.chat.id, 'No active locks');
        const lines = locks.map(l => `chat:${l.chatId} user:${l.userId} ttl:${l.ttl}s`);
        this.bot.sendMessage(msg.chat.id, `🔒 Active locks:\n\n${lines.join('\n')}`);
      } catch (err) {
        console.error('/locks error', err);
        this.bot.sendMessage(msg.chat.id, 'Error fetching locks');
      }
    });

    // /disconnect <chatId> - force disconnect a chat
    this.bot.onText(/\/disconnect (\d+)/, async (msg, match) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      const chatId = match[1];
      try {
        const redis = require('../database/redisClient').redisClient;
        const partner = await redis.get('pair:' + chatId);
        if (partner) {
          await redis.del('pair:' + partner);
          await redis.del('pair:' + chatId);
          const keys = require('../utils/redisKeys');
          const botId = require('../config/config').BOT_ID || 'default';
          await redis.lRem(keys.QUEUE_VIP_KEY(botId), 0, chatId.toString());
          await redis.lRem(keys.QUEUE_GENERAL_KEY(botId), 0, chatId.toString());
          await redis.lRem(keys.QUEUE_VIP_KEY(botId), 0, partner.toString());
          await redis.lRem(keys.QUEUE_GENERAL_KEY(botId), 0, partner.toString());
          await this.bot.sendMessage(chatId, '⚠️ You have been disconnected by an admin.');
          await this.bot.sendMessage(partner, '⚠️ Your partner was disconnected by an admin.');
          const adminId = config.ADMIN_CONTROL_CHAT_ID || config.ADMIN_CHAT_ID;
          if (adminId && isFeatureEnabled('ENABLE_ADMIN_ALERTS')) {
            await this.bot.sendMessage(adminId, `⚠️ Admin disconnected chat ${chatId} <-> ${partner}`);
          }
          this.bot.sendMessage(msg.chat.id, '✅ Disconnected');
        } else {
          this.bot.sendMessage(msg.chat.id, 'Chat not found.');
        }
      } catch (err) {
        console.error('/disconnect error', err);
        this.bot.sendMessage(msg.chat.id, 'Error disconnecting chat');
      }
    });

    // /vip_users - list vip users (basic)
    this.bot.onText(/\/vip_users/, async (msg) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      try {
        // simple scan of redis keys for speed
        const keys = await (require('../database/redisClient').redisClient.keys)('user:vip:*');
        const users = keys.map(k => k.split(':')[2]);
        this.bot.sendMessage(msg.chat.id, `⭐ VIP users:\n${users.join('\n')}`);
      } catch (err) {
        console.error('/vip_users error', err);
        this.bot.sendMessage(msg.chat.id, 'Error fetching vip users');
      }
    });

    // /payments - latest payments (simple)
    this.bot.onText(/\/payments/, async (msg) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      try {
        const PaymentModel = require('../services/paymentService').Payment || null;
        if (!PaymentModel) return this.bot.sendMessage(msg.chat.id, 'Payments not initialized');
        const payments = await PaymentModel.findAll({ limit: 20, order: [['createdAt', 'DESC']] });
        const lines = payments.map(p => `id:${p.id} user:${p.userId} amt:${p.amount}${p.currency} payload:${p.payload}`);
        this.bot.sendMessage(msg.chat.id, `💳 Recent payments:\n\n${lines.join('\n')}`);
      } catch (err) {
        console.error('/payments error', err);
        this.bot.sendMessage(msg.chat.id, 'Error fetching payments');
      }
    });

    // /export_users - export users as CSV (admin control chat only)
    this.bot.onText(/\/export_users/, async (msg) => {
      if (!config.ADMIN_CONTROL_CHAT_ID || String(msg.chat.id) !== String(config.ADMIN_CONTROL_CHAT_ID)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      try {
        const VipSubscription = require('../models/vipSubscriptionModel');
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const users = await User.findAll();
        const lines = [];
        lines.push('userId,telegramId,age,gender,vipStatus,vipExpiry,hasStarted,createdAt');
        for (const u of users) {
          const vip = await VipSubscription.findOne({ where: { userId: u.userId } });
          const vipStatus = (vip && new Date(vip.expiresAt) > new Date()) ? 'true' : 'false';
          const vipExpiry = vip && vip.expiresAt ? new Date(vip.expiresAt).toISOString() : '';
          const row = [u.userId || '', u.telegramId || '', u.age || '', u.gender || '', vipStatus, vipExpiry, u.hasStarted ? 'true' : 'false', u.createdAt ? new Date(u.createdAt).toISOString() : ''];
          lines.push(row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
        }
        const csv = lines.join('\n');
        const tmpFile = path.join(os.tmpdir(), `export_users_${Date.now()}.csv`);
        fs.writeFileSync(tmpFile, csv);
        const stream = fs.createReadStream(tmpFile);
        await this.bot.sendDocument(config.ADMIN_CONTROL_CHAT_ID, stream, {}, { filename: 'users.csv' });
        fs.unlinkSync(tmpFile);
        this.bot.sendMessage(msg.chat.id, '✅ Users export sent.');
      } catch (err) {
        console.error('/export_users error', err);
        this.bot.sendMessage(msg.chat.id, 'Error exporting users');
      }
    });

    // /export_payments - export payments as CSV (admin control chat only)
    this.bot.onText(/\/export_payments/, async (msg) => {
      if (!config.ADMIN_CONTROL_CHAT_ID || String(msg.chat.id) !== String(config.ADMIN_CONTROL_CHAT_ID)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      try {
        const StarTransaction = require('../models/starTransactionModel');
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const payments = await StarTransaction.findAll({ order: [['createdAt', 'DESC']] });
        const lines = [];
        lines.push('telegramChargeId,userId,starsAmount,purpose,createdAt');
        for (const p of payments) {
          let purpose = 'unknown';
          try { const pl = JSON.parse(p.payload || '{}'); purpose = pl.type || purpose; } catch (e) { purpose = String(p.payload || 'unknown'); }
          const row = [p.telegramChargeId || '', p.userId || '', p.amount || 0, purpose, p.createdAt ? new Date(p.createdAt).toISOString() : ''];
          lines.push(row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
        }
        const csv = lines.join('\n');
        const tmpFile = path.join(os.tmpdir(), `export_payments_${Date.now()}.csv`);
        fs.writeFileSync(tmpFile, csv);
        const stream = fs.createReadStream(tmpFile);
        await this.bot.sendDocument(config.ADMIN_CONTROL_CHAT_ID, stream, {}, { filename: 'payments.csv' });
        fs.unlinkSync(tmpFile);
        this.bot.sendMessage(msg.chat.id, '✅ Payments export sent.');
      } catch (err) {
        console.error('/export_payments error', err);
        this.bot.sendMessage(msg.chat.id, 'Error exporting payments');
      }
    });

    // /export_referrals - export referrals as CSV (admin control chat only)
    this.bot.onText(/\/export_referrals/, async (msg) => {
      if (!config.ADMIN_CONTROL_CHAT_ID || String(msg.chat.id) !== String(config.ADMIN_CONTROL_CHAT_ID)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      try {
        const Referral = require('../models/referralModel');
        const fs = require('fs'); const os = require('os'); const path = require('path');
        const referrals = await Referral.findAll({ order: [['createdAt', 'DESC']] });
        const lines = [];
        lines.push('inviterId,invitedId,status,createdAt');
        for (const r of referrals) {
          const row = [r.inviterId || '', r.invitedId || '', r.status || '', r.createdAt ? new Date(r.createdAt).toISOString() : ''];
          lines.push(row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
        }
        const csv = lines.join('\n');
        const tmpFile = path.join(os.tmpdir(), `export_referrals_${Date.now()}.csv`);
        fs.writeFileSync(tmpFile, csv);
        const stream = fs.createReadStream(tmpFile);
        await this.bot.sendDocument(config.ADMIN_CONTROL_CHAT_ID, stream, {}, { filename: 'referrals.csv' });
        fs.unlinkSync(tmpFile);
        this.bot.sendMessage(msg.chat.id, '✅ Referrals export sent.');
      } catch (err) {
        console.error('/export_referrals error', err);
        this.bot.sendMessage(msg.chat.id, 'Error exporting referrals');
      }
    });

    // /alerts - test alert
    this.bot.onText(/\/alerts/, async (msg) => {
      if (!this.isAdmin(msg.chat.id)) return this.bot.sendMessage(msg.chat.id, 'Admin commands are restricted');
      this.bot.sendMessage(msg.chat.id, '✅ Alerts are operational');
    });
  }
}

module.exports = AdminController;
module.exports.registerAdminNotifier = registerAdminNotifier;
module.exports.notifyAdmin = notifyAdmin;
