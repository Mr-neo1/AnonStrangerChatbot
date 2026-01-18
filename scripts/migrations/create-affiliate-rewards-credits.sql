-- Manual migration: create AffiliateRewardCredits table to store affiliate reward credits
-- Run once on production: sqlite3 ./chatbot.db ".read create-affiliate-rewards-credits.sql"

CREATE TABLE IF NOT EXISTS AffiliateRewardCredits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrerTelegramId BIGINT NOT NULL,
  sourcePaymentId TEXT NOT NULL,
  rewardType TEXT NOT NULL,
  rewardValue INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_sourcePaymentId ON AffiliateRewardCredits(sourcePaymentId);
CREATE INDEX IF NOT EXISTS idx_affiliate_referrer ON AffiliateRewardCredits(referrerTelegramId);
