# 🔧 Fix Payments - Quick Steps

## ✅ What Was Done

1. ✅ Created `.env` file (was missing)
2. ✅ Added payment configuration template
3. ✅ Created helper scripts

## 🚨 What You Need to Do NOW

### Step 1: Edit .env File

Open `.env` file and update these lines:

```env
# Replace with your actual bot token(s)
BOT_TOKENS=your_actual_bot_token_1,your_actual_bot_token_2
BOT_TOKEN=your_actual_bot_token_here

# ⭐ THIS IS THE KEY - Get from BotFather
ENABLE_STARS_PAYMENTS=true
PAYMENT_PROVIDER_TOKEN=your_payment_provider_token_from_botfather
```

### Step 2: Get Payment Provider Token

**How to get it:**

1. Open Telegram → Search `@BotFather`
2. Send: `/mybots`
3. Select your bot
4. Click: **"Payments"** → **"Configure Payments"**
5. **If not set up yet:**
   - Choose payment provider (Stripe recommended)
   - Follow setup wizard
   - Connect your Stripe account
6. **Copy the Payment Provider Token** (looks like: `1234567890:ABC...`)
7. **Paste it in .env** replacing `your_payment_provider_token_from_botfather`

### Step 3: Restart Bot

```powershell
# Stop all processes
.\stop-bot.ps1

# Start bot
node bots.js
```

## ✅ Verification

After restarting, test:
1. Click "⭐ Buy Premium" button
2. Select any VIP plan (BASIC, PLUS, PRO)
3. **Should see**: Payment invoice screen ✅
4. **Should NOT see**: "Payments are currently unavailable" ❌

## 🔍 Troubleshooting

### Still seeing "Payments unavailable"?

**Check 1**: Verify .env has correct values
```powershell
Get-Content .env | Select-String "ENABLE_STARS_PAYMENTS|PAYMENT_PROVIDER_TOKEN"
```

Should show:
```
ENABLE_STARS_PAYMENTS=true
PAYMENT_PROVIDER_TOKEN=actual_token_here
```

**Check 2**: Make sure token is not empty
- Token should NOT be `your_payment_provider_token_from_botfather`
- Token should be actual value from BotFather

**Check 3**: Restart bot after changes
- Environment variables are read at startup
- Must restart to apply changes

### Payment Provider Token Format

The token from BotFather usually looks like:
- `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz` (similar format to bot token)
- Or a Stripe token if using Stripe

### If You Don't Have Payment Provider Token Yet

You need to set up payments in BotFather first:
1. BotFather → `/mybots` → Your bot
2. **"Payments"** → **"Configure Payments"**
3. Choose provider (Stripe is easiest)
4. Complete setup wizard
5. Get the token

## 📋 Quick Checklist

- [ ] `.env` file exists (✅ Created)
- [ ] `ENABLE_STARS_PAYMENTS=true` in .env
- [ ] `PAYMENT_PROVIDER_TOKEN=...` set with actual token
- [ ] Bot tokens configured in .env
- [ ] Bot restarted after .env changes
- [ ] Tested "Buy Premium" button

## 🎯 Summary

**The Problem**: Payments disabled because `.env` file was missing and payment settings weren't configured.

**The Solution**: 
1. ✅ Created `.env` file
2. ⏳ **YOU NEED TO**: Add your bot tokens and payment provider token
3. ⏳ **YOU NEED TO**: Restart the bot

**After you complete steps above, payments will work!** 🚀
