# 🚀 Quick Setup Instructions

## Node.js Installation (Kali Linux)

Since Kali's repositories had issues, we installed Node.js using **nvm** (Node Version Manager).

### Using nvm (Already Installed)

**To use Node.js in your current terminal:**
```bash
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

**Or add to your `~/.zshrc` (already done):**
```bash
# This is already in your .zshrc
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
```

**After adding, reload your shell:**
```bash
source ~/.zshrc
```

### Verify Installation

```bash
node --version  # Should show: v18.20.8
npm --version   # Should show: 10.8.2
```

---

## Project Setup

### 1. Install Dependencies (Already Done ✅)

```bash
cd /home/kali/AnonStrangerChatbot
npm install
```

### 2. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit with your settings
nano .env
```

**Required variables:**
- `BOT_TOKEN` or `BOT_TOKENS` - Your Telegram bot token(s)
- `ADMIN_TELEGRAM_IDS` - Your Telegram user ID
- `POSTGRES_URI` or use SQLite for testing
- `REDIS_URL` or use `memory://` for testing

### 3. Initialize Database

```bash
npm run init-schema
```

### 4. Start the Bot

**Development mode (single instance):**
```bash
npm run dev
```

**Production mode (PM2 cluster):**
```bash
# Install PM2 globally (if not installed)
npm install -g pm2

# Start cluster
npm run cluster

# Check status
npm run status

# View logs
npm run logs
```

**Start both bot and admin panel:**
```bash
node start-all.js
```

---

## Quick Commands

```bash
# Load nvm (if not in .zshrc)
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Start bot
npm run dev

# Start admin panel
npm run admin

# Start both
node start-all.js

# PM2 commands
npm run cluster    # Start cluster
npm run stop       # Stop all
npm run restart    # Restart all
npm run reload     # Zero-downtime reload
npm run logs       # View logs
npm run monit      # Monitor
npm run status     # Status
```

---

## Troubleshooting

### Node.js not found

```bash
# Load nvm
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Verify
node --version
```

### npm install fails

```bash
# Clear npm cache
npm cache clean --force

# Try again
npm install
```

### Database connection issues

For testing, use SQLite:
```env
SQLITE_DB_PATH=./chatbot.db
```

For production, use PostgreSQL:
```env
POSTGRES_URI=postgresql://user:pass@localhost:5432/dbname
```

---

## Next Steps

1. ✅ Node.js installed
2. ✅ Dependencies installed
3. ⏭️ Configure `.env` file
4. ⏭️ Initialize database
5. ⏭️ Start bot
6. ⏭️ Test features

See `PRODUCTION_DOCUMENTATION.md` for complete deployment guide.

---

**Last Updated:** 2026-01-16
