# 🤖 How to Get Your Telegram Bot Token

## Step-by-Step Guide

### 1. Open Telegram

Open the Telegram app on your phone or desktop.

### 2. Find BotFather

Search for **@BotFather** in Telegram and open it.

### 3. Create a New Bot

Send the following command to BotFather:
```
/newbot
```

### 4. Follow the Instructions

1. **Choose a name** for your bot (e.g., "My Anonymous Chat Bot")
2. **Choose a username** for your bot (must end with `bot`, e.g., "my_anon_chat_bot")

### 5. Get Your Token

BotFather will send you a message like:
```
Use this token to access the HTTP API:
123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

**Copy this token!** This is your `BOT_TOKEN`.

### 6. Get Your Telegram User ID

1. Search for **@userinfobot** in Telegram
2. Send `/start` to it
3. It will reply with your Telegram ID (a number like `123456789`)
4. **Copy this ID!** This is your `ADMIN_TELEGRAM_IDS`

### 7. Configure Your Bot

1. Open `.env.local` file:
   ```bash
   nano .env.local
   ```

2. Replace the placeholders:
   ```env
   BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ADMIN_TELEGRAM_IDS=123456789
   ```

3. Save and exit (Ctrl+X, then Y, then Enter)

### 8. Optional: Get Admin Channel IDs

If you want to receive admin alerts and media:

1. Create a Telegram channel or group
2. Add your bot as an administrator
3. Forward a message from the channel to **@userinfobot**
4. It will show the channel ID (like `-1001234567890`)
5. Add to `.env.local`:
   ```env
   ADMIN_CONTROL_CHAT_ID=-1001234567890
   ADMIN_MEDIA_CHANNEL_ID=-1001234567890
   ```

### 9. Start Your Bot

```bash
node start-all.js
```

---

## Quick Commands Reference

**BotFather Commands:**
- `/newbot` - Create a new bot
- `/token` - Get your bot token
- `/setdescription` - Set bot description
- `/setabouttext` - Set about text
- `/setuserpic` - Set bot profile picture
- `/setcommands` - Set bot commands

**User Info Bot:**
- `/start` - Get your Telegram ID

---

## Security Notes

⚠️ **Never share your bot token publicly!**
- Keep `.env.local` private
- Don't commit it to Git
- Don't share it in screenshots

✅ **Best Practices:**
- Use different tokens for development and production
- Rotate tokens if compromised
- Use environment variables in production

---

## Troubleshooting

### "Bot token is invalid"
- Check for typos in the token
- Make sure there are no extra spaces
- Verify the token with BotFather: `/token`

### "Unauthorized"
- Your bot token might be revoked
- Create a new bot and get a new token

### "Bot not responding"
- Make sure the bot is started: `node start-all.js`
- Check logs for errors
- Verify BOT_TOKEN is set correctly

---

**Need Help?** See `PRODUCTION_DOCUMENTATION.md` for complete setup guide.
