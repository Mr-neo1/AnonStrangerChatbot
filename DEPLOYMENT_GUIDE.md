# 🚀 Production Deployment Guide - Step by Step

## Prerequisites Check

Before deploying, ensure you have:

```bash
# Check Node.js version (must be 16+)
node --version  # v16.0.0 or higher

# Check PM2 is installed globally
pm2 --version

# Check PostgreSQL is accessible (if using production DB)
psql --version

# Check Redis is accessible (if using production cache)
redis-cli --version
```

## Step 1: Prepare VPS/Server

### On your VPS/Linux server:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js (if not present)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install PostgreSQL client (if using remote DB)
sudo apt install -y postgresql-client

# Install Git
sudo apt install -y git

# Create app directory
sudo mkdir -p /app/chatbot
sudo chown -R $USER:$USER /app/chatbot
```

## Step 2: Clone and Install Code

```bash
cd /app/chatbot

# Clone repository
git clone <your-repo-url> .

# Install dependencies
npm install --production

# Verify installation
npm list --depth=0
```

## Step 3: Configure Environment

### Create production `.env` file:

```bash
cat > .env << 'EOF'
# ============ TELEGRAM BOTS ============
BOT_TOKENS=YOUR_BOT_TOKEN_1,YOUR_BOT_TOKEN_2
ADMIN_BOT_TOKEN=YOUR_ADMIN_BOT_TOKEN

# ============ ADMIN CONFIGURATION ============
ADMIN_MEDIA_CHANNEL_ID=-100XXXXXXXXXX
ADMIN_CONTROL_CHAT_ID=XXXXXXXXXX
REQUIRED_CHANNEL_1=@your_channel_1
REQUIRED_CHANNEL_2=@your_channel_2

# ============ PRODUCTION DATABASE ============
POSTGRES_URI=postgresql://user:password@db.example.com:5432/chatbot_db
# Or use SQLite for development
DATABASE_URL=./chatbot.db

# ============ PRODUCTION CACHE ============
REDIS_URL=redis://cache.example.com:6379

# ============ ENVIRONMENT ============
NODE_ENV=production
PORT=3000

# ============ PAYMENT (OPTIONAL) ============
PAYMENT_API_KEY=your_payment_key
PAYMENT_WEBHOOK_SECRET=your_webhook_secret

# ============ LOGGING ============
LOG_LEVEL=info
EOF

# Verify .env was created
cat .env
```

### Verify critical variables:

```bash
# Check that .env has all required tokens
grep BOT_TOKENS .env
grep ADMIN_MEDIA_CHANNEL_ID .env
grep POSTGRES_URI .env
```

## Step 4: Prepare Database

### Option A: PostgreSQL (Recommended for 5k+ users)

```bash
# Create database
createdb -h db.example.com -U postgres chatbot_db

# Run migrations
npm run migrate

# Verify connection
npm run test-db
```

### Option B: SQLite (For < 5k users)

```bash
# Database auto-created on first run
# Just verify permission
touch chatbot.db
chmod 644 chatbot.db
```

## Step 5: Test Single Instance

```bash
# Start bot in development mode (single instance)
npm start

# Expected output:
# ✅ SQL Database Connected
# 🤖 Started bot bot_0 (isAdmin=true)
# 🚀 All bots initialized
# 🚀 Health check started

# Test by sending message to bot on Telegram
# Should see logs: ✅ Message received from user

# Stop with Ctrl+C
```

## Step 6: Setup PM2 Cluster Mode

### Start cluster (4 instances):

```bash
# Start with PM2
npm run cluster

# Expected output:
# [PM2] Starting 4 instances of chatbot-cluster
# ✅ [Instance 0] Bot started
# ✅ [Instance 1] Bot started
# ✅ [Instance 2] Bot started
# ✅ [Instance 3] Bot started
# 🚀 Cluster is ONLINE
```

### Verify cluster status:

```bash
# Check all instances are running
pm2 status

# Expected:
# id  name               mode      ↺     status     ▌ memory    
# 0   chatbot-cluster    cluster   0     online     76.2 MB
# 1   chatbot-cluster    cluster   0     online     77.4 MB
# 2   chatbot-cluster    cluster   0     online     76.8 MB
# 3   chatbot-cluster    cluster   0     online     77.1 MB

# View logs
pm2 logs --lines 50

# Monitor in real-time
pm2 monit
```

## Step 7: Enable PM2 Startup Hook

### Setup auto-start on system reboot:

```bash
# Generate startup script
sudo pm2 startup systemd -u $USER --hp /home/$USER

# Save current PM2 process list
pm2 save

# Verify it's saved
pm2 resurrect

# Test reboot will work
sudo reboot
# ... server comes back up
pm2 status  # Should show 4 instances running
```

## Step 8: Verify Production Deployment

### Test all endpoints:

```bash
# Verify bot is responding
curl -X GET http://localhost:3000/health  # If health endpoint exists

# Check PM2 logs for errors
pm2 logs --err --lines 20

# Monitor resource usage
pm2 monit

# Test Telegram:
# 1. Send message to bot on Telegram
# 2. Should receive response within 1 second
# 3. Check pm2 logs show message processing

# Load test (optional)
ab -n 1000 -c 10 http://localhost:3000/api/health
```

## Step 9: Setup Monitoring

### Option A: PM2 Plus (Recommended)

```bash
# Link to PM2 Plus account
pm2 link <secret_key> <public_key>

# Monitor from dashboard: app.pm2.io
```

### Option B: PM2 Web Dashboard

```bash
# Start web dashboard on port 9615
pm2 web

# Access at http://your-vps-ip:9615
```

### Option C: Custom Monitoring

```bash
# Setup cron job to monitor
(crontab -l 2>/dev/null; echo "*/5 * * * * pm2 status > /var/log/bot-status.log") | crontab -

# Check bot status every 5 minutes
tail -f /var/log/bot-status.log
```

## Step 10: Setup Log Rotation

```bash
# Install pm2-logrotate
pm2 install pm2-logrotate

# Verify it's installed
pm2 status  # Should show pm2-logrotate running

# Configure (optional)
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:compress true
```

## Production Commands Reference

```bash
# Start/Stop/Restart
npm run cluster          # Start 4 instances
npm run stop             # Stop all
npm run restart          # Restart all
npm run reload           # Zero-downtime reload (recommended)

# Monitoring
npm run status           # Show instance status
npm run logs             # View logs (last 100 lines)
npm run monit            # Live monitor

# Management
pm2 scale chatbot-cluster 8     # Scale to 8 instances
pm2 kill                         # Kill all PM2 processes
pm2 plus                         # Link to PM2 Plus monitoring
```

## Scaling Guide

### For 5k - 15k DAU:

```bash
# Scale to 6 instances
pm2 scale chatbot-cluster 6

# Upgrade database
# PostgreSQL: Standard tier (10GB)
# Redis: Standard tier (1GB)
```

### For 15k - 40k DAU:

```bash
# Scale to 8 instances
pm2 scale chatbot-cluster 8

# Upgrade database
# PostgreSQL: Premium tier (100GB)
# Redis: Premium tier (5GB)
# Add database replica for reads
```

### For 40k+ DAU:

```bash
# Consider:
# - Multiple PM2 clusters across regions
# - Database sharding by user_id
# - Redis Cluster for distributed caching
# - CDN for media delivery
# - Load balancer (Nginx/HAProxy)
```

## Troubleshooting

### Bot not starting?

```bash
pm2 logs --err  # Check error logs
pm2 describe 0  # Get instance details
```

### High memory usage?

```bash
# Check memory per instance
pm2 monit

# If > 500MB, scale down or increase Node max memory
pm2 scale chatbot-cluster 2
```

### Redis connection error?

```bash
# Verify Redis is accessible
redis-cli -h redis.example.com PING

# Update REDIS_URL in .env
# Restart cluster
npm run reload
```

### Database connection error?

```bash
# Verify PostgreSQL is accessible
psql -h db.example.com -U user chatbot_db

# Check POSTGRES_URI in .env
# Verify database user permissions
# Restart cluster
npm run reload
```

## Security Checklist

- [ ] `.env` file permissions set to 600: `chmod 600 .env`
- [ ] `.env` file not in git: Check `.gitignore`
- [ ] PostgreSQL password is strong (16+ chars)
- [ ] Redis password enabled (if accessible from internet)
- [ ] Firewall blocks all ports except 22 (SSH)
- [ ] PM2 logs don't contain sensitive data
- [ ] Regular backups enabled for PostgreSQL
- [ ] SSL certificate enabled if using external URLs
- [ ] Admin bot token is secure and rotated monthly

## Backup Strategy

```bash
# PostgreSQL backup (daily)
pg_dump -h db.example.com -U user chatbot_db > /backups/db-$(date +%Y%m%d).sql

# Or setup automated backup:
sudo pg_dump -h db.example.com -U user chatbot_db > /backups/db-$(date +\%Y\%m\%d).sql
# Add to crontab: 0 2 * * * /path/to/backup-script.sh
```

## Maintenance Window

```bash
# Reload code without downtime (zero-downtime deployment)
git pull origin main
npm install
npm run reload

# Or scale down, update, scale back up
pm2 scale chatbot-cluster 1
npm install
npm run reload
pm2 scale chatbot-cluster 4
```

---

## ✅ Deployment Checklist

- [ ] Prerequisites installed (Node, PM2, PostgreSQL)
- [ ] Code cloned from Git
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` configured with all required variables
- [ ] Database created and migrations run
- [ ] Single instance tested with `npm start`
- [ ] Cluster started with `npm run cluster`
- [ ] All 4 instances online (`pm2 status`)
- [ ] PM2 startup hook enabled (auto-start on reboot)
- [ ] Monitoring setup (PM2 Plus or web dashboard)
- [ ] Log rotation configured
- [ ] Security checklist completed
- [ ] Backup strategy implemented
- [ ] Ready for production! 🚀

---

**Estimated deployment time: 15-20 minutes**

For issues, check [PRODUCTION.md](PRODUCTION.md) or [PM2_CLUSTER_GUIDE.md](PM2_CLUSTER_GUIDE.md)
