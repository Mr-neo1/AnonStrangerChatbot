# How to Start the Bot Properly

## ✅ Quick Start

### Option 1: Using PowerShell Script (Recommended)
```powershell
.\restart-bot.ps1
```

### Option 2: Manual Start
```powershell
# 1. Stop all existing processes
taskkill /F /IM node.exe

# 2. Wait 2 seconds
Start-Sleep -Seconds 2

# 3. Start the bot
node bots.js
```

### Option 3: Using Stop Script First
```powershell
# Stop all processes
.\stop-bot.ps1

# Then start manually
node bots.js
```

## ⚠️ Important Notes

1. **Only ONE instance should run** - Multiple instances cause 409 Conflict errors
2. **Check for running processes** before starting:
   ```powershell
   tasklist | findstr node
   ```
3. **If you see 409 errors**, stop all processes and restart:
   ```powershell
   taskkill /F /IM node.exe
   ```

## 🔍 Troubleshooting

### Problem: 409 Conflict Error
**Solution**: Stop all Node processes and restart
```powershell
taskkill /F /IM node.exe
node bots.js
```

### Problem: Port Already in Use
**Solution**: Check what's using the port (usually Redis/PostgreSQL)
```powershell
netstat -ano | findstr :6379  # Redis
netstat -ano | findstr :5432  # PostgreSQL
```

### Problem: Bot Not Responding
**Solution**: 
1. Check logs for errors
2. Verify environment variables (.env file)
3. Check database connection
4. Restart the bot

## 📋 Pre-Start Checklist

- [ ] All previous Node processes stopped
- [ ] Database is running (PostgreSQL/SQLite)
- [ ] Redis is running (if using)
- [ ] Environment variables set (.env file)
- [ ] Bot tokens configured correctly

## 🚀 Production Deployment

For production, use PM2 or similar process manager:

```powershell
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start bots.js --name "anon-chatbot"

# Monitor
pm2 logs anon-chatbot

# Stop
pm2 stop anon-chatbot
```
