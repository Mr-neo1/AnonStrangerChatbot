# 🚀 QUICK REFERENCE - Bot Commands & Setup

## ⚡ Quick Start (Copy & Paste)

### Step 1: Install
```bash
cd "c:\Users\rkrai\OneDrive\Desktop\VsCode\AnonStrangerChatbot"
npm install
```

### Step 2: Configure
```bash
# Create .env file
cat > .env << 'EOF'
BOT_TOKEN=YOUR_BOT_TOKEN_HERE
POSTGRES_URI=postgresql://localhost/chatbot
REDIS_URL=memory://
ADMIN_TELEGRAM_IDS=YOUR_TELEGRAM_ID
NODE_ENV=development
EOF
```

### Step 3: Initialize
```bash
npm run init-schema
```

### Step 4: Start
```bash
npm start
```

---

## 📱 Bot Keyboard Commands

### Main Menu (when no active chat)
```
🔍 Find Partner      Find random chat partner
☰ Menu              Full options menu
```

### Active Chat Menu (during conversation)
```
🔒 Lock Chat        Pay Stars to lock chat (prevent exit)
⏭ Next Partner     Skip to different partner
❌ Stop Chat        End conversation
```

### Settings Menu
```
👤 Update Gender    Change gender (M/F/Other)
🎂 Update Age       Update age (13-100)
⭐ Preference       VIP: Choose gender preference (M/F/Other/Any)
📊 View Stats       Show chat statistics
🔙 Back            Return to main menu
```

### Premium
```
⭐ Buy Premium      Subscribe to VIP (7/30/90 days)
🔒 Lock Chat        Time-lock session (5/10/15 min)
⭐ Rewards          View affiliate earnings
```

---

## 🛠️ Admin Commands (Telegram Private Message)

Send to admin ID (from ADMIN_TELEGRAM_IDS):

```bash
/ban <userId>              Ban user (blocks all access)
/unban <userId>            Unban user (restore access)
/broadcast <message>       Send message to all users
/stats                     Show platform statistics
/locks                     List all active time-locks
```

**Example:**
```
/ban 123456789
/broadcast Welcome to our chat bot!
```

---

## 💻 NPM Scripts

```bash
npm start                  Start bot (single instance)
npm run dev               Start bot with logs
npm run cluster           Start with PM2 (production)
npm run stop              Stop all processes
npm run restart           Restart processes
npm run reload            Graceful reload
npm run status            Check process status
npm run logs              View logs
npm run monit             Monitor processes
npm run delete            Delete all processes
npm run init-schema       Initialize database
```

---

## 🔧 Configuration (.env)

### Required
```bash
BOT_TOKEN=7123456789:AABc...      Your bot token from @BotFather
ADMIN_TELEGRAM_IDS=123456789      Your Telegram ID
```

### Database (Choose One)
```bash
# PostgreSQL (production)
POSTGRES_URI=postgresql://user:pass@localhost:5432/chatbot_db

# SQLite (development)
SQLITE_DB_PATH=./chatbot.db
```

### Optional
```bash
# Multiple bots
BOT_TOKENS=TOKEN1,TOKEN2,TOKEN3

# Redis cache
REDIS_URL=redis://localhost:6379
# Default: memory:// (in-process)

# Admin channels
ADMIN_CONTROL_CHAT_ID=123456789
ADMIN_CHAT_ID=123456789

# Channels users must join
REQUIRED_CHANNEL_IDS=@channel1,@channel2

# Media forwarding
ADMIN_CHANNEL_ID=-1001234567890

# Features
ENABLE_STARS_PAYMENTS=true
ENABLE_CROSS_BOT_MATCHING=true
ENABLE_ADMIN_ALERTS=true

# Environment
NODE_ENV=development|production
```

---

## 📊 VIP Pricing (Telegram Stars)

### Subscriptions
| Plan | Duration | Stars | Benefits |
|------|----------|-------|----------|
| Basic | 7 days | 49 | Gender preference, priority |
| Plus | 30 days | 199 | All + more |
| Premium | 90 days | 499 | All + priority |

### Time-Locks
| Duration | Stars | Effect |
|----------|-------|--------|
| 5 min | 15 | Prevent partner exit |
| 10 min | 25 | Prevent partner exit |
| 15 min | 35 | Prevent partner exit |

---

## 🔐 Security Commands

```bash
# Ban user
/ban 123456789

# Unban user
/unban 123456789

# Check who's banned (in admin code)
User.findAll({ where: { banned: true } })
```

---

## 📊 Statistics Commands

```bash
/stats              Show user counts and metrics
```

Returns:
```
📊 Stats
Total users: 1,234
VIP users: 45
Active chats: 12
```

---

## 🔄 Database Commands

### Initialize
```bash
npm run init-schema
```

Creates tables:
- User
- Chat
- VipSubscription
- StarTransaction
- LockChat
- Referral
- AffiliateReward

### Backup
```bash
npm run backup      (Automatic daily backup)
```

### Connect (Manual)
```bash
# PostgreSQL
psql -U chatbot_user -d chatbot_db

# SQLite
sqlite3 chatbot.db
```

---

## 🚀 Deployment Commands

### PM2 (Recommended)
```bash
npm run cluster              Start production
pm2 startup                  Auto-start on reboot
pm2 save                     Save process list
pm2 monit                    Monitor processes
pm2 logs                     View logs
pm2 stop all                 Stop all
pm2 delete all               Delete all
```

### Docker
```bash
docker build -t chatbot .
docker run -d --env-file .env chatbot
```

### Manual
```bash
NODE_ENV=production npm start &
disown                       (Run in background)
```

---

## 🐛 Troubleshooting Commands

### Bot Won't Start
```bash
# Kill existing process
taskkill /IM node.exe /F

# Or delete lock file
del .bot.lock

# Try again
npm start
```

### Database Error
```bash
# Reinitialize database
npm run init-schema

# Check connection
psql -U chatbot_user -d chatbot_db -c "SELECT COUNT(*) FROM \"User\";"
```

### Redis Error
```bash
# Use in-memory cache (default)
set REDIS_URL=memory://

# Or start Redis
redis-server
```

### Logs
```bash
# View real-time
npm run dev

# View last 100 lines
pm2 logs --lines 100

# Specific file
tail -f logs/out.log
```

---

## 💾 File Management

### View Logs
```bash
logs/out.log             Standard output
logs/err.log             Error output
logs/combined.log        All output
```

### View Database
```bash
# SQLite
sqlite3 chatbot.db ".tables"
sqlite3 chatbot.db ".schema User"

# PostgreSQL
psql -U chatbot_user -d chatbot_db -c "\dt"
psql -U chatbot_user -d chatbot_db -c "\d User"
```

### Backup Database
```bash
# SQLite
cp chatbot.db chatbot.backup.db

# PostgreSQL
pg_dump -U chatbot_user chatbot_db > backup.sql
```

---

## 🔄 Referral System

### How It Works
1. User A invites User B via referral link
2. User B clicks link and joins bot
3. When User B makes payment → User A gets reward

### Rewards
- **Affiliate:** 50% of Stars paid
- **Milestone:** Every 5 referrals = 15 VIP days

### Commands
```bash
# Check referrals (in code)
Referral.findAll({ where: { inviterId: userId } })

# Check earnings
AffiliateReward.findAll({ where: { userId } })
```

---

## 🎯 Feature Flags

Toggle features without restart:

```bash
# In database (ConfigService)
ENABLE_STARS_PAYMENTS=true|false
ENABLE_CROSS_BOT_MATCHING=true|false
ENABLE_ADMIN_ALERTS=true|false
ENABLE_VIP_LOCK_PREFERENCE=true|false
ENABLE_AFFILIATE_SYSTEM=true|false
```

---

## 📈 Performance Tuning

### Caching
```bash
USER_CACHE_TTL=300         Cache 5 minutes
SESSION_CACHE_TTL=86400    Session 24 hours
```

### Database
```bash
POOL_MAX=50                Max connections
POOL_MIN=10                Min connections
```

### Rate Limiting
```bash
RATE_LIMIT=90              90 messages/min
RATE_WINDOW=60             Per 60 seconds
```

---

## 🔔 Notifications

### Admin Alerts
When enabled, bot sends admin alerts for:
- New referrals
- Lock abuse detected
- Disconnect abuse
- Payment processing errors

### Enable
```bash
ENABLE_ADMIN_ALERTS=true
ADMIN_CONTROL_CHAT_ID=YOUR_ID
```

---

## 🌐 Multi-Bot Setup

### Load Multiple Bots
```bash
BOT_TOKENS=TOKEN1,TOKEN2,TOKEN3
```

### Cross-Bot Matching
```bash
ENABLE_CROSS_BOT_MATCHING=true
```

### Features
- Users from different bots can match together
- Messages routed via correct bot instance
- Media forwarded cross-bot
- Admin controls all bots

---

## 🎓 Architecture Commands

### Check Bot Status
```bash
# Node process
tasklist | find "node.exe"

# PM2
pm2 status
pm2 info bot
```

### View Active Chats
```bash
# Redis
redis-cli KEYS "pair:*"
redis-cli GET "pair:123456789"
```

### Check VIP Users
```bash
# Redis
redis-cli KEYS "user:vip:*"

# PostgreSQL
SELECT COUNT(*) FROM "VipSubscription" WHERE "expiresAt" > NOW();
```

---

## 💡 Tips & Tricks

### Development
```bash
npm run dev                 See logs in real-time
ENABLE_ADMIN_ALERTS=true    Get admin notifications
```

### Production
```bash
npm run cluster             Use PM2
NODE_ENV=production         Set environment
REDIS_URL=redis://...       Use real Redis
```

### Debugging
```bash
# Enable verbose logging
DEBUG=*

# Check specific service
grep -r "MatchingService" .

# Test database
npm run init-schema && npm start
```

---

## 📋 Checklist for Deployment

- [ ] Install dependencies: `npm install`
- [ ] Create `.env` file with all variables
- [ ] Initialize database: `npm run init-schema`
- [ ] Test bot locally: `npm start`
- [ ] Check admin commands work
- [ ] Test VIP purchase flow
- [ ] Test media forwarding
- [ ] Deploy with PM2: `npm run cluster`
- [ ] Set up auto-restart: `pm2 startup`
- [ ] Monitor logs: `pm2 logs`

---

## 🎉 Ready!

Your bot is configured and ready to deploy. Use the commands above to manage it!

**Happy botting!** 🚀
