# Bot Display Name Branding Guide

## Overview
The bot's display name is configured via BotFather (Telegram's bot management interface), not through code. This document provides guidance on setting up a short, professional display name.

## Recommended Display Names

Choose one of these short, simple names:

1. **Unknown Meet Bot**
2. **Random Chat Bot**
3. **Partner Bot**
4. **My Random Chat**
5. **Find Your Partner Bot**

## How to Change Bot Display Name

### Steps:
1. Open Telegram and search for `@BotFather`
2. Send `/mybots` command
3. Select your bot from the list
4. Choose "Edit Bot" → "Edit Name"
5. Enter your chosen display name (e.g., "Partner Bot")
6. Confirm the change

### Important Notes:
- Display name can be changed anytime via BotFather
- Username (e.g., `@yourbot`) cannot be changed after creation
- Display name appears in chat headers and user interfaces
- Keep it short (under 20 characters recommended)
- Avoid special characters that might cause display issues

## In-Chat Branding

While the bot's display name is set via BotFather, you can also use short names in:
- Welcome messages
- Error messages
- Help text
- Settings menus

Example usage in code:
```javascript
const botDisplayName = "Partner Bot"; // Or fetch from config
const welcomeMsg = `Welcome to ${botDisplayName}!`;
```

## Current Implementation

The codebase does not hardcode the bot display name. All messages use generic terms like:
- "Anonymous Chat"
- "Find Partner"
- Generic bot references

To add custom branding in messages, update:
- `utils/enhancedMessages.js` - Main message templates
- `controllers/enhancedChatController.js` - Dynamic messages

## Best Practices

1. **Consistency**: Use the same short name across all user-facing text
2. **Simplicity**: Keep it memorable and easy to type
3. **Professional**: Avoid overly casual or inappropriate names
4. **Length**: Shorter is better (aim for 2-4 words max)

## Configuration (Optional)

If you want to make the display name configurable via environment variables:

```javascript
// config/config.js
BOT_DISPLAY_NAME: process.env.BOT_DISPLAY_NAME || 'Partner Bot'

// Usage in messages
const displayName = config.BOT_DISPLAY_NAME;
```

However, this only affects in-chat messages, not the actual Telegram display name (which must be set via BotFather).
