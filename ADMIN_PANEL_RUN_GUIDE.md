# 🚀 Admin Panel - How to Run

## Quick Start

### Option 1: Using npm script (Recommended)
```bash
npm run admin
```

This will start the admin panel server on port **3000** (or `ADMIN_PORT` if set).

### Option 2: Direct node command
```bash
node server.js
```

### Option 3: Using PM2 (Production)
```bash
pm2 start ecosystem.config.js
```

The admin panel is configured as a separate app in `ecosystem.config.js`.

## Access Admin Panel

Once started, open your browser:
```
http://localhost:3000/admin
```

Or if using a different port:
```
http://localhost:YOUR_PORT/admin
```

## Default Port

- **Default**: `3000`
- **Custom**: Set `ADMIN_PORT` environment variable

Example:
```bash
ADMIN_PORT=8080 npm run admin
```

## Important Notes

### ⚠️ Separate Process
The admin panel (`server.js`) runs as a **separate process** from the bot (`bots.js`). You can run both simultaneously:

```bash
# Terminal 1: Bot
npm start

# Terminal 2: Admin Panel
npm run admin
```

### 🔐 Authentication
1. First time: You'll be redirected to `/admin/login`
2. Enter your Telegram ID (must be in `ADMIN_TELEGRAM_IDS`)
3. You'll receive a login code in Telegram
4. Enter the code to access the dashboard

### 📋 Environment Variables

Make sure these are set:
- `ADMIN_TELEGRAM_IDS` - Comma-separated list of admin Telegram IDs
- `ADMIN_CONTROL_CHAT_ID` - Channel for admin alerts (optional)
- `ADMIN_PORT` - Port for admin panel (default: 3000)

## Troubleshooting

### Error: "Port already in use"
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

### Error: "Bot is already running"
This error appears when trying to run `npm start admin` (wrong command).
- Use `npm run admin` instead
- Or `node server.js` directly

### Admin panel not loading
1. Check if server is running: `curl http://localhost:3000/health`
2. Check logs for errors
3. Verify database connection
4. Check if port is accessible

### Can't login
1. Verify your Telegram ID is in `ADMIN_TELEGRAM_IDS`
2. Check bot is running (needed for login codes)
3. Check Telegram for login code
4. Code expires in 5 minutes

## Production Deployment

For production, use PM2:

```bash
# Start both bot and admin panel
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs

# Restart
pm2 restart all
```

The `ecosystem.config.js` file includes both:
- `bot` app - Telegram bot
- `admin` app - Admin dashboard

---

**Quick Reference:**
- ✅ `npm run admin` - Start admin panel
- ✅ `npm start` - Start bot
- ✅ Both can run simultaneously
- ✅ Admin panel: `http://localhost:3000/admin`
