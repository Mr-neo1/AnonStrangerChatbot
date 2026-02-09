-- Add missing columns to ScheduledMaintenance table
-- These columns exist in the model but not in the database

ALTER TABLE "ScheduledMaintenance" 
ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

ALTER TABLE "ScheduledMaintenance" 
ADD COLUMN IF NOT EXISTS "notifyUsers" BOOLEAN DEFAULT true;

ALTER TABLE "ScheduledMaintenance" 
ADD COLUMN IF NOT EXISTS "notificationSentAt" TIMESTAMP WITH TIME ZONE;

ALTER TABLE "ScheduledMaintenance" 
ADD COLUMN IF NOT EXISTS "notifyBeforeMinutes" INTEGER DEFAULT 30;

ALTER TABLE "ScheduledMaintenance" 
ADD COLUMN IF NOT EXISTS "userMessage" TEXT;
