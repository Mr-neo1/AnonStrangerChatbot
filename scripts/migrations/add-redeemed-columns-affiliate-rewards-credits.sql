-- Manual migration: add redeemedAt and redeemedByAction to AffiliateRewardCredits
-- Run once on production if needed: sqlite3 ./chatbot.db ".read add-redeemed-columns-affiliate-rewards-credits.sql"

ALTER TABLE AffiliateRewardCredits ADD COLUMN redeemedAt DATETIME DEFAULT NULL;
ALTER TABLE AffiliateRewardCredits ADD COLUMN redeemedByAction TEXT DEFAULT NULL;