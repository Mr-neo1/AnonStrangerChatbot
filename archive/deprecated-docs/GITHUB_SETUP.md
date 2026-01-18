# 🚀 GitHub Setup & VPS Deployment

## 1. Initialize Git Repository

```bash
# Initialize git
git init

# Add all files
git add .

# First commit
git commit -m "🎉 Initial commit: Enhanced Telegram Anonymous Chat Bot

✨ Features:
- Custom keyboard UI with emoji buttons
- Enhanced messages with markdown formatting
- Media compression (30-35% reduction)
- Rate limiting (90 msg/min per user)
- Smart session management
- Performance optimizations
- PostgreSQL + Redis support
- PM2 process management
- VPS deployment ready

🎯 Ready for 100K+ users on $12/mo VPS"

# Add remote repository (replace with your GitHub repo URL)
git remote add origin https://github.com/yourusername/telegram-anonymous-chat-bot.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## 2. VPS Deployment from GitHub

```bash
# On your VPS, clone the repository
git clone https://github.com/yourusername/telegram-anonymous-chat-bot.git
cd telegram-anonymous-chat-bot

# Setup environment
cp .env.example .env
nano .env  # Add your bot token and settings

# Run deployment script
chmod +x deploy.sh
./deploy.sh
```

## 3. Environment Variables for VPS

Edit `.env` on VPS:
```env
BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_HERE
DATABASE_URL=postgresql://chatbot_user:YOUR_DB_PASSWORD@localhost:5432/chatbot_db
REDIS_URL=redis://localhost:6379
ADMIN_CHAT_ID=YOUR_ADMIN_CHAT_ID
REQUIRED_CHANNEL_1=@your_channel_1
REQUIRED_CHANNEL_2=@your_channel_2
NODE_ENV=production
```

## 4. Quick Commands

```bash
# Check bot status
pm2 status

# View logs
pm2 logs chatbot

# Restart bot
pm2 restart chatbot

# Update from GitHub
git pull origin main
pm2 restart chatbot
```

**🎯 Ready to deploy! Your bot will handle thousands of users smoothly.**