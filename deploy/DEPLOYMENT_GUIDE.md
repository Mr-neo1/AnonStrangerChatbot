# 🚀 VPS Deployment Guide

## Prerequisites
- Ubuntu 24.04 VPS (2GB RAM, 1 vCPU)
- SSH access to VPS
- Old bot's SQLite database file

---

## Step 1: Connect to VPS

```bash
ssh root@YOUR_VPS_IP
```

---

## Step 2: Run Setup Script

Upload and run the setup script:

```bash
# Create deployment directory
mkdir -p /opt/chatbot
cd /opt/chatbot

# Upload setup script (from your local machine)
# scp deploy/setup-vps.sh root@YOUR_VPS_IP:/opt/chatbot/

# Make executable and run
chmod +x setup-vps.sh
./setup-vps.sh
```

---

## Step 3: Upload Your Code

From your **local machine** (PowerShell):

```powershell
# Navigate to your project folder
cd C:\Users\rkrai\OneDrive\Desktop\VsCode\AnonStrangerChatbot

# Upload entire project (excluding node_modules)
scp -r ./* root@YOUR_VPS_IP:/opt/chatbot/
# OR use rsync (faster for updates):
# rsync -avz --exclude 'node_modules' --exclude '.git' ./ root@YOUR_VPS_IP:/opt/chatbot/
```

---

## Step 4: Configure Environment

On VPS:

```bash
cd /opt/chatbot

# Edit .env file with production settings
nano .env.production

# Copy to .env
cp .env.production .env
```

---

## Step 5: Migrate Old Users (if needed)

```bash
# First, upload old SQLite database from old VPS
# scp old-vps:/path/to/chatbot.db /opt/chatbot/old_data/

# Run migration
node deploy/migrate-users.js /opt/chatbot/old_data/chatbot.db
```

---

## Step 6: Start Application

```bash
cd /opt/chatbot

# Install dependencies
npm install --production

# Initialize database tables
node scripts/init-postgres-schema.js

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 config (auto-restart on reboot)
pm2 save
pm2 startup
```

---

## Step 7: Verify Everything Works

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs

# Test admin panel
curl http://localhost:4000/health

# Check PostgreSQL
sudo -u postgres psql -c "SELECT COUNT(*) FROM \"Users\";" chatbot_production

# Check Redis
redis-cli ping
```

---

## 📊 Useful Commands

### PM2 Management
```bash
pm2 status              # View status
pm2 logs                # View logs
pm2 logs --lines 100    # Last 100 lines
pm2 restart all         # Restart all
pm2 reload all          # Zero-downtime reload
pm2 monit               # Live monitoring
pm2 stop all            # Stop all
```

### Database
```bash
# PostgreSQL shell
sudo -u postgres psql chatbot_production

# Useful queries
SELECT COUNT(*) FROM "Users";
SELECT * FROM "Users" LIMIT 10;
SELECT * FROM "AppConfigs" WHERE key LIKE 'msg_%';
```

### Redis
```bash
redis-cli
> KEYS pair:*           # Active chats
> KEYS queue:*          # Users in queue
> DBSIZE                # Total keys
```

### Logs
```bash
# PM2 logs
pm2 logs bot --lines 50
pm2 logs admin --lines 50

# System logs
journalctl -u postgresql -f
journalctl -u redis -f
```

---

## 🔄 Updating the Bot

```bash
cd /opt/chatbot

# Pull latest code (if using git)
git pull

# Or upload new files via scp

# Install any new dependencies
npm install --production

# Reload without downtime
pm2 reload all
```

---

## 🛡️ Security Recommendations

1. **Firewall**: Only open necessary ports
```bash
sudo ufw allow 22        # SSH
sudo ufw allow 4000      # Admin panel (or restrict to your IP)
sudo ufw enable
```

2. **Change default PostgreSQL password**
3. **Use strong ADMIN_PASSWORD in .env**
4. **Keep system updated**: `sudo apt update && sudo apt upgrade`

---

## 🐛 Troubleshooting

### Bot not starting
```bash
pm2 logs bot --lines 100
# Check for errors
```

### Database connection failed
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -U postgres -h localhost -d chatbot_production
```

### Redis connection failed
```bash
# Check Redis is running
sudo systemctl status redis

# Test connection
redis-cli ping
```

### Out of memory
```bash
# Check memory usage
free -h
pm2 monit

# Reduce PM2 instances in ecosystem.config.js
```
