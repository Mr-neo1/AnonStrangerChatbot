# 🚀 GitHub Push & VPS Deployment Steps

## Step 1: Push to GitHub

### 1.1 Commit All Changes
```bash
git add .
git commit -m "✨ Major Update: Fixed message forwarding, added profile features

🐛 Bug Fixes:
- Fixed message forwarding (exact button text matching)
- Fixed Memory Redis multi() error
- Fixed self-connection prevention

✨ New Features:
- My Profile feature with complete user info
- Settings menu for profile updates
- Daily streak tracking
- Total chats counter
- Smart partner matching (avoid recent partners)

📱 Enhanced UI/UX:
- All media types supported (audio, video notes, GIFs)
- Better error messages
- Debug logging for troubleshooting
- Improved button handlers

🔧 Technical Improvements:
- Database schema updated with statistics fields
- Enhanced session management
- Better rate limiting
- Optimized Redis operations"
```

### 1.2 Create GitHub Repository
1. Go to https://github.com/new
2. Repository name: `telegram-anonymous-chat-bot`
3. Description: `Enhanced Telegram Anonymous Chat Bot with Custom UI`
4. Choose Public or Private
5. Don't initialize with README
6. Click "Create repository"

### 1.3 Push to GitHub
```bash
# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/telegram-anonymous-chat-bot.git

# Push to main branch
git branch -M main
git push -u origin main
```

## Step 2: VPS Deployment

### 2.1 Initial VPS Setup (First Time Only)
```bash
# SSH into your VPS
ssh root@your_vps_ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs -y

# Install dependencies
sudo apt install postgresql postgresql-contrib redis-server nginx -y

# Install PM2
sudo npm install -g pm2

# Setup PostgreSQL
sudo -u postgres psql
CREATE DATABASE chatbot_db;
CREATE USER chatbot_user WITH ENCRYPTED PASSWORD 'chatbot_secure_2024';
GRANT ALL PRIVILEGES ON DATABASE chatbot_db TO chatbot_user;
\q

# Start services
sudo systemctl start postgresql redis-server
sudo systemctl enable postgresql redis-server
```

### 2.2 Deploy Bot (First Time)
```bash
# Clone repository
cd /var/www
git clone https://github.com/YOUR_USERNAME/telegram-anonymous-chat-bot.git
cd telegram-anonymous-chat-bot

# Create production environment
cp .env.example .env
nano .env
# Update with your production values:
# BOT_TOKEN=your_token
# DATABASE_URL=postgresql://chatbot_user:chatbot_secure_2024@localhost:5432/chatbot_db
# REDIS_URL=redis://localhost:6379
# ADMIN_CHAT_ID=your_admin_id
# REQUIRED_CHANNEL_1=@your_channel1
# REQUIRED_CHANNEL_2=@your_channel2
# NODE_ENV=production

# Install dependencies
npm install --production

# Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### 2.3 Update Deployment (After Changes)
```bash
# SSH into VPS
ssh root@your_vps_ip

# Navigate to project
cd /var/www/telegram-anonymous-chat-bot

# Pull latest changes
git pull origin main

# Install any new dependencies
npm install --production

# Restart bot
pm2 restart chatbot

# Check status
pm2 status
pm2 logs chatbot --lines 50
```

## Step 3: Monitoring & Maintenance

### Check Bot Status
```bash
pm2 status
pm2 logs chatbot
pm2 monit
```

### View Logs
```bash
pm2 logs chatbot --lines 100
pm2 logs chatbot --err  # Error logs only
```

### Restart Bot
```bash
pm2 restart chatbot
```

### Stop Bot
```bash
pm2 stop chatbot
```

### Database Backup
```bash
# Backup PostgreSQL
pg_dump -U chatbot_user chatbot_db > backup_$(date +%Y%m%d).sql

# Restore if needed
psql -U chatbot_user chatbot_db < backup_20241206.sql
```

## Step 4: Quick Update Script

Create `update.sh` for easy updates:
```bash
#!/bin/bash
echo "🔄 Updating bot..."
git pull origin main
npm install --production
pm2 restart chatbot
echo "✅ Bot updated and restarted!"
pm2 logs chatbot --lines 20
```

Make it executable:
```bash
chmod +x update.sh
```

Use it:
```bash
./update.sh
```

## Troubleshooting

### Bot Not Starting
```bash
pm2 logs chatbot --err
# Check for errors in logs
```

### Database Connection Issues
```bash
# Test PostgreSQL connection
psql -U chatbot_user -d chatbot_db -c "SELECT 1;"
```

### Redis Connection Issues
```bash
# Test Redis
redis-cli ping
# Should return: PONG
```

### Port Already in Use
```bash
# Find process using port
lsof -i :3000
# Kill if needed
kill -9 PID
```

## Success Checklist
- [ ] Code pushed to GitHub
- [ ] VPS setup complete
- [ ] Bot running with PM2
- [ ] Database connected
- [ ] Redis connected
- [ ] Bot responding in Telegram
- [ ] Messages forwarding correctly
- [ ] Media sharing works
- [ ] All buttons functional

**Your bot is now deployed and running! 🎉**