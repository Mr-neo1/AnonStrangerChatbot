# 🔧 Admin Login Troubleshooting Guide

## Current Issue
Cannot login to admin panel

## Step-by-Step Debugging

### Step 1: Check if Bot is Running
**The bot MUST be running for login to work!**

```bash
# Check if bot is running
npm start
# OR
pm2 status
```

**Why?** The `/admin_login` command is handled by the bot. If bot is not running, you can't complete login.

### Step 2: Check ADMIN_TELEGRAM_IDS Configuration

1. **Check environment variable:**
   ```bash
   # Windows PowerShell
   $env:ADMIN_TELEGRAM_IDS
   
   # Or check .env file
   ```

2. **Set if not configured:**
   ```bash
   # Windows PowerShell
   $env:ADMIN_TELEGRAM_IDS = "YOUR_TELEGRAM_ID"
   
   # Or add to .env file:
   ADMIN_TELEGRAM_IDS=YOUR_TELEGRAM_ID
   ```

3. **Find your Telegram ID:**
   - Open Telegram
   - Search for `@userinfobot`
   - Send `/start`
   - Copy your ID

### Step 3: Verify Configuration

Visit: `http://localhost:3000/admin/api/check-config`

This will show:
- If admin IDs are configured
- Redis type (memory or real)
- Configuration status

### Step 4: Complete Login Process

1. **Start Admin Panel:**
   ```bash
   npm run admin
   ```

2. **Start Bot (in separate terminal):**
   ```bash
   npm start
   ```

3. **Login Flow:**
   - Go to: `http://localhost:3000/admin/login`
   - Enter your Telegram ID
   - Get 6-digit code
   - **IMPORTANT**: Send `/admin_login <code>` to ANY of your bots in Telegram
   - Wait for confirmation (frontend polls every 2 seconds)
   - You'll be redirected to dashboard

### Step 5: Common Errors

#### Error: "Unauthorized admin ID"
- **Cause**: Your Telegram ID is not in `ADMIN_TELEGRAM_IDS`
- **Fix**: Add your ID to environment variable and restart

#### Error: "Code expired"
- **Cause**: Code expired (5 minutes)
- **Fix**: Request a new code

#### Error: "Session not found"
- **Cause**: 
  - Server restarted (Memory Redis loses data)
  - Redis connection issue
- **Fix**: Login again

#### Error: "Waiting for confirmation" (never completes)
- **Cause**: Bot is not running or `/admin_login` command not sent
- **Fix**: 
  1. Ensure bot is running: `npm start`
  2. Send `/admin_login <code>` to bot in Telegram
  3. Check bot logs for errors

## Quick Test

1. **Check config:**
   ```bash
   curl http://localhost:3000/admin/api/check-config
   ```

2. **Test login request:**
   ```bash
   curl -X POST http://localhost:3000/admin/api/request-login \
     -H "Content-Type: application/json" \
     -d '{"telegramId":"YOUR_ID"}'
   ```

3. **Check bot is responding:**
   - Send `/start` to your bot in Telegram
   - Bot should respond

## Complete Setup Checklist

- [ ] Bot is running (`npm start`)
- [ ] Admin panel is running (`npm run admin`)
- [ ] `ADMIN_TELEGRAM_IDS` is set in environment
- [ ] Your Telegram ID is in `ADMIN_TELEGRAM_IDS`
- [ ] Redis is connected (Memory Redis is OK for testing)
- [ ] You can send messages to your bot

## Production Setup

For production, use real Redis (not memory Redis):

```bash
# Set Redis URL
export REDIS_URL=redis://localhost:6379

# Or in .env file
REDIS_URL=redis://localhost:6379
```

## Still Having Issues?

1. Check server logs for errors
2. Check bot logs for errors
3. Verify Redis connection
4. Try clearing browser cookies
5. Try incognito/private mode
6. Check browser console for errors

---

**Remember**: Both bot AND admin panel must be running for login to work!
