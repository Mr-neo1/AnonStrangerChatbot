module.exports = {
  // User gender options
  GENDER: ['Male', 'Female', 'Other', 'Any'],
  
  // User status
  USER_STATUS: {
    IDLE: 'idle',
    SEARCHING: 'searching',
    CHATTING: 'chatting',
    BANNED: 'banned'
  },
  
  // Chat status
  CHAT_STATUS: {
    ACTIVE: 'active',
    ENDED: 'ended',
    LOCKED: 'locked'
  },
  
  // VIP sources
  VIP_SOURCE: {
    PAYMENT: 'payment',
    REFERRAL: 'referral',
    ADMIN_GRANT: 'admin_grant',
    AFFILIATE: 'affiliate'
  },
  
  // Payment types
  PAYMENT_TYPE: {
    VIP: 'vip',
    LOCK: 'lock',
    LOCK_CREDIT: 'lock_credit'
  },
  
  // Referral status
  REFERRAL_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    INVALID: 'invalid',
    REWARDED: 'rewarded'
  },
  
  // Error codes for consistent error handling
  ERROR_CODES: {
    // Auth errors (1xxx)
    UNAUTHORIZED: { code: 1001, message: 'Unauthorized access' },
    SESSION_EXPIRED: { code: 1002, message: 'Session has expired' },
    INVALID_CREDENTIALS: { code: 1003, message: 'Invalid credentials' },
    RATE_LIMITED: { code: 1004, message: 'Too many attempts, please try later' },
    
    // User errors (2xxx)
    USER_NOT_FOUND: { code: 2001, message: 'User not found' },
    USER_BANNED: { code: 2002, message: 'User is banned' },
    USER_NOT_IN_CHAT: { code: 2003, message: 'User is not in a chat' },
    USER_ALREADY_SEARCHING: { code: 2004, message: 'User is already searching' },
    
    // Chat errors (3xxx)
    CHAT_NOT_FOUND: { code: 3001, message: 'Chat not found' },
    CHAT_LOCKED: { code: 3002, message: 'Chat is locked' },
    CHAT_ENDED: { code: 3003, message: 'Chat has ended' },
    NO_PARTNER_FOUND: { code: 3004, message: 'No partner found' },
    
    // Payment errors (4xxx)
    PAYMENT_FAILED: { code: 4001, message: 'Payment failed' },
    INVALID_AMOUNT: { code: 4002, message: 'Invalid payment amount' },
    DUPLICATE_PAYMENT: { code: 4003, message: 'Payment already processed' },
    INSUFFICIENT_CREDITS: { code: 4004, message: 'Insufficient credits' },
    
    // Lock errors (5xxx)
    LOCK_LIMIT_REACHED: { code: 5001, message: 'Lock creation limit reached' },
    INVALID_LOCK_DURATION: { code: 5002, message: 'Invalid lock duration' },
    LOCK_NOT_FOUND: { code: 5003, message: 'Lock not found' },
    
    // System errors (9xxx)
    INTERNAL_ERROR: { code: 9001, message: 'Internal server error' },
    DATABASE_ERROR: { code: 9002, message: 'Database error' },
    REDIS_ERROR: { code: 9003, message: 'Cache error' },
    MAINTENANCE_MODE: { code: 9004, message: 'System is under maintenance' },
    FEATURE_DISABLED: { code: 9005, message: 'Feature is currently disabled' }
  },
  
  // Admin audit actions
  AUDIT_ACTIONS: {
    LOGIN: 'login',
    LOGOUT: 'logout',
    BAN_USER: 'ban_user',
    UNBAN_USER: 'unban_user',
    GRANT_VIP: 'grant_vip',
    REVOKE_VIP: 'revoke_vip',
    BROADCAST: 'broadcast',
    CONFIG_CHANGE: 'config_change',
    EXPORT_DATA: 'export_data',
    MAINTENANCE_TOGGLE: 'maintenance_toggle',
    BOT_RESTART: 'bot_restart'
  },
  
  // Maintenance status
  MAINTENANCE_STATUS: {
    SCHEDULED: 'scheduled',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  },
  
  // Queue types
  QUEUE_TYPE: {
    VIP: 'vip',
    FREE: 'free',
    GENERAL: 'general'
  }
};