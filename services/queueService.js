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
      // TODO: implement actual broadcast fan-out worker here
      console.log(`🟡 [memory-queue] accepted broadcast job ${job.id} audience=${job.data.audience || 'all'}`);
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
  getQueue
};
