# 💳 Payment Setup Guide

## Why Payments Are Unavailable

The error "Payments are currently unavailable" appears because two environment variables are missing:

1. `ENABLE_STARS_PAYMENTS` - Must be set to `true`
2. `PAYMENT_PROVIDER_TOKEN` - Must be set to your bot's payment provider token

## 🔧 How to Fix

### Step 1: Get Payment Provider Token from BotFather

1. Open Telegram and search for `@BotFather`
2. Send `/mybots` command
3. Select your bot from the list
4. Choose **"Payments"** → **"Configure Payments"**
5. Follow the setup wizard to connect a payment provider (Stripe, etc.)
6. After setup, BotFather will give you a **Payment Provider Token**
7. Copy this token - you'll need it for Step 2

**Note**: If you haven't set up payments yet, you need to:
- Create a Stripe account (or another supported provider)
- Connect it to your bot via BotFather
- Get the provider token

### Step 2: Update .env File

Add these lines to your `.env` file:

```env
# Enable Stars Payments
ENABLE_STARS_PAYMENTS=true

# Payment Provider Token (from BotFather)
PAYMENT_PROVIDER_TOKEN=your_payment_provider_token_here
```

### Step 3: Restart Bot

After updating `.env`:
```powershell
# Stop bot
.\stop-bot.ps1

# Start bot
node bots.js
```

## ✅ Verification

After restarting, when you click "⭐ Buy Premium" and select a plan, you should see:
- ✅ An invoice/payment screen (not the "unavailable" message)
- ✅ Payment options with Stars ⭐

## 🔍 Troubleshooting

### Still seeing "Payments unavailable"?

1. **Check .env file exists**: `Test-Path .env`
2. **Check variables are set**: Look for `ENABLE_STARS_PAYMENTS=true` and `PAYMENT_PROVIDER_TOKEN=...`
3. **Restart bot**: Make sure bot restarts after .env changes
4. **Check logs**: Look for any errors about payment configuration

### Payment Provider Token Format

The token usually looks like:
- `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz` (similar to bot token)
- Or a Stripe token format

### Testing Payments

**Important**: In test mode, use test payment methods:
- Test card: `4242 4242 4242 4242`
- Any future expiry date
- Any CVC

## 📋 Quick Checklist

- [ ] BotFather payments configured
- [ ] Payment Provider Token obtained
- [ ] `.env` file updated with `ENABLE_STARS_PAYMENTS=true`
- [ ] `.env` file updated with `PAYMENT_PROVIDER_TOKEN=...`
- [ ] Bot restarted after changes
- [ ] Tested clicking "Buy Premium" button

## 🚨 Important Notes

1. **Payment Provider Required**: You MUST set up a payment provider (Stripe, etc.) via BotFather before payments will work
2. **Environment Variables**: Both variables must be set, not just one
3. **Restart Required**: Bot must be restarted after changing .env file
4. **Production vs Development**: Make sure you're using the correct tokens for your environment
