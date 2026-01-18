# 🎛️ Admin Dashboard - Quick Reference

## 🚀 Access
**URL**: http://localhost:3000/admin/login
**Login**: `/admin_login <code>` via Telegram bot
**Session**: 24 hours

## 📦 Configuration Keys

### 💎 VIP Pricing
| Setting | Key | Default | Range | Type |
|---------|-----|---------|-------|------|
| Tier 1 Price | `vip_price_299` | 299 | 0-10000 | stars |
| Tier 2 Price | `vip_price_399` | 399 | 0-10000 | stars |
| Tier 3 Price | `vip_price_499` | 499 | 0-10000 | stars |
| VIP Duration | `vip_duration_days` | 30 | 1-365 | days |
| Enable VIP | `vip_enabled` | true | - | boolean |

### 🔒 Lock Chat Pricing
| Setting | Key | Default | Range | Type |
|---------|-----|---------|-------|------|
| 5 Min Price | `lock_price_5min` | 50 | 0-10000 | stars |
| 10 Min Price | `lock_price_10min` | 90 | 0-10000 | stars |
| 15 Min Price | `lock_price_15min` | 120 | 0-10000 | stars |
| Enable Lock | `lock_enabled` | true | - | boolean |

### 📢 Required Channel
| Setting | Key | Default | Range | Type |
|---------|-----|---------|-------|------|
| Channel | `required_channel` | "" | - | string |
| Enforce | `enforce_channel` | false | - | boolean |

### 🤝 Referral System
| Setting | Key | Default | Range | Type |
|---------|-----|---------|-------|------|
| Commission | `referral_commission` | 0.8 | 0.0-1.0 | float |
| VIP Days | `referral_vip_days` | 10 | 0-365 | days |
| Enable | `referral_enabled` | true | - | boolean |

### 📡 Admin Channels
| Setting | Key | Default | Type |
|---------|-----|---------|------|
| Media Channel | `admin_media_channel` | "" | string |
| Abuse Channel | `admin_abuse_channel` | "" | string |
| Logs Channel | `admin_logs_channel` | "" | string |

## 🔐 Security

### Login Process
1. Enter Telegram ID → Get 6-digit code
2. Send `/admin_login <code>` to bot
3. Bot verifies → Creates session token
4. Auto-redirect to dashboard

### Session Security
- **Token Length**: 64 characters (hex)
- **Expiry**: 24 hours
- **Storage**: In-memory (Map)
- **Rate Limit**: 5 attempts / 15 minutes
- **Code Expiry**: 5 minutes

## 📊 Usage Scenarios

### Scenario 1: Adjust VIP Pricing
**Goal**: Increase Tier 1 price from 299 to 349 stars
1. Login to dashboard
2. Find "VIP Pricing" section
3. Change "Price Tier 1" to 349
4. Change auto-saves
5. ✅ New price active immediately

### Scenario 2: Require Channel Join
**Goal**: Force users to join @mychannel
1. Login to dashboard
2. Find "Required Join Channel" section
3. Enter "@mychannel" in channel field
4. Toggle "Enforce Requirement" to ON
5. ✅ Users must join before using bot

### Scenario 3: Disable Lock Chat
**Goal**: Temporarily disable lock chat feature
1. Login to dashboard
2. Find "Lock Chat Pricing" section
3. Toggle "Enable Lock Chat" to OFF
4. ✅ Lock chat disabled immediately

### Scenario 4: Update Referral Commission
**Goal**: Change commission from 80% to 60%
1. Login to dashboard
2. Find "Affiliate & Referral" section
3. Change "Commission Rate" to 0.6
4. ✅ New referrals get 60% commission

## 🛠️ Commands

### Start Dashboard
```bash
# With bot
node start-all.js

# Dashboard only
npm run admin

# PM2 cluster
pm2 start ecosystem.config.js
```

### Check Status
```bash
# Health check
curl http://localhost:3000/health

# PM2 status
pm2 status

# Logs
pm2 logs
```

### Database Queries
```sql
-- View all config
SELECT * FROM app_config;

-- Check VIP pricing
SELECT * FROM app_config WHERE key LIKE 'vip%';

-- Update config manually (emergency)
UPDATE app_config SET value = '450' WHERE key = 'vip_price_299';
```

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't access login page | Check server running: `pm2 status` |
| "Invalid code" error | Code expires in 5 min - get new one |
| Session expired | Re-login (sessions last 24h) |
| Changes not saving | Check browser console for errors |
| 401 Unauthorized | Verify ADMIN_TELEGRAM_IDS is set |
| Bot not responding | Check bot is running: `pm2 logs` |

## 📞 API Examples

### Get All Config
```javascript
fetch('/admin/api/config', {
  headers: {
    'X-Admin-Token': 'your_token_here'
  }
})
.then(r => r.json())
.then(data => console.log(data));
```

### Update Config
```javascript
fetch('/admin/api/config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Admin-Token': 'your_token_here'
  },
  body: JSON.stringify({
    key: 'vip_price_299',
    value: 350
  })
})
.then(r => r.json())
.then(data => console.log(data));
```

### Logout
```javascript
fetch('/admin/api/logout', {
  method: 'POST',
  headers: {
    'X-Admin-Token': 'your_token_here'
  }
})
.then(r => r.json())
.then(data => console.log(data));
```

## 🎯 Best Practices

### Pricing Strategy
✅ **DO**: Test small increases (10-20%)
✅ **DO**: Monitor user behavior after changes
✅ **DO**: Use tiered pricing for upselling
❌ **DON'T**: Make drastic price jumps
❌ **DON'T**: Forget to communicate changes

### Security
✅ **DO**: Use HTTPS in production
✅ **DO**: Limit admin IDs to trusted users
✅ **DO**: Monitor config change logs
❌ **DON'T**: Share session tokens
❌ **DON'T**: Use weak Telegram accounts

### Operations
✅ **DO**: Keep backups of config
✅ **DO**: Test changes in dev first
✅ **DO**: Document why changes were made
❌ **DON'T**: Make changes during peak hours
❌ **DON'T**: Change multiple things at once

## 📈 Monitoring

### Key Metrics
- **Login Attempts**: Check for brute force (max 5/15min)
- **Session Count**: How many admins logged in
- **Config Changes**: Audit log frequency
- **API Response Time**: Dashboard performance

### Log Patterns
```
[ConfigService] "vip_price_299" updated to "350" by admin 123456789
[ConfigService] Defaults initialized
[Auth] Session created for admin 123456789
[Auth] Rate limit exceeded for 987654321
```

## 🔄 Recovery

### Reset Config to Defaults
```bash
# Run migration again
node scripts/migrations/add_app_config_table.js
```

### Manual Config Reset
```sql
-- Reset VIP pricing
UPDATE app_config SET value = '299' WHERE key = 'vip_price_299';
UPDATE app_config SET value = '399' WHERE key = 'vip_price_399';
UPDATE app_config SET value = '499' WHERE key = 'vip_price_499';

-- Disable all features
UPDATE app_config SET value = 'false' WHERE key LIKE '%_enabled';
```

### Emergency Shutdown
```bash
# Stop dashboard only
pm2 stop server

# Stop everything
pm2 stop all
```

---

**Quick Start**: http://localhost:3000/admin/login
**Documentation**: [ADMIN_DASHBOARD_GUIDE.md](ADMIN_DASHBOARD_GUIDE.md)
**Implementation**: [ADMIN_DASHBOARD_IMPLEMENTATION.md](ADMIN_DASHBOARD_IMPLEMENTATION.md)
