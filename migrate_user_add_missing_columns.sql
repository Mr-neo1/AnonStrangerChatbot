-- One-time migration: add missing User columns expected by Sequelize model
-- IMPORTANT: This file must be run manually once using sqlite3 and reviewed before running.
-- Example: sqlite3 ./chatbot.db ".read migrate_user_add_missing_columns.sql"
-- Or: sqlite3 ./chatbot.db 'ALTER TABLE User ADD COLUMN vipGender TEXT DEFAULT NULL; ALTER TABLE User ADD COLUMN hasStarted INTEGER DEFAULT 0;'

-- Add vipGender (nullable text)
ALTER TABLE User ADD COLUMN vipGender TEXT DEFAULT NULL;

-- Add hasStarted (boolean stored as INTEGER 0/1)
ALTER TABLE User ADD COLUMN hasStarted INTEGER DEFAULT 0;

-- End of file
