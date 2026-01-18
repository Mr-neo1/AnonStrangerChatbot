module.exports = {
  // Backwards-compatible constants
  QUEUE_VIP: 'queue:vip',
  QUEUE_GENERAL: 'queue:general',

  // Namespaced queue helpers (per-bot)
  QUEUE_VIP_KEY: (botId) => `queue:${botId}:vip`,
  QUEUE_GENERAL_KEY: (botId) => `queue:${botId}:general`,

  // New prioritized VIP and Free queues (per-bot)
  QUEUE_VIP_ANY_KEY: (botId) => `queue:${botId}:vip:any`,
  QUEUE_VIP_GENDER_KEY: (botId, gender) => `queue:${botId}:vip:${String(gender).toLowerCase()}`,
  QUEUE_FREE_KEY: (botId) => `queue:${botId}:free:any`,
  QUEUE_ALL_VIP_KEYS: (botId) => [`queue:${botId}:vip:male`, `queue:${botId}:vip:female`, `queue:${botId}:vip:any`],
  QUEUE_ALL_KEYS: (botId) => [`queue:${botId}:vip:male`, `queue:${botId}:vip:female`, `queue:${botId}:vip:any`, `queue:${botId}:free:any`, `queue:${botId}:vip`, `queue:${botId}:general`],

  PAIR: (chatId) => `pair:${chatId}`,
  USER_VIP: (userId) => `user:vip:${userId}`,
  USER_RECENT: (userId) => `user:recentPartners:${userId}`,
  CHAT_LOCK: (chatId, userId) => `chat:locks:${chatId}:${userId}`,
  LOCK_TIMER: (chatId, userId) => `lock:timer:${chatId}:${userId}`,
};