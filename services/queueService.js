const config = require('../config/config');

let queueImpl = null;
let implType = 'memory';

function initBullQueue() {
  try {
    const Queue = require('bull');
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    if (redisUrl.startsWith('memory://')) {
      return null; // Bull cannot run on memory adapter
    }
    const q = new Queue('broadcast-queue', redisUrl);
    
    // Set up processor for Bull queue
    q.process(async (job) => {
      await processBroadcast(job.data);
    });
    
    implType = 'bull';
    return q;
  } catch (err) {
    return null;
  }
}

function initMemoryQueue() {
  const pending = [];
  let processing = false;

  const processNext = async () => {
    if (processing) return;
    const job = pending.shift();
    if (!job) return;
    processing = true;
    try {
      // Implement actual broadcast fan-out worker
      await processBroadcast(job.data);
      console.log(`✅ [memory-queue] Broadcast job ${job.id} completed (audience=${job.data.audience || 'all'})`);
    } catch (err) {
      console.error(`❌ [memory-queue] Broadcast job ${job.id} failed:`, err.message);
    } finally {
      processing = false;
      setImmediate(processNext);
    }
  };

  return {
    add: async (data) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      pending.push({ id, data });
      setImmediate(processNext);
      return { id };
    },
    getImplType: () => 'memory'
  };
}

// Process broadcast - send messages to users
async function processBroadcast(data) {
  const { message, audience = 'all', meta = {} } = data;
  const { User, VipSubscription } = require('../models');
  const { Op } = require('sequelize');
  const { getAllBots } = require('../bots');
  const bots = getAllBots();
  
  if (!bots || bots.length === 0) {
    throw new Error('No bot instances available');
  }
  
  // Build user query based on audience
  const where = {};
  if (audience === 'vip') {
    // Get VIP user IDs
    const vipUsers = await VipSubscription.findAll({
      where: { expiresAt: { [Op.gt]: new Date() } },
      attributes: ['userId']
    });
    const vipUserIds = vipUsers.map(v => v.userId);
    if (vipUserIds.length === 0) {
      console.log('No VIP users found');
      return;
    }
    where.userId = { [Op.in]: vipUserIds };
  } else if (audience === 'free') {
    // Get non-VIP users
    const vipUsers = await VipSubscription.findAll({
      where: { expiresAt: { [Op.gt]: new Date() } },
      attributes: ['userId']
    });
    const vipUserIds = vipUsers.map(v => v.userId);
    if (vipUserIds.length > 0) {
      where.userId = { [Op.notIn]: vipUserIds };
    }
  }
  
  // Get users (paginated to avoid memory issues)
  const limit = 100;
  let offset = 0;
  let totalSent = 0;
  let totalFailed = 0;
  
  while (true) {
    const users = await User.findAll({
      where,
      limit,
      offset,
      attributes: ['userId', 'telegramId', 'botId']
    });
    
    if (users.length === 0) break;
    
    // Send messages in parallel (batched)
    const sendPromises = users.map(async (user) => {
      try {
        // Get bot for this user
        const bot = bots.find(b => b._meta?.botId === user.botId) || bots[0];
        await bot.sendMessage(user.telegramId, `📢 ${message}`).catch(() => {
          throw new Error('Send failed');
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
    
    const results = await Promise.all(sendPromises);
    totalSent += results.filter(r => r.success).length;
    totalFailed += results.filter(r => !r.success).length;
    
    offset += limit;
    
    // Small delay to avoid rate limits
    if (users.length === limit) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.log(`📢 Broadcast completed: ${totalSent} sent, ${totalFailed} failed`);
}

function getQueue() {
  if (queueImpl) return queueImpl;
  queueImpl = initBullQueue();
  if (queueImpl) return queueImpl;
  queueImpl = initMemoryQueue();
  return queueImpl;
}

async function enqueueBroadcast({ message, audience = 'all', meta = {} }) {
  const q = getQueue();
  const payload = { message, audience, meta, requestedBy: meta.requestedBy || 'admin' };
  const job = await q.add(payload);
  return { id: job.id, impl: implType };
}

module.exports = {
  enqueueBroadcast,
  getQueue,
  processBroadcast
};
