# Production Deployment Guide

## Quick Start - Production Deployment

### 1. Prerequisites
```bash
# Node.js >= 14.0
# PM2 installed globally
npm install -g pm2
```

### 2. Installation
```bash
git clone <your-repo-url>
cd AnonStrangerChatbot
npm install --production
```

### 3. Environment Setup
```bash
# Copy and configure
cp .env.example .env

# Required variables:
POSTGRES_URI=postgresql://...  # Production database
REDIS_URL=redis://...          # Redis instance
BOT_TOKENS=token1,token2        # Telegram bot tokens
ADMIN_MEDIA_CHANNEL_ID=-100123456789  # Numeric channel ID
```

### 4. Start in Cluster Mode
```bash
# Deploy with 4 instances
pm2 start ecosystem.config.js --env production

# Save configuration (for auto-startup)
pm2 save

# Enable auto-restart on reboot
pm2 startup
```

### 5. Monitoring
```bash
pm2 status              # View all instances
pm2 logs                # View logs
pm2 monit               # Live monitoring
```

### 6. Zero-Downtime Updates
```bash
git pull origin main
npm install
pm2 reload all          # Zero-downtime reload
```

---

## Architecture

### Cluster Mode (4 instances)
- **Load Balancing:** Automatic across 4 Node.js processes
- **Max Concurrent:** 8,000 users
- **Max DAU:** 20,000-30,000
- **Memory:** ~300MB total

### Database
- **Production:** PostgreSQL (required for 5k+ DAU)
- **Cache:** Redis (required for 10k+ DAU)
- **In-Memory Fallback:** SQLite + Memory Redis (development only)

### Features
- ✅ 2 Telegram bots per instance
- ✅ User-to-user pairing & messaging
- ✅ Media forwarding with privacy
- ✅ VIP subscriptions
- ✅ Admin monitoring
- ✅ Referral system
- ✅ Affiliate rewards

---

## Key Files

### Production Configuration
- `ecosystem.config.js` - PM2 cluster configuration
- `.env` - Environment variables (never commit)
- `package.json` - Dependencies

### Application
- `bots.js` - Bot bootstrap & cluster support
- `bot.js` - Bot initialization & polling
- `config/config.js` - Configuration management
- `database/connectionPool.js` - PostgreSQL/SQLite support

### Core Services
- `controllers/enhancedChatController.js` - Message handling
- `controllers/mediaController.js` - Media forwarding
- `services/matchingService.js` - User pairing
- `services/userCacheService.js` - Performance optimization

---

## Scaling Guide

### 5,000 DAU (Current Scale)
- 2-4 CPU cores VPS
- 4GB RAM
- PostgreSQL: Production tier
- Redis: Free tier
- Cost: $10-20/month

### 15,000 DAU (Scale Up)
- 4-8 CPU cores
- 8GB RAM
- PostgreSQL: Premium tier with replicas
- Redis Cloud: Pro tier
- Cost: $50-100/month
- PM2: Scale to 8 instances

### 30,000-40,000 DAU (Enterprise)
- 8+ CPU cores
- 16GB RAM
- PostgreSQL: Dedicated server + read replicas
- Redis: Cluster mode
- Cost: $200-500/month
- PM2: Scale to 16+ instances

---

## Troubleshooting

### Logs
```bash
pm2 logs                    # All instances
pm2 logs 0                  # Specific instance
pm2 logs --lines 100        # Last 100 lines
pm2 logs --err              # Errors only
```

### Instance Health
```bash
pm2 status
pm2 describe 0              # Detailed info
pm2 show chatbot-cluster    # Configuration
```

### Restart Issues
```bash
pm2 restart all             # Restart all
pm2 reload all              # Zero-downtime reload
pm2 delete all              # Remove all
pm2 kill                    # Stop daemon
```

### Memory Issues
```bash
pm2 monit                   # Check memory usage
pm2 scale chatbot-cluster 2 # Reduce instances
# Edit ecosystem.config.js: max_memory_restart value
```

---

## Monitoring Checklist

Daily:
- [ ] Check PM2 status: `pm2 status`
- [ ] Review error logs: `pm2 logs --err --lines 50`
- [ ] Verify all 4 instances online

Weekly:
- [ ] Check memory trends: `pm2 monit`
- [ ] Review restart count (should be 0-1)
- [ ] Test zero-downtime reload: `pm2 reload all`

Monthly:
- [ ] Analyze performance metrics
- [ ] Review database query logs
- [ ] Plan scaling if approaching limits

---

## Security Best Practices

1. **Environment Variables**
   - Never commit `.env` file
   - Use strong tokens and passwords
   - Rotate credentials quarterly

2. **Database**
   - Enable SSL connections
   - Use strong database passwords
   - Backup daily
   - Enable point-in-time recovery

3. **Redis**
   - Use password authentication
   - Enable TLS encryption
   - Restrict network access

4. **Application**
   - Keep dependencies updated
   - Run security audits: `npm audit`
   - Monitor logs for abuse patterns
   - Implement rate limiting

5. **VPS**
   - Enable firewall
   - Use SSH keys (no password)
   - Regular security patches
   - Monitor resource usage

---

## Performance Tips

1. Use PostgreSQL (not SQLite)
2. Enable Redis caching
3. Use PM2 cluster mode
4. Monitor memory usage
5. Set max_memory_restart appropriately
6. Use pm2-logrotate to manage logs
7. Enable connection pooling
8. Optimize database queries with indexes

---

## Support Commands

```bash
# Update PM2
npm install -g pm2@latest
pm2 update

# Logs management
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M

# Monitor
pm2 web                    # Web dashboard (port 9615)
pm2 link <key> <secret>    # Link to PM2 Plus

# Scale
pm2 scale chatbot-cluster +2  # Add 2 instances
pm2 scale chatbot-cluster -2  # Remove 2 instances
pm2 scale chatbot-cluster 8   # Set to 8 instances
```

---

## Deployment Checklist

Before going live:
- [ ] Environment variables configured
- [ ] PostgreSQL database setup
- [ ] Redis instance running
- [ ] Bot tokens valid
- [ ] Admin channel ID configured (numeric)
- [ ] Logs directory exists
- [ ] PM2 startup script configured
- [ ] SSL/TLS enabled (recommended)
- [ ] Firewall rules configured
- [ ] Monitoring setup (pm2 monit, logs)
- [ ] Backup strategy in place
- [ ] Load test (1000+ concurrent users)

---

## Next Steps

1. Deploy to VPS
2. Monitor performance
3. When reaching 5k DAU, migrate to PostgreSQL + Redis
4. When reaching 15k DAU, scale to 8 instances
5. When reaching 30k DAU, add read replicas
