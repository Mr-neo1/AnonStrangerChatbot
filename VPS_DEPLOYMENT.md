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
BOT_TOKEN=8176339587:AAGDG3YJon31xb-U4hp3lF2MxuyJ4mPgsPk
DATABASE_URL=postgresql://chatbot_user:your_secure_password@localhost:5432/chatbot_db
REDIS_URL=redis://localhost:6379
ADMIN_CHAT_ID=-1002355067849
REQUIRED_CHANNEL_1=@Stranger_Chatanonstrangerchat
REQUIRED_CHANNEL_2=@Informationchannelxyz
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