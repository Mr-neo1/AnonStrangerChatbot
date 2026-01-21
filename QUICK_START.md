# ⚡ Quick Start Guide

## 🎯 Get Started in 5 Minutes

### Prerequisites ✅
- ✅ Node.js 18.20.8 (installed via nvm)
- ✅ npm 10.8.2 (installed)
- ✅ Dependencies installed

### Step 1: Load Node.js (if needed)

If you open a new terminal, nvm will auto-load. If not:
```bash
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

### Step 2: Configure Environment

```bash
# Create .env file
cp .env.example .env

# Edit with your settings
nano .env
```

**Minimum required:**
```env
BOT_TOKEN=your_telegram_bot_token
ADMIN_TELEGRAM_IDS=your_telegram_user_id
```

**For testing (SQLite + Memory Redis):**
```env
BOT_TOKEN=your_token
ADMIN_TELEGRAM_IDS=your_id
SQLITE_DB_PATH=./chatbot.db
REDIS_URL=memory://
```

### Step 3: Initialize Database

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
node start-all.js
```

**Option 3: Production (PM2 cluster)**
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
