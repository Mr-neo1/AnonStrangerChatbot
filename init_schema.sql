-- Users / Telegram account data
CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId BIGINT NOT NULL UNIQUE,
  telegramId BIGINT NOT NULL,
  botId TEXT DEFAULT 'default',
  botName TEXT,
  gender TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
  vipGender TEXT DEFAULT 'Any' CHECK(vipGender IN ('Male', 'Female', 'Other', 'Any')),
  hasStarted INTEGER DEFAULT 0,
  age INTEGER,
  banned INTEGER DEFAULT 0,
  totalChats INTEGER DEFAULT 0,
  dailyStreak INTEGER DEFAULT 0,
  lastActiveDate TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Core: Chats / pairing history
CREATE TABLE IF NOT EXISTS Chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user1 INTEGER NOT NULL,
  user2 INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Lock / disconnect history
CREATE TABLE IF NOT EXISTS Locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chatId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  durationMinutes INTEGER NOT NULL,
  startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  expiresAt DATETIME,
  starsPaid INTEGER,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- VIP subscriptions
CREATE TABLE IF NOT EXISTS VipSubscriptions (
  userId INTEGER PRIMARY KEY,
  expiresAt DATETIME NOT NULL,
  source TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Star transactions / Payments
CREATE TABLE IF NOT EXISTS StarTransactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  telegramChargeId TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payload TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  amount INTEGER,
  currency TEXT,
  payload TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Referrals
CREATE TABLE IF NOT EXISTS Referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviterId INTEGER NOT NULL,
  invitedId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Affiliate rewards
CREATE TABLE IF NOT EXISTS AffiliateRewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  vipDaysGranted INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'affiliate_payment',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bans / moderation
CREATE TABLE IF NOT EXISTS Bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  reason TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Reports
CREATE TABLE IF NOT EXISTS Reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporterId INTEGER,
  reportedId INTEGER,
  chatId INTEGER,
  reason TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Optional multi-bot metadata (additive only)
CREATE TABLE IF NOT EXISTS Bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_token_hash TEXT UNIQUE,
  bot_name TEXT,
  bot_index INTEGER,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Application Configuration
CREATE TABLE IF NOT EXISTS app_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Affiliate Reward Credits (credit pool for redemption)
CREATE TABLE IF NOT EXISTS AffiliateRewardCredits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrerTelegramId INTEGER NOT NULL,
  sourcePaymentId TEXT NOT NULL UNIQUE,
  rewardType TEXT NOT NULL CHECK(rewardType IN ('VIP_DAYS', 'LOCK_MINUTES')),
  rewardValue INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE', 'REDEEMED')),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin panel tables
CREATE TABLE IF NOT EXISTS AdminSessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adminId INTEGER NOT NULL,
  ip TEXT,
  userAgent TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  expiresAt DATETIME
);

CREATE TABLE IF NOT EXISTS AdminActions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adminId INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS BotStatus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  botId TEXT NOT NULL,
  status TEXT NOT NULL,
  lastError TEXT,
  uptimeSeconds INTEGER DEFAULT 0,
  polling BOOLEAN DEFAULT 0,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS VipPlans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  priceStars INTEGER NOT NULL,
  durationDays INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  content TEXT NOT NULL,
  filters TEXT,
  scheduledAt DATETIME,
  status TEXT DEFAULT 'draft',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS BroadcastStats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcastId INTEGER NOT NULL,
  delivered INTEGER DEFAULT 0,
  readCount INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS WebhookLogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT,
  targetUrl TEXT,
  statusCode INTEGER,
  responseTimeMs INTEGER,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ApiKeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  apiKey TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chat Ratings (user feedback system)
CREATE TABLE IF NOT EXISTS ChatRatings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chatId INTEGER NOT NULL,
  raterId INTEGER NOT NULL,
  ratedId INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  feedback TEXT,
  reportReason TEXT,
  isReport INTEGER DEFAULT 0,
  reviewedByAdmin INTEGER DEFAULT 0,
  adminAction TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Lock Credits (pre-purchased lock credits)
CREATE TABLE IF NOT EXISTS LockCredits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegramId BIGINT NOT NULL,
  minutes INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin Audit Logs (track admin actions)
CREATE TABLE IF NOT EXISTS AdminAuditLog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adminId TEXT NOT NULL,
  action TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  targetType TEXT,
  targetId TEXT,
  details TEXT,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Analytics Stats (daily aggregated statistics)
CREATE TABLE IF NOT EXISTS AnalyticsStats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL,
  metricName TEXT NOT NULL,
  metricValue INTEGER DEFAULT 0,
  metricMeta TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, metricName)
);

-- Scheduled Maintenance windows
CREATE TABLE IF NOT EXISTS ScheduledMaintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  startTime DATETIME NOT NULL,
  endTime DATETIME NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'active', 'completed', 'cancelled')),
  notifyUsers INTEGER DEFAULT 1,
  createdBy TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin Login Tokens (for secure admin sessions)
CREATE TABLE IF NOT EXISTS AdminLoginToken (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  adminId TEXT NOT NULL,
  telegramId BIGINT,
  ipAddress TEXT,
  userAgent TEXT,
  expiresAt DATETIME NOT NULL,
  lastUsedAt DATETIME,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_userId ON User(userId);
CREATE INDEX IF NOT EXISTS idx_user_banned ON User(banned);
CREATE INDEX IF NOT EXISTS idx_chats_user1 ON Chats(user1);
CREATE INDEX IF NOT EXISTS idx_chats_user2 ON Chats(user2);
CREATE INDEX IF NOT EXISTS idx_locks_chatId ON Locks(chatId);
CREATE INDEX IF NOT EXISTS idx_vip_userId ON VipSubscriptions(userId);
CREATE INDEX IF NOT EXISTS idx_startransactions_userId ON StarTransactions(userId);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON Referrals(inviterId);
CREATE INDEX IF NOT EXISTS idx_affiliate_user ON AffiliateRewards(userId);
CREATE INDEX IF NOT EXISTS idx_affiliate_credits_referrer ON AffiliateRewardCredits(referrerTelegramId);
CREATE INDEX IF NOT EXISTS idx_affiliate_credits_status ON AffiliateRewardCredits(status);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON AdminSessions(adminId);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON AdminActions(adminId);
CREATE INDEX IF NOT EXISTS idx_bot_status_botid ON BotStatus(botId);
CREATE INDEX IF NOT EXISTS idx_vip_plans_active ON VipPlans(active);
CREATE INDEX IF NOT EXISTS idx_broadcast_stats_broadcast ON BroadcastStats(broadcastId);
CREATE INDEX IF NOT EXISTS idx_bans_user ON Bans(userId);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON Reports(reportedId);
CREATE INDEX IF NOT EXISTS idx_bots_index ON Bots(bot_index);
CREATE INDEX IF NOT EXISTS idx_chatratings_chatId ON ChatRatings(chatId);
CREATE INDEX IF NOT EXISTS idx_chatratings_ratedId ON ChatRatings(ratedId);
CREATE INDEX IF NOT EXISTS idx_chatratings_isReport ON ChatRatings(isReport);
CREATE INDEX IF NOT EXISTS idx_lockcredits_telegramId ON LockCredits(telegramId);
CREATE INDEX IF NOT EXISTS idx_adminauditlog_adminId ON AdminAuditLog(adminId);
CREATE INDEX IF NOT EXISTS idx_adminauditlog_action ON AdminAuditLog(action);
CREATE INDEX IF NOT EXISTS idx_adminauditlog_createdAt ON AdminAuditLog(createdAt);
CREATE INDEX IF NOT EXISTS idx_analyticsstats_date ON AnalyticsStats(date);
CREATE INDEX IF NOT EXISTS idx_analyticsstats_metric ON AnalyticsStats(metricName);
CREATE INDEX IF NOT EXISTS idx_scheduledmaintenance_status ON ScheduledMaintenance(status);
CREATE INDEX IF NOT EXISTS idx_scheduledmaintenance_startTime ON ScheduledMaintenance(startTime);
CREATE INDEX IF NOT EXISTS idx_adminlogintoken_token ON AdminLoginToken(token);
CREATE INDEX IF NOT EXISTS idx_adminlogintoken_adminId ON AdminLoginToken(adminId);
CREATE INDEX IF NOT EXISTS idx_referrals_invitedId ON Referrals(invitedId);
