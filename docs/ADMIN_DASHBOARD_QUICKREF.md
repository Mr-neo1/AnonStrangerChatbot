# Admin Dashboard Quick Reference

## Access
- URL: http://localhost:3000/admin/login
- Auth: Telegram ID only (IDs in ADMIN_TELEGRAM_IDS)
- Login flow: request 6-digit code on web → send /admin_login <code> to bot → auto-redirect
- Session: 24 hours; codes expire in 5 minutes; rate limit 5 attempts / 15 minutes

## Start Commands
- Bot + Dashboard: node start-all.js
- Dashboard only: npm run admin
- PM2 production: pm2 start ecosystem.config.js --env production

## Environment Keys (required)
- BOT_TOKEN, POSTGRES_URI (or DATABASE_URL), ADMIN_TELEGRAM_IDS
- Optional: ADMIN_PORT (default 3000), ADMIN_CHAT_ID, ADMIN_CONTROL_CHAT_ID, ADMIN_MEDIA_CHANNEL_ID, ADMIN_ABUSE_CHANNEL_ID, ADMIN_LOGS_CHANNEL_ID

## Config Keys (stored in app_config)
- VIP: vip_price_299, vip_price_399, vip_price_499, vip_duration_days, vip_enabled
- Lock Chat: lock_price_5min, lock_price_10min, lock_price_15min, lock_enabled
- Required Channel: required_channel, enforce_channel
- Referral/Affiliate: referral_commission, referral_vip_days, referral_enabled
- Admin Channels: admin_media_channel, admin_abuse_channel, admin_logs_channel

## Validation Rules
- Prices: 0–10000 (integers)
- VIP Duration: 1–365 days
- Commission: 0.0–1.0 (float)
- Toggles: boolean
- Channel IDs/Usernames: strings (e.g., -1001234567890 or @channel)

## API Endpoints
- POST /admin/api/request-login    → { telegramId }
- POST /admin/api/complete-login   → { telegramId, code }
- GET  /admin/api/config           → returns all config
- POST /admin/api/config           → { key, value }
- POST /admin/api/logout           → ends session
- Auth header: X-Admin-Token: <sessionToken>

## Defaults (after migration)
- VIP: 299, 399, 499 stars; 30 days; enabled
- Lock Chat: 50/90/120 stars; enabled
- Required Channel: empty; enforcement off
- Referral: commission 0.8; vip days 10; enabled
- Admin Channels: empty

## Tables & Migration
- Table: app_config (key TEXT primary key, value TEXT, updatedAt timestamp)
- Migration: node scripts/migrations/add_app_config_table.js

## Logs & Health
- Health check: /health
- Server port: ADMIN_PORT or 3000
- Logs: pm2 logs or npm run logs (if configured)

## Security Checklist
- Use HTTPS behind NGINX in production
- Restrict port 3000 to localhost
- Keep ADMIN_TELEGRAM_IDS minimal
- Switch to PostgreSQL for production (POSTGRES_URI)
- Renew session daily; clear tokens if compromise suspected
