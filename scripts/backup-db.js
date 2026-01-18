#!/usr/bin/env node
// Simple DB backup for SQLite or Postgres (Telegram bot data)
// - SQLite: copies the DB file to ./backups
// - Postgres: uses pg_dump to ./backups
// - If backup > 500MB: send to admin via Telegram, delete local copy

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' });

const MAX_BACKUP_SIZE = 500 * 1024 * 1024; // 500MB

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}

async function sendBackupToAdmin(filePath, fileName) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    const adminId = process.env.ADMIN_CONTROL_CHAT_ID || process.env.ADMIN_CHAT_ID;
    if (!adminId) {
      console.warn(' No admin ID; skipping backup send');
      return;
    }
    const token = (process.env.BOT_TOKENS || process.env.BOT_TOKEN || '').split(',')[0];
    if (!token) {
      console.warn(' No bot token; skipping backup send');
      return;
    }
    
    const bot = new TelegramBot(token, { polling: false });
    const fileSize = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
    await bot.sendDocument(adminId, filePath, {
      caption: `📦 Backup: ${fileName} (${fileSize}MB). Delete local copy after processing.`
    });
    console.log(`✅ Backup (${fileSize}MB) sent to admin; deleting local copy`);
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error(' Failed to send backup to admin:', err && err.message);
  }
}

function backupSqlite(dbPath) {
  const backupsDir = path.join(__dirname, '..', 'backups');
  ensureDir(backupsDir);
  const dest = path.join(backupsDir, `sqlite-backup-${timestamp()}.db`);
  fs.copyFileSync(dbPath, dest);
  const stat = fs.statSync(dest);
  
  if (stat.size > MAX_BACKUP_SIZE) {
    console.log(`⚠️ SQLite backup (${(stat.size / 1024 / 1024).toFixed(2)}MB) exceeds 500MB; sending to admin...`);
    sendBackupToAdmin(dest, path.basename(dest)).catch(() => {});
  } else {
    console.log(`✅ SQLite backup created at ${dest} (${(stat.size / 1024 / 1024).toFixed(2)}MB)`);
  }
}

function backupPostgres(uri) {
  const backupsDir = path.join(__dirname, '..', 'backups');
  ensureDir(backupsDir);
  const dest = path.join(backupsDir, `pg-backup-${timestamp()}.sql`);

  const dump = spawnSync('pg_dump', ['--dbname', uri], { encoding: 'utf-8' });
  if (dump.status !== 0) {
    console.error(`❌ pg_dump failed:`, dump.stderr || dump.stdout || `exit code ${dump.status}`);
    process.exit(1);
  }
  fs.writeFileSync(dest, dump.stdout, 'utf-8');
  const stat = fs.statSync(dest);
  
  if (stat.size > MAX_BACKUP_SIZE) {
    console.log(`⚠️ Postgres backup (${(stat.size / 1024 / 1024).toFixed(2)}MB) exceeds 500MB; sending to admin...`);
    sendBackupToAdmin(dest, path.basename(dest)).catch(() => {});
  } else {
    console.log(`✅ Postgres backup created at ${dest} (${(stat.size / 1024 / 1024).toFixed(2)}MB)`);
  }
}

async function main() {
  const sqlitePath = process.env.SQLITE_DB_PATH;
  const pgUri = process.env.POSTGRES_URI;

  if (sqlitePath && fs.existsSync(sqlitePath)) {
    backupSqlite(sqlitePath);
    return;
  }

  if (pgUri) {
    backupPostgres(pgUri);
    return;
  }

  console.error('❌ No database configured for backup. Set SQLITE_DB_PATH or POSTGRES_URI.');
  process.exit(1);
}

main().catch((err) => {
  console.error('❌ Backup failed:', err && err.message ? err.message : err);
  process.exit(1);
});
