-- Manual migration: create LockCredits table to store lock-minute credits
-- Run once on production: sqlite3 ./chatbot.db ".read create-lock-credits.sql"

CREATE TABLE IF NOT EXISTS LockCredits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId BIGINT NOT NULL,
  minutes INTEGER NOT NULL,
  remainingMinutes INTEGER NOT NULL,
  source TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lockcredits_user ON LockCredits(userId);