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
  } else if (audience === 'free' || audience === 'non-vip') {
    // Get non-VIP users
    const vipUsers = await VipSubscription.findAll({
      where: { expiresAt: { [Op.gt]: new Date() } },
      attributes: ['userId']
    });
    const vipUserIds = vipUsers.map(v => v.userId);
    if (vipUserIds.length > 0) {
      where.userId = { [Op.notIn]: vipUserIds };
    }
  } else if (audience === 'active') {
    // Users active in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    where.lastActiveAt = { [Op.gte]: sevenDaysAgo };
  }
  
  // Get users (paginated to avoid memory issues)
  const limit = 100;
  let offset = 0;
  let totalSent = 0;
  let totalFailed = 0;
  
  // Decode media buffer if present
  let mediaBuffer = null;
  if (data.media && data.media.buffer) {
    try {
      mediaBuffer = Buffer.from(data.media.buffer, 'base64');
    } catch (e) {
      console.error('Failed to decode media buffer:', e.message);
    }
  }
  
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
        
        // Send media with caption if present, otherwise just text
        if (mediaBuffer && data.media) {
          const caption = message ? `📢 ${message}` : '';
          const fileOptions = { 
            filename: data.media.originalname || `broadcast_${Date.now()}`,
            contentType: data.media.mimetype
          };
          
          if (data.media.type === 'photo') {
            await bot.sendPhoto(user.telegramId, mediaBuffer, { caption }, fileOptions);
          } else if (data.media.type === 'video') {
            await bot.sendVideo(user.telegramId, mediaBuffer, { caption }, fileOptions);
          } else {
            await bot.sendDocument(user.telegramId, mediaBuffer, { caption }, fileOptions);
          }
        } else {
          await bot.sendMessage(user.telegramId, `📢 ${message}`);
        }
        
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
  
  const mediaInfo = data.media ? ` (with ${data.media.type})` : '';
  console.log(`📢 Broadcast completed${mediaInfo}: ${totalSent} sent, ${totalFailed} failed`);
}

function getQueue() {
  if (queueImpl) return queueImpl;
  queueImpl = initBullQueue();
  if (queueImpl) return queueImpl;
  queueImpl = initMemoryQueue();
  return queueImpl;
}

async function enqueueBroadcast({ message, audience = 'all', meta = {}, media = null }) {
  const q = getQueue();
  const payload = { message, audience, meta, media, requestedBy: meta.requestedBy || 'admin' };
  const job = await q.add(payload);
  return { id: job.id, impl: implType };
}

module.exports = {
  enqueueBroadcast,
  getQueue,
  processBroadcast
};
