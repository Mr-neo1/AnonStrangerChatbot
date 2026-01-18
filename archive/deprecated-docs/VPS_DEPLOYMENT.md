# VPS Deployment Guide

## 1. VPS Setup Commands

### Initial Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs -y

# Install PM2 for process management
sudo npm install -g pm2

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Install Redis
sudo apt install redis-server -y

# Install Nginx
sudo apt install nginx -y
```

### Database Setup
```bash
# Setup PostgreSQL
sudo -u postgres psql
CREATE DATABASE chatbot_db;
CREATE USER chatbot_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE chatbot_db TO chatbot_user;
\q

# Start services
sudo systemctl start postgresql
sudo systemctl enable postgresql
sudo systemctl start redis
sudo systemctl enable redis
```

## 2. Project Deployment

### Upload Project
```bash
# Create project directory
mkdir /var/www/chatbot
cd /var/www/chatbot

# Upload your project files here
# Or use git clone if you have a repository
```

### Environment Configuration
```bash
# Create production .env
nano .env.production
```

### Install Dependencies
```bash
npm install --production
```

### Start with PM2
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

## 3. Production Environment Variables

Create `.env.production`:
```
# Comma-separated list of bot tokens for multi-bot support
BOT_TOKENS=token1,token2
BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_HERE
DATABASE_URL=postgresql://chatbot_user:YOUR_DB_PASSWORD@localhost:5432/chatbot_db
REDIS_URL=redis://localhost:6379
ADMIN_CHAT_ID=YOUR_ADMIN_CHAT_ID
REQUIRED_CHANNEL_1=@your_channel_1
REQUIRED_CHANNEL_2=@your_channel_2
# NOTE: Runtime model.sync has been removed entirely from the codebase to prevent automatic schema changes in production.
# and can modify existing DB tables. Keep it unset or false in production.
NODE_ENV=production
```

## 4. Nginx Configuration (Optional)
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 5. Monitoring Commands
```bash
# Check bot status
pm2 status

# View logs
pm2 logs chatbot

# Restart bot
pm2 restart chatbot

# Monitor resources
pm2 monit
```

**Ready to deploy! Follow steps 1-3 on your Digital Ocean VPS.**