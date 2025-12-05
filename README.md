# 🤖 Enhanced Telegram Anonymous Chat Bot

A feature-rich Telegram bot that connects strangers for anonymous conversations with modern UI/UX and performance optimizations.

## ✨ Features

### 🎯 Core Functionality
- **Anonymous Chat Pairing** - Connect random users worldwide
- **Channel Verification** - Users must join required channels
- **Profile Management** - Gender and age-based matching
- **Media Forwarding** - All media forwarded to admin channel
- **Admin Controls** - Ban/unban users, broadcast messages

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
cp .env.example .env
# Edit .env with your configuration
```

4. **Setup database**
```bash
# PostgreSQL
sudo -u postgres psql
CREATE DATABASE chatbot_db;
CREATE USER chatbot_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE chatbot_db TO chatbot_user;
\q
```

5. **Start the bot**
```bash
# Development
npm run dev

# Production
npm start
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
├── bot.js                          # Main bot entry point
├── config/
│   └── config.js                   # Configuration management
├── controllers/
│   ├── enhancedChatController.js   # Main chat logic with UI/UX
│   ├── mediaController.js          # Media handling
│   └── adminController.js          # Admin commands
├── database/
│   ├── connectionPool.js           # Optimized DB connections
│   ├── redisClient.js             # Redis client with fallback
│   └── memoryRedis.js             # In-memory Redis for development
├── middlewares/
│   └── authMiddleware.js          # Channel verification
├── models/
│   ├── userModel.js               # User data model
│   └── chatModel.js               # Chat session model
├── utils/
│   ├── keyboards.js               # Custom Telegram keyboards
│   ├── enhancedMessages.js        # Emoji-rich messages
│   ├── performance.js             # Caching and optimization
│   └── sessionManager.js          # Smart session handling
└── ecosystem.config.js            # PM2 configuration
```

## 🔧 Configuration

### Environment Variables
```env
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=postgresql://user:pass@localhost:5432/db
REDIS_URL=redis://localhost:6379
ADMIN_CHAT_ID=your_admin_chat_id
REQUIRED_CHANNEL_1=@channel1
REQUIRED_CHANNEL_2=@channel2
NODE_ENV=production
```

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