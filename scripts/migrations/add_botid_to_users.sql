-- Add botId and botName columns to User table to track which bot user joined from
-- Multi-bot federation support: allows users from different bots to match with each other
-- botId: identifier of the bot they joined from (e.g., 'bot_0', 'bot_1')
-- botName: human-readable name (e.g., 'Unknown meet bot', 'Random chat bot')

ALTER TABLE "User" ADD COLUMN "botId" VARCHAR(50) DEFAULT 'default';
ALTER TABLE "User" ADD COLUMN "botName" VARCHAR(100);

-- Index for querying users by bot (useful for admin dashboard)
CREATE INDEX idx_user_botid ON "User"("botId");
