# Admin Media Forwarding Setup Guide

## ⚠️ CRITICAL: How to Enable Admin Media Forwarding

Your bot now has a **foolproof admin media forwarding system** with:
- ✅ Automatic retry on failure (up to 5 attempts)
- ✅ Persistent queue for failed forwards
- ✅ Channel validation on startup
- ✅ Detailed error logging
- ✅ Never blocks user experience

## Setup Steps

### 1. Create/Find Your Admin Channel

Create a Telegram channel or group where you want to receive all media:

```
1. Open Telegram
2. Create a new Channel (or use existing)
3. Make it private or public
4. Add your bot as Administrator
5. Grant "Post Messages" permission to the bot
```

### 2. Get Channel ID

Use the included script to get your channel ID:

```powershell
# Run this command
node get-channel-id.js
```

Then forward ANY message from your channel to the bot. It will reply with the channel ID.

### 3. Update .env File

Add or update this line in `.env`:

```env
ADMIN_MEDIA_CHANNEL_ID=-1002355067849  # Replace with your channel ID
```

**Important**: 
- Channel IDs are usually negative numbers starting with `-100`
- Public channels can use `@channelname`
- Bot MUST be admin in the channel

### 4. Restart Bot

```powershell
npm run dev
```

You should see:
```
✅ Admin media channel validated: YourChannelName
```

If you see an error:
```
❌ Admin media channel validation failed
   Please ensure bot is added to channel: -1002355067849
   And bot has permission to post messages
```

**Fix**: Go to your channel → Administrators → Add your bot → Enable "Post Messages"

## How It Works

1. **User sends media** → Immediately delivered to partner
2. **Background process** → Forwards copy to admin channel
3. **If forward fails** → Added to retry queue
4. **Retry logic** → Attempts every 5-10 seconds with exponential backoff
5. **Max 5 retries** → After that, logged to `logs/error.log`

## Monitoring

### Check Status

All errors are logged to:
- `logs/error.log` - Failed forwards and errors
- `logs/app.log` - General activity
- `logs/debug.log` - Detailed message flow

### Check Queue Size

Failed forwards are queued and retried automatically. Queue status is logged.

## Troubleshooting

### ❌ "Chat not found"
**Solution**: Make sure channel ID is correct and bot is added to channel

### ❌ "Bot was kicked"
**Solution**: Re-add bot to channel as admin

### ❌ "Not enough rights"
**Solution**: Give bot "Post Messages" permission in channel settings

### ❌ "Forbidden"
**Solution**: Bot must be admin, not just a member

## Testing

1. Start two users chatting
2. Send a photo from one user
3. Check admin channel - should receive the photo with sender/receiver details
4. If it fails, check `logs/error.log`
5. Service will retry automatically

## Disable Forwarding

To temporarily disable (without removing):

```env
# ADMIN_MEDIA_CHANNEL_ID=-1002355067849  # Commented out = disabled
```

Or set to empty:
```env
ADMIN_MEDIA_CHANNEL_ID=
```

## Important Notes

⚠️ **Privacy**: All media sent between users is forwarded to admin channel
⚠️ **Storage**: Channel will store all media - consider Telegram's storage limits
⚠️ **Compliance**: Ensure this complies with your privacy policy
✅ **User Experience**: Never blocks or slows down message delivery
✅ **Reliability**: Automatic retry ensures no media is lost
