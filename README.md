# 🤖 Enhanced Telegram Anonymous Chat Bot

A feature-rich Telegram bot that connects strangers for anonymous conversations with modern UI/UX and performance optimizations.

## ✨ Features

### 🎯 Core Functionality
- **Anonymous Chat Pairing** - Connect random users worldwide
- **Channel Verification** - Users must join required channels
- **Profile Management** - Gender and age-based matching
- **Media Forwarding** - All media forwarded to admin channel
- **Admin Controls** - Ban/unban users, broadcast messages
- **Admin Dashboard** - Web-based configuration management (no restart required)

### 🎨 Enhanced UI/UX
- **Custom Keyboards** - Interactive buttons for all actions
- **Emoji-Rich Messages** - Engaging visual communication
- **Markdown Formatting** - Professional message styling
- **Context-Aware Interface** - Different keyboards for different states

### ⚡ Performance Features
- **Rate Limiting** - 90 messages/minute per user
- **Smart Session Management** - Preserves active chats
- **Media Compression** - 30-35% bandwidth reduction
- **Connection Pooling** - Optimized database performance
- **Memory Optimization** - Efficient Redis usage

### 💎 Monetization Features
- **VIP Subscriptions** - Premium features with Telegram Stars
- **Lock Chat Sessions** - Pay to extend conversations
- **Affiliate System** - Earn commission from referrals
- **Referral Rewards** - VIP days for inviting friends

### 📊 User Engagement
- **Daily Streaks** - Reward consecutive usage (coming soon)
- **Partner Rating** - Quality feedback system (coming soon)
- **Smart Matching** - Avoid recent partners (coming soon)
- **User Statistics** - Comprehensive analytics dashboard

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL
- Redis
- Telegram Bot Token

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/telegram-anonymous-chat-bot.git
cd telegram-anonymous-chat-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Setup environment**
```bash
# Copy the example file
cp .env.local.example .env.local

# Edit .env.local with your configuration
# Required variables:
# - BOT_TOKEN: Get from @BotFather
# - POSTGRES_URI: Your database connection string
# - ADMIN_TELEGRAM_IDS: Your Telegram ID (get from @userinfobot)
```

4. **Setup database**
```bash
# PostgreSQL
sudo -u postgres psql
CREATE DATABASE chatbot_db;
CREATE USER chatbot_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE chatbot_db TO chatbot_user;
\q

# Initialize schema
npm run init-schema
```

5. **Start the bot**
```bash
# Development (bot only)
npm run dev

# Production with PM2 cluster (bot + admin dashboard)
npm run cluster

# Start both bot and admin dashboard
node start-all.js
```

6. **Access Admin Dashboard**
```bash
# Open in browser
http://localhost:3000/admin/login

# See detailed guide
cat ADMIN_DASHBOARD_GUIDE.md
```

## 🌐 VPS Deployment

### Digital Ocean Setup ($12/mo recommended)

1. **Server Setup**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs -y

# Install dependencies
sudo apt install postgresql postgresql-contrib redis-server nginx -y
sudo npm install -g pm2
```

2. **Deploy Bot**
```bash
# Clone repository
git clone https://github.com/yourusername/telegram-anonymous-chat-bot.git
cd telegram-anonymous-chat-bot

# Setup environment
cp .env.example .env.production
# Edit .env.production with your settings

# Deploy
chmod +x deploy.sh
./deploy.sh
```

3. **Monitor**
```bash
pm2 status
pm2 logs chatbot
pm2 monit
```

## 📁 Project Structure

```
AnonStrangerChatbot/
│
├── bot.js
│   └── Entry point
│       - Initializes bots (multi-bot support)
│       - Loads feature flags
│       - Registers handlers
│
├── test-bot.js
│   └── Local testing / sandbox bot
│
├── package.json
├── Dockerfile
├── ecosystem.config.js
├── deploy.sh
│
├── config/
│   ├── config.js
│   │   └── Env config (BOT TOKENS, DB, REDIS, ADMIN_GROUP_ID)
│   
│   ├── featureFlags.js
│   │   └── ENABLE_VIP, ENABLE_LOCK_CHAT, ENABLE_STARS, etc.
│   
│   └── bots.js
│       └── Maps multiple bot tokens → botId
│
├── controllers/
│   ├── enhancedChatController.js
│   │   └── Search, match, stop, next, profile display
│   
│   ├── mediaController.js
│   │   └── Media relay (normal + view-once → admin)
│   
│   ├── paymentController.js
│   │   └── Telegram Stars payment entry point
│   
│   ├── adminController.js
│   │   └── Admin commands, alerts, stats
│   
│   └── referralController.js
│       └── Invite links, referral tracking
│
├── services/
│   ├── matchingService.js
│   │   └── VIP priority + gender filter matching
│   
│   ├── sessionService.js
│   │   └── Chat lifecycle, heartbeats, cleanup
│   
│   ├── vipService.js
│   │   └── VIP activation, expiry, checks
│   
│   ├── lockChatService.js
│   │   └── Paid lock chat logic & enforcement
│   
│   ├── paymentService.js
│   │   └── Telegram Stars verification & routing
│   
│   ├── referralService.js
│   │   └── Referrals + 80% internal affiliate rewards
│   
│   └── affiliateService.js
│       └── Converts Stars value → VIP days / lock credits
│
├── models/
│   ├── index.js
│   │   └── Sequelize init
│   
│   ├── userModel.js
│   │   └── Users table
│   
│   ├── chatModel.js
│   │   └── Chats table
│   
│   ├── vipSubscriptionModel.js
│   │   └── VIP subscriptions
│   
│   ├── starTransactionModel.js
│   │   └── Stars payments
│   
│   ├── lockChatModel.js
│   │   └── Lock chat history
│   
│   ├── referralModel.js
│   │   └── Referral mapping
│   
│   └── affiliateRewardModel.js
│       └── Internal rewards
│
├── database/
│   ├── connectionPool.js
│   │   └── PostgreSQL / SQLite pool
│   
│   ├── redisClient.js
│   │   └── Redis connection
│   
│   └── memoryRedis.js
│       └── Fallback for local dev
│
├── middlewares/
│   ├── authMiddleware.js
│   │   └── Channel join / access control
│   
│   ├── adminGuard.js
│   │   └── Protect admin commands
│   
│   └── featureGuard.js
│       └── Feature flag enforcement
│
├── utils/
│   ├── messages.js
│   │   └── Core text messages
│   
│   ├── enhancedMessages.js
│   │   └── Fun UI / emoji messages
│   
│   ├── keyboards.js
│   │   └── Telegram inline & reply keyboards
│   
│   ├── sessionManager.js
│   │   └── Session helpers
│   
│   ├── redisKeys.js
│   │   └── Central Redis key naming
│   
│   ├── rateLimiter.js
│   │   └── (Optional) Future rate limits
│   
│   ├── logger.js
│   │   └── Central logging
│   
│   └── helper.js
│       └── Shared utility helpers
│
├── jobs/
│   ├── cleanupJob.js
│   │   └── Expire chats, locks, sessions
│   
│   ├── vipExpiryJob.js
│   │   └── Downgrade expired VIPs
│   
│   └── referralAuditJob.js
│       └── Detect referral abuse
│
├── constants/
│   ├── starsPricing.js
│   │   └── VIP & lock pricing
│   
│   ├── limits.js
│   │   └── Lock limits, referral thresholds
│   
│   └── enums.js
│       └── Status enums
│
├── docs/
│   ├── README.md
│   ├── DEPLOYMENT.md
│   ├── STARS_MONETIZATION.md
│   ├── SECURITY.md
│   └── FUTURE_SCOPE.md
│
└── logs/
    ├── combined.log
    ├── error.log
    └── payments.log
```
## 🔧 Configuration

### Environment Variables
```env
# Comma-separated list of tokens for multiple bots (optional)
BOT_TOKENS=token1,token2
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=postgresql://user:pass@localhost:5432/db
REDIS_URL=redis://localhost:6379
ADMIN_CHAT_ID=your_admin_chat_id
REQUIRED_CHANNEL_1=@channel1
REQUIRED_CHANNEL_2=@channel2
NODE_ENV=production
```

**Note:** PM2's `ecosystem.config.js` now defaults to `script: 'bots.js'` which initializes all tokens found in `BOT_TOKENS` (falling back to single `BOT_TOKEN`).

### Bot Commands
- `/start` - Initialize profile setup
- `/search` - Find chat partner
- `/stop` - End current chat
- `/settings` - View/update settings
- `/rules` - Display chat rules
- `/myid` - Show Telegram ID

### Admin Commands
- `/ban <user_id>` - Ban user
- `/unban <user_id>` - Unban user
- `/broadcast <message>` - Send message to all users

## 📊 Scaling Information

### Resource Requirements
- **0-10K users**: 2GB RAM, 1 CPU ($12/mo)
- **10K-50K users**: 4GB RAM, 2 CPU ($24/mo)
- **50K-100K users**: 8GB RAM, 4 CPU ($48/mo)

### Performance Optimizations
- Connection pooling (5-20 connections)
- Redis caching (5-minute user cache)
- Rate limiting (90 msg/min per user)
- Smart session management
- Media compression (30-35% reduction)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- Create an [Issue](https://github.com/yourusername/telegram-anonymous-chat-bot/issues)
- Join our [Telegram Channel](https://t.me/your_support_channel)
- Email: your.email@example.com

## 🌟 Acknowledgments

- Built with [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- Database powered by [Sequelize](https://sequelize.org/)
- Process management by [PM2](https://pm2.keymetrics.io/)
- Image compression by [Sharp](https://sharp.pixelplumbing.com/)

---

⭐ **Star this repository if you found it helpful!**