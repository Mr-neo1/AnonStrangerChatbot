# 🚀 Production Documentation

## Complete Production Guide for 50k Users Per Bot

**Version:** 2.0.0  
**Last Updated:** 2026-01-16  
**Status:** Production Ready ✅

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Deployment Guide](#deployment-guide)
4. [Configuration](#configuration)
5. [Feature Workflows](#feature-workflows)
6. [Admin Panel Guide](#admin-panel-guide)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)
9. [Scaling Guide](#scaling-guide)
10. [Security Checklist](#security-checklist)

---

## 🏗️ System Overview

### What This Bot Does

A Telegram anonymous chat bot that:
- Connects random users for anonymous conversations
- Supports VIP subscriptions with priority matching
- Enables paid chat locking (prevent partner from skipping)
- Manages referrals and affiliate rewards
- Forwards all media to admin channel
- Provides comprehensive admin dashboard

### Key Features

1. **Anonymous Chat Matching**
   - Random pairing of users
   - VIP priority queue
   - Gender-based filtering (VIP only)
   - Recent partner avoidance

2. **VIP Subscriptions**
   - Multiple subscription plans (configurable)
   - Priority matching
   - Gender preference filtering
   - Auto-expiry handling

3. **Lock Chat**
   - Paid feature to lock chat sessions
   - Prevents partner from skipping
   - Multiple duration options
   - Credit-based system

4. **Referral System**
   - Unique referral links
   - VIP day rewards
   - Affiliate commission tracking
   - Abuse detection

5. **Admin Dashboard**
   - Web-based configuration (no restart needed)
   - User management (ban/unban)
   - Statistics and analytics
   - Broadcast messages
   - Bot token management

---

## 🏛️ Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                  TELEGRAM BOT API                      │
└──────────────────────┬──────────────────────────────────┘
                       │
           ┌───────────▼───────────┐
           │   PM2 Process Manager │
           │   (Cluster Mode)       │
           └───────────┬───────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│ Bot Instance │ │ Bot Instance│ │ Bot Instance│
│  (bots.js)   │ │  (bots.js)  │ │  (bots.js)  │
└───────┬──────┘ └─────┬───────┘ └─────┬───────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐        ┌──────────▼────────┐
│  PostgreSQL    │        │   Redis Cache     │
│  (Primary DB)  │        │   (3-min TTL)     │
└────────────────┘        └───────────────────┘
        │
┌───────▼────────┐
│ Admin Dashboard│
│  (Express)     │
│  Port 3001     │
└────────────────┘
```

### Data Flow

1. **User Message Flow:**
   ```
   User → Telegram API → PM2 Load Balancer → Bot Instance
   → Redis Cache Check (80% hit rate)
   → PostgreSQL (if cache miss)
   → Business Logic (Services)
   → Response to User
   ```

2. **Matching Flow:**
   ```
   User clicks "Find Partner"
   → Check VIP status
   → Enqueue in appropriate queue (VIP/Free)
   → Try immediate match
   → If no match: Show search message, wait in queue
   → When match found: Pair users, notify both
   ```

3. **Payment Flow:**
   ```
   User clicks "Buy Premium"
   → Show VIP plans
   → User selects plan
   → Telegram processes Stars payment
   → Verify payment
   → Activate VIP subscription
   → Update Redis cache
   → Notify user
   ```

---

## 🚀 Deployment Guide

### Prerequisites

- Node.js 16+ (18+ recommended)
- PostgreSQL 12+ (or SQLite for dev)
- Redis 6+ (optional, falls back to memory)
- PM2 (process manager)
- Telegram Bot Token(s)

### Step 1: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs -y

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Install Redis (optional but recommended)
sudo apt install redis-server -y

# Install PM2 globally
sudo npm install -g pm2
```

### Step 2: Database Setup

```bash
# Create database
sudo -u postgres psql
CREATE DATABASE chatbot_db;
CREATE USER chatbot_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE chatbot_db TO chatbot_user;
\q

# Test connection
psql -U chatbot_user -d chatbot_db -h localhost
```

### Step 3: Clone & Install

```bash
# Clone repository
git clone <your-repo-url> /app/chatbot
cd /app/chatbot

# Install dependencies
npm install --production

# Initialize database schema
npm run init-schema
```

### Step 4: Configuration

Create `.env` file:

```env
# Telegram Configuration
BOT_TOKENS=token1,token2,token3
BOT_TOKEN=token1
ADMIN_BOT_TOKEN=token1

# Admin Settings
ADMIN_TELEGRAM_IDS=123456789,987654321
ADMIN_CONTROL_CHAT_ID=-1001234567890
ADMIN_MEDIA_CHANNEL_ID=-1001234567890

# Required Channels (optional)
REQUIRED_CHANNEL_1=@your_channel
REQUIRED_CHANNEL_2=@another_channel

# Database
POSTGRES_URI=postgresql://chatbot_user:password@localhost:5432/chatbot_db
# OR for SQLite (dev only):
# SQLITE_DB_PATH=./chatbot.db

# Redis (optional)
REDIS_URL=redis://localhost:6379
# OR for memory fallback:
# REDIS_URL=memory://

# Feature Flags
ENABLE_STARS_PAYMENTS=true
ENABLE_VIP=true
ENABLE_LOCK_CHAT=true
ENABLE_REFERRALS=true
ENABLE_ADMIN_ALERTS=true
ENABLE_CROSS_BOT_MATCHING=true

# Environment
NODE_ENV=production
ADMIN_PORT=3001
LOG_LEVEL=INFO
```

### Step 5: Start Services

```bash
# Start with PM2
npm run cluster

# Check status
pm2 status

# View logs
pm2 logs

# Enable auto-start on reboot
pm2 startup
pm2 save
```

### Step 6: Verify Deployment

```bash
# Check bot is running
pm2 status

# Test bot
# Send /start to your bot on Telegram

# Check admin dashboard
curl http://localhost:3001/health
# Should return: {"status":"ok","timestamp":"..."}

# Access admin panel
# Open: http://your-server-ip:3001/admin/login
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BOT_TOKENS` | Yes | Comma-separated bot tokens | `token1,token2` |
| `ADMIN_TELEGRAM_IDS` | Yes | Comma-separated admin IDs | `123456789` |
| `POSTGRES_URI` | Yes* | PostgreSQL connection string | `postgresql://...` |
| `REDIS_URL` | No | Redis connection (or `memory://`) | `redis://localhost:6379` |
| `ADMIN_CONTROL_CHAT_ID` | Recommended | Admin alerts channel | `-1001234567890` |
| `ADMIN_MEDIA_CHANNEL_ID` | Recommended | Media forwarding channel | `-1001234567890` |
| `REQUIRED_CHANNEL_1` | No | Required channel for users | `@channel` |
| `ENABLE_STARS_PAYMENTS` | No | Enable Telegram Stars | `true` |
| `ENABLE_VIP` | No | Enable VIP subscriptions | `true` |
| `ENABLE_LOCK_CHAT` | No | Enable lock chat feature | `true` |
| `ENABLE_REFERRALS` | No | Enable referral system | `true` |
| `ADMIN_PORT` | No | Admin dashboard port | `3001` |
| `LOG_LEVEL` | No | Logging level (DEBUG/INFO/WARN/ERROR) | `INFO` |

*SQLite can be used for development (not recommended for production)

### Dynamic Configuration (Admin Panel)

These can be changed via admin dashboard without restart:

- VIP plan pricing and durations
- Lock chat pricing
- Required channels
- Affiliate commission rates
- Referral rewards
- Bot tokens (requires restart to apply)

---

## 🔄 Feature Workflows

### 1. User Registration Flow

```
1. User sends /start to bot
   ↓
2. Bot checks channel membership (if required)
   ↓
3. If not member: Show join button, block access
   ↓
4. If member: Show profile setup
   ↓
5. User selects gender (Male/Female/Other)
   ↓
6. User enters age (13-120)
   ↓
7. Profile saved to database
   ↓
8. Show main menu with "Find Partner" button
```

### 2. Partner Matching Flow

```
1. User clicks "🔍 Find Partner"
   ↓
2. Check if already in queue → Skip if yes
   ↓
3. Check VIP status
   ↓
4. Get gender preferences (if VIP)
   ↓
5. Enqueue in appropriate queue:
   - VIP users → queue:vip, queue:vip:gender:*
   - Free users → queue:free, queue:general
   ↓
6. Try immediate match:
   - Check VIP queues first (priority)
   - Match by gender preference (if VIP)
   - Avoid recent partners
   ↓
7a. If match found:
    - Create pair in Redis (pair:userId → partnerId)
    - Mark recent partners (20 min)
    - Increment chat counts
    - Send partner profiles to both users
    - Show active chat keyboard
   
7b. If no match:
    - Show search message
    - Start rotating search messages (every 3s)
    - Wait in queue for match
```

### 3. Chat Session Flow

```
1. Users matched and paired
   ↓
2. Users can send messages (text/media)
   ↓
3. Messages relayed to partner via BotRouter
   ↓
4. Media forwarded to admin channel
   ↓
5. Session marked as active (heartbeat)
   ↓
6. Users can:
   - Stop chat (if not locked)
   - Lock chat (if has credits)
   - Next partner (if not locked)
```

### 4. VIP Subscription Flow

```
1. User clicks "⭐ Buy Premium"
   ↓
2. Check if in active chat → Block if yes
   ↓
3. Show VIP plans from config
   ↓
4. User selects plan
   ↓
5. Telegram Stars payment initiated
   ↓
6. User completes payment
   ↓
7. Payment verified (pre_checkout_query)
   ↓
8. Create StarTransaction record
   ↓
9. Activate VIP subscription:
   - Create/update VipSubscription
   - Set Redis cache (with TTL)
   - Stack days if already VIP
   ↓
10. Notify user of activation
```

### 5. Lock Chat Flow

```
1. User clicks "🔒 Lock Chat"
   ↓
2. Verify user is in active chat
   ↓
3. Check lock credits:
   - If no credits: Show purchase options
   - If has credits: Show duration options
   ↓
4. User selects duration (5/10/15 min)
   ↓
5. Verify credits sufficient
   ↓
6. Create lock:
   - Create LockChat record
   - Set Redis locks (chat:locks:chatId:userId)
   - Consume credits
   ↓
7. Notify both users
   ↓
8. Lock prevents partner from skipping
```

### 6. Referral Flow

```
1. User gets referral link: /start ref_ABC123
   ↓
2. Bot tracks referrer (ABC123 → userId)
   ↓
3. New user completes profile
   ↓
4. Create Referral record
   ↓
5. Award referrer:
   - VIP days (configurable)
   - Affiliate credits (if applicable)
   ↓
6. Track referral in database
```

---

## 🎛️ Admin Panel Guide

### Accessing Admin Panel

1. Open: `http://your-server:3001/admin/login`
2. Enter your Telegram ID
3. Click "Request Login Code"
4. Send `/admin_login <code>` to your bot
5. Auto-redirected to dashboard

### Available Features

#### 1. Overview Dashboard
- Total users count
- Active VIP subscriptions
- Active chats
- Total Stars revenue

#### 2. User Management
- **View User:** `/api/users/:userId`
- **Ban User:** `POST /api/users/:userId/ban`
- **Unban User:** `POST /api/users/:userId/unban`
- **User Stats:** Gender, age, chat count, VIP status

#### 3. Configuration Management
- **Get Config:** `GET /api/config`
- **Update Config:** `POST /api/config` (single key)
- **Bulk Update:** `POST /api/config/bulk` (multiple keys)

**Configurable Items:**
- VIP plan pricing (stars) and durations (days)
- Lock chat pricing (per duration)
- Required channels
- Affiliate commission rates
- Referral rewards
- Bot tokens

#### 4. Statistics
- **Overview:** `GET /api/overview`
- **User Metrics:** `GET /api/users`
- **System Stats:** `GET /api/stats`
  - Total users
  - New users (today/week)
  - Active VIPs
  - Total Stars revenue
  - Active chats

#### 5. Broadcast Messages
- **Send Broadcast:** `POST /api/broadcast`
  - Message: Text to send
  - Audience: 'all', 'vip', 'free'

#### 6. Bot Management
- **List Bots:** `GET /api/bots`
- **Add Bot:** `POST /api/bots` (requires restart)
- **Remove Bot:** `DELETE /api/bots/:index` (requires restart)

### API Rate Limits

- `/api/broadcast`: 10 requests/hour
- `/api/stats`: 60 requests/minute
- `/api/config`: 30 requests/minute
- `/api/users`: 100 requests/minute
- `/api/request-login`: 5 requests/15 minutes
- Default: 100 requests/minute

---

## 📊 Monitoring & Maintenance

### Health Checks

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs --lines 100

# Check memory usage
pm2 monit

# Check database connection
psql -U chatbot_user -d chatbot_db -c "SELECT 1;"

# Check Redis connection
redis-cli ping
# Should return: PONG
```

### Log Files

- **Bot Logs:** `./logs/combined.log`
- **Error Logs:** `./logs/error.log`
- **Admin Logs:** `./logs/admin-err.log`, `./logs/admin-out.log`
- **Payment Logs:** `./logs/payments.log`
- **VIP Logs:** `./logs/vip.log`
- **Lock Logs:** `./logs/locks.log`

### Key Metrics to Monitor

1. **Memory Usage:** Should stay under 512MB per instance
2. **Database Connections:** Monitor pool usage
3. **Redis Memory:** Monitor memory usage
4. **Error Rate:** Check error.log for spikes
5. **Response Time:** Average should be <100ms
6. **Queue Sizes:** Monitor matching queues

### Maintenance Tasks

**Daily:**
- Check error logs
- Monitor memory usage
- Verify backups

**Weekly:**
- Review user statistics
- Check VIP expiry rates
- Review abuse reports

**Monthly:**
- Database optimization
- Log rotation
- Security audit

---

## 🔧 Troubleshooting

### Bot Not Responding

```bash
# Check if bot is running
pm2 status

# Restart bot
pm2 restart bot

# Check logs for errors
pm2 logs bot --lines 50

# Check Telegram API status
curl https://api.telegram.org/bot<TOKEN>/getMe
```

### Database Connection Issues

```bash
# Test connection
psql -U chatbot_user -d chatbot_db

# Check PostgreSQL status
sudo systemctl status postgresql

# Restart PostgreSQL
sudo systemctl restart postgresql

# Check connection pool
# Look for "Connection pool exhausted" in logs
```

### Redis Connection Issues

```bash
# Test Redis
redis-cli ping

# Check Redis status
sudo systemctl status redis

# Restart Redis
sudo systemctl restart redis

# Check memory usage
redis-cli INFO memory
```

### High Memory Usage

```bash
# Check memory per instance
pm2 monit

# Restart if > 512MB
pm2 restart bot

# Check for memory leaks
# Look for growing memory in logs
```

### Slow Response Times

1. Check database query performance
2. Check Redis cache hit rate (should be 80%+)
3. Monitor queue sizes
4. Check for blocking operations

---

## 📈 Scaling Guide

### Current Capacity (Optimized for 50k Users)

- **Per Bot Instance:** 2,000 concurrent users
- **Database Pool:** 30 connections
- **Redis Cache:** 3-minute TTL (80% hit rate)
- **Memory:** ~78MB per instance

### Scaling Path

**0-10k Users:**
- 1 bot instance
- 2GB RAM server
- PostgreSQL (basic)
- Redis (512MB)
- **Cost:** ~$12/month

**10k-25k Users:**
- 2-3 bot instances
- 4GB RAM server
- PostgreSQL (standard)
- Redis (1GB)
- **Cost:** ~$24/month

**25k-50k Users:**
- 4 bot instances
- 8GB RAM server
- PostgreSQL (premium)
- Redis (2GB)
- **Cost:** ~$48/month

**50k+ Users:**
- 6+ bot instances
- 16GB RAM server
- PostgreSQL (managed)
- Redis Cluster
- Load balancer
- **Cost:** ~$100+/month

### Scaling Commands

```bash
# Scale bot instances
pm2 scale bot 4

# Scale admin panel (if needed)
pm2 scale admin-panel 2

# Monitor scaling
pm2 monit
```

---

## 🔒 Security Checklist

### Pre-Deployment

- [ ] Change all default passwords
- [ ] Use strong database passwords
- [ ] Enable PostgreSQL SSL (if remote)
- [ ] Set secure Redis password
- [ ] Configure firewall (only allow necessary ports)
- [ ] Use HTTPS for admin panel (reverse proxy)
- [ ] Set secure cookie options
- [ ] Enable rate limiting
- [ ] Review admin Telegram IDs

### Runtime Security

- [ ] Monitor error logs for attacks
- [ ] Review user ban list regularly
- [ ] Check for abuse patterns
- [ ] Monitor API rate limits
- [ ] Review payment transactions
- [ ] Check for memory leaks
- [ ] Monitor database connections

### Data Security

- [ ] Regular database backups
- [ ] Encrypt sensitive data
- [ ] Secure admin session tokens
- [ ] Mask bot tokens in logs
- [ ] Don't expose internal APIs
- [ ] Validate all user inputs
- [ ] Sanitize broadcast messages

---

## 📝 Quick Reference

### Important Commands

```bash
# Start bot
npm run cluster

# Stop bot
npm run stop

# Restart bot
npm run restart

# View logs
npm run logs

# Monitor
npm run monit

# Status
npm run status
```

### Important Files

- **Bot Entry:** `bots.js`
- **Admin Server:** `server.js`
- **Config:** `.env`
- **PM2 Config:** `ecosystem.config.js`
- **Database Schema:** `init_schema.sql`

### Important URLs

- **Admin Login:** `http://localhost:3001/admin/login`
- **Admin Dashboard:** `http://localhost:3001/admin/dashboard`
- **Health Check:** `http://localhost:3001/health`

---

## 🆘 Support

### Common Issues

1. **409 Conflict Error:** Multiple bot instances running → Stop duplicates
2. **Channel Not Found:** Check channel ID format (@channel or -100XXXXX)
3. **Payment Not Working:** Verify ENABLE_STARS_PAYMENTS=true
4. **Admin Login Fails:** Check ADMIN_TELEGRAM_IDS configured

### Getting Help

1. Check logs: `pm2 logs`
2. Review error.log: `tail -f logs/error.log`
3. Check documentation: `COMPREHENSIVE_CODEBASE_ANALYSIS.md`
4. Review architecture: `ARCHITECTURE.md`

---

**Last Updated:** 2026-01-16  
**Version:** 2.0.0  
**Status:** Production Ready ✅
