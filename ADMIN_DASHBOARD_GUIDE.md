# Admin Dashboard Guide

## Overview

The Admin Dashboard is a lightweight web interface for managing bot configuration without restarting the bot. It uses Telegram-based authentication for security.

## Features

- **VIP/Subscription Pricing**: Set prices for 3 VIP tiers and duration
- **Lock Chat Pricing**: Configure prices for 5/10/15 minute lock sessions
- **Required Join Channel**: Set channel users must join before using the bot
- **Affiliate & Referral Settings**: Control commission rates and VIP day rewards
- **Admin Channels**: Configure where media, abuse reports, and logs are sent
- **Real-time Updates**: Changes apply immediately without bot restart
- **Secure Authentication**: Telegram ID-based login with one-time codes

## Setup

### 1. Install Dependencies

```bash
npm install
```

This will install Express.js and other required packages.

### 2. Configure Admin IDs

Edit your `.env.local` file and add admin Telegram IDs:

```bash
# Get your Telegram ID from @userinfobot
ADMIN_TELEGRAM_IDS=123456789,987654321
ADMIN_PORT=3000
```

### 3. Start the Dashboard

**Option A: With Bot (Recommended)**
```bash
node start-all.js
```

**Option B: Dashboard Only (for testing)**
```bash
npm run admin
```

**Option C: PM2 Cluster Mode**
```bash
pm2 start ecosystem.config.js --env production
```

The admin dashboard will be available at: **http://localhost:3000/admin/login**

## How to Login

### Step 1: Open the Login Page

Navigate to `http://localhost:3000/admin/login` in your browser.

### Step 2: Enter Your Telegram ID

1. Get your Telegram ID from @userinfobot
2. Enter it in the login form
3. Click "Get Login Code"

### Step 3: Verify with Bot

1. You'll receive a 6-digit code on the web page
2. Open Telegram and message your bot: `/admin_login 123456`
3. The bot will send you a success message
4. The web page will automatically redirect to the dashboard

### Step 4: Access Dashboard

You're now logged in! Your session lasts 24 hours.

## Using the Dashboard

### VIP Pricing Settings

Configure pricing for 3 VIP subscription tiers:

- **Price Tier 1**: Standard VIP price (default: 299 stars)
- **Price Tier 2**: Mid-tier VIP price (default: 399 stars)
- **Price Tier 3**: Premium VIP price (default: 499 stars)
- **VIP Duration**: Days of VIP access (default: 30 days)
- **Enable/Disable**: Toggle to turn VIP feature on/off

**Usage**: Change any price or duration → it saves automatically → bot uses new values immediately.

### Lock Chat Pricing

Configure pricing for timed lock chat sessions:

- **5 Minutes**: Price for 5-minute lock (default: 50 stars)
- **10 Minutes**: Price for 10-minute lock (default: 90 stars)
- **15 Minutes**: Price for 15-minute lock (default: 120 stars)
- **Enable/Disable**: Toggle lock chat feature

**Usage**: Adjust prices based on demand → changes apply instantly.

### Required Join Channel

Force users to join a channel before using the bot:

- **Channel Username**: E.g., `@yourchannel` or leave empty to disable
- **Enforce Requirement**: Toggle to enable/disable enforcement

**Usage**: Add channel → enable enforcement → users must join before chatting.

### Affiliate & Referral Settings

Configure rewards for user referrals:

- **Commission Rate**: Percentage of payment given to referrer (0.0 to 1.0)
  - Example: 0.8 = 80% commission
- **VIP Days Reward**: Days of VIP given to new users who join via referral
- **Enable/Disable**: Toggle referral system

**Usage**: Adjust commission to incentivize referrals → changes apply immediately.

### Admin Channels

Configure where the bot sends notifications:

- **Media Channel ID**: Where shared media is forwarded
- **Abuse Channel ID**: Where abuse reports are sent
- **Logs Channel ID**: Where system logs are posted

**Format**: Use channel IDs like `-1001234567890` (get from @username_to_id_bot)

## Security Features

### Session Management
- **Sessions expire after 24 hours**
- **Login codes expire after 5 minutes**
- **Rate limiting**: Maximum 5 login attempts per 15 minutes

### Admin Verification
- Only Telegram IDs in `ADMIN_TELEGRAM_IDS` can access the dashboard
- All config changes are logged with admin ID and timestamp

### Input Validation
- Prices must be between 0 and 10,000 stars
- Commission rates must be between 0.0 and 1.0
- Duration must be between 1 and 365 days

## API Endpoints (for developers)

### Authentication
- `POST /admin/api/request-login` - Request login code
- `POST /admin/api/complete-login` - Complete login (bot sends token)
- `POST /admin/api/logout` - End session

### Configuration
- `GET /admin/api/config` - Get all config values
- `POST /admin/api/config` - Update a config value

### Example API Call
```javascript
// Update VIP price
fetch('/admin/api/config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Token': 'your_session_token'
  },
  body: JSON.stringify({
    key: 'vip_price_299',
    value: 350
  })
});
```

## Configuration Keys Reference

### VIP Pricing
- `vip_price_299` - Tier 1 price (integer, stars)
- `vip_price_399` - Tier 2 price (integer, stars)
- `vip_price_499` - Tier 3 price (integer, stars)
- `vip_duration_days` - VIP duration (integer, 1-365)
- `vip_enabled` - Enable VIP (boolean)

### Lock Chat Pricing
- `lock_price_5min` - 5-minute price (integer, stars)
- `lock_price_10min` - 10-minute price (integer, stars)
- `lock_price_15min` - 15-minute price (integer, stars)
- `lock_enabled` - Enable lock chat (boolean)

### Required Channel
- `required_channel` - Channel username or ID (string)
- `enforce_channel` - Enforce requirement (boolean)

### Referral
- `referral_commission` - Commission rate (float, 0.0-1.0)
- `referral_vip_days` - VIP days reward (integer)
- `referral_enabled` - Enable referrals (boolean)

### Admin Channels
- `admin_media_channel` - Media channel ID (string)
- `admin_abuse_channel` - Abuse channel ID (string)
- `admin_logs_channel` - Logs channel ID (string)

## Troubleshooting

### Can't Access Dashboard

**Problem**: Page doesn't load at http://localhost:3000

**Solution**:
1. Check if admin server is running: `npm run admin`
2. Check port in `.env.local`: `ADMIN_PORT=3000`
3. Try different port if 3000 is occupied

### Login Code Doesn't Work

**Problem**: Bot says "Invalid code" or "Code expired"

**Solution**:
1. Make sure your Telegram ID is in `ADMIN_TELEGRAM_IDS`
2. Code expires after 5 minutes - get a new one
3. Check you're sending to the correct bot
4. Verify command format: `/admin_login 123456` (6 digits)

### Changes Not Applied

**Problem**: Updated config but bot still uses old values

**Solution**:
1. Check browser console for errors
2. Verify you have a valid session (refresh page)
3. Check database: `SELECT * FROM app_config;`
4. Bot reads config on each use - no restart needed

### Session Expired

**Problem**: "Invalid or expired session" error

**Solution**:
1. Sessions last 24 hours - login again
2. Clear browser cookies and re-login
3. Check system time is correct

## Best Practices

### Price Adjustments
- **Test with small changes first**: Adjust by 10-20% initially
- **Monitor user behavior**: Check if pricing affects engagement
- **Use tiers strategically**: Price Tier 3 should be compelling value

### Channel Enforcement
- **Give users time**: Enable enforcement gradually
- **Communicate clearly**: Tell users why they need to join
- **Keep channel active**: Post valuable content

### Referral Tuning
- **Start conservative**: Begin with 0.5 (50%) commission
- **Monitor abuse**: High commissions may attract spam referrals
- **Balance rewards**: More VIP days = more engagement

### Security
- **Limit admin access**: Only add trusted Telegram IDs
- **Monitor logs**: Check who's making config changes
- **Use HTTPS in production**: Never use HTTP for real deployments

## Production Deployment

### Using NGINX Reverse Proxy

```nginx
server {
    listen 80;
    server_name admin.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Using PM2 with Ecosystem File

The `ecosystem.config.js` already includes admin dashboard startup:

```javascript
// ecosystem.config.js automatically starts start-all.js
// which runs both bot and admin dashboard
```

### Environment Variables for Production

```bash
NODE_ENV=production
ADMIN_PORT=3000
ADMIN_TELEGRAM_IDS=your_real_telegram_id
POSTGRES_URI=postgresql://user:pass@db:5432/botdb
```

## Support

For issues or questions:
1. Check this guide first
2. Review logs: `pm2 logs` or `npm run logs`
3. Check [bot.js](bot.js) and [server.js](server.js) for implementation details
4. Verify database: Ensure `app_config` table exists

## Architecture Notes

### How It Works

1. **Admin opens dashboard** → Express serves HTML page
2. **Admin requests login** → Server generates 6-digit code
3. **Admin sends code to bot** → Bot verifies admin ID, creates session token
4. **Admin receives token** → Bot sends token via Telegram message
5. **Browser stores token** → Used in API calls via X-Admin-Token header
6. **Admin updates config** → Saved to `app_config` table
7. **Bot reads config** → Dynamically loaded on each request, no restart

### Why No Cookie-Based Auth?

We use header-based tokens (`X-Admin-Token`) instead of cookies for simplicity and compatibility with various deployment scenarios.

### Why In-Memory Sessions?

For single-server VPS deployments, in-memory session storage is:
- Fast (no database round trips)
- Simple (no Redis dependency)
- Sufficient (sessions auto-clean after 24h)

For multi-server deployments, migrate to Redis-based sessions.

---

**Dashboard URL**: http://localhost:3000/admin/login
**Health Check**: http://localhost:3000/health
**Bot Command**: `/admin_login <6-digit-code>`
