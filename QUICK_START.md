# ⚡ Quick Start Guide

## 🎯 Get Running in 3 Steps

### Prerequisites
- Node.js 18+ (tested with 22.21.1)
- PostgreSQL database
- Redis server

---

## Step 1: Install Dependencies

```bash
npm install
```

---

## Step 2: Configure Environment

The `.env` file is already included. Update these values:

```env
# Your Telegram Bot Tokens (comma-separated for multiple bots)
BOT_TOKENS=token1,token2,token3,token4,token5

# PostgreSQL connection (update host/password)
POSTGRES_URI=postgresql://postgres:yourpassword@localhost:5432/chatbot_production

# Redis connection (update host)
REDIS_URL=redis://localhost:6379

# Admin Telegram IDs (your Telegram user ID)
ADMIN_TELEGRAM_IDS=your_telegram_id
ADMIN_CONTROL_CHAT_ID=your_admin_group_id

# Admin Panel credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
ADMIN_PANEL_PORT=4000
```

---

## Step 3: Start the Bot

```bash
node start-all.js
```

---

## Access Points

| Service | URL |
|---------|-----|
| Admin Panel | http://YOUR_IP:4000/admin |
| Health Check | http://YOUR_IP:4000/health |

---

## Database Setup (First Time Only)

Create the PostgreSQL database:

```sql
CREATE DATABASE chatbot_production;
```

The bot will auto-create all tables on first run.

---

## That's it! 🎉

The bot will:
1. ✅ Connect to PostgreSQL
2. ✅ Connect to Redis  
3. ✅ Start all Telegram bots
4. ✅ Start admin panel on port 4000

```bash
npm run init-schema
```

### Step 4: Start Bot

**Option 1: Development (single instance)**
```bash
npm run dev
```

**Option 2: Start both bot + admin panel**
```bash
npm run all
# Admin panel: http://localhost:4000/admin
```

**Option 3: Admin Panel only**
```bash
npm run admin
```

**Option 4: Production (PM2 cluster)**
```bash
# Install PM2 if not installed
npm install -g pm2

# Start cluster
npm run cluster

# Check status
npm run status
```

### Step 5: Test Bot

1. Open Telegram
2. Find your bot
3. Send `/start`
4. Complete profile setup
5. Click "🔍 Find Partner"

---

## 🎛️ Admin Panel

**Access:**
```
http://localhost:3001/admin/login
```

**Login:**
1. Enter your Telegram ID
2. Click "Request Login Code"
3. Send `/admin_login <code>` to your bot
4. Auto-redirected to dashboard

---

## 📚 Documentation

- **Complete Guide:** `PRODUCTION_DOCUMENTATION.md`
- **Testing:** `TESTING_GUIDE.md`
- **Setup:** `SETUP_INSTRUCTIONS.md`
- **Security:** `SECURITY_NOTES.md`
- **Improvements:** `IMPROVEMENTS_SUMMARY.md`

---

## 🆘 Troubleshooting

### Node.js not found
```bash
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

### Database errors
Use SQLite for testing:
```env
SQLITE_DB_PATH=./chatbot.db
```

### Redis errors
Use memory Redis for testing:
```env
REDIS_URL=memory://
```

---

## ✅ Verification Checklist

- [ ] Node.js installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] Dependencies installed (`ls node_modules`)
- [ ] .env file configured
- [ ] Database initialized (`npm run init-schema`)
- [ ] Bot starts without errors
- [ ] Can send `/start` to bot
- [ ] Admin panel accessible

---

**Ready to go!** 🚀

See `PRODUCTION_DOCUMENTATION.md` for complete deployment guide.
