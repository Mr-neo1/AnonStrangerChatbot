# ✅ Production Deployment Checklist

## Pre-Deployment (Local)

### Code & Dependencies
- [ ] All tests pass locally
- [ ] No `console.log` statements in production code
- [ ] Environment variables use `.env` file
- [ ] `.gitignore` includes `.env` and `node_modules/`
- [ ] No hardcoded secrets in code
- [ ] Dependencies are pinned (`package-lock.json` committed)
- [ ] All imports are correct and not circular
- [ ] Code follows consistent style (no linting errors)

### Configuration
- [ ] `.env.example` created with all variables
- [ ] All required environment variables documented
- [ ] `ecosystem.config.js` has correct configuration
- [ ] `max_memory_restart` set to 1GB per instance
- [ ] `wait_ready: true` configured for PM2
- [ ] Instance count = 4 for production

### Documentation
- [ ] `README_PRODUCTION.md` is clear and complete
- [ ] `DEPLOYMENT_GUIDE.md` has step-by-step instructions
- [ ] `PRODUCTION.md` covers architecture and scaling
- [ ] `PM2_CLUSTER_GUIDE.md` explains PM2 usage
- [ ] `.env.example` is complete with all options
- [ ] All documentation is up-to-date

### Database
- [ ] Database schema is finalized
- [ ] All migrations are reversible
- [ ] Connection pooling configured (50 connections for PostgreSQL)
- [ ] Database backups are automated
- [ ] Test connection with target database works

### Security
- [ ] No sensitive data in git history
- [ ] `.env` file is in `.gitignore`
- [ ] Bot tokens are stored securely
- [ ] Database credentials are encrypted
- [ ] Redis password is strong (if exposed to internet)
- [ ] Admin channel ID is numeric (not @username)
- [ ] All secrets are in environment variables

## Deployment (VPS)

### Pre-Deployment
- [ ] VPS has Node.js 16+ installed
- [ ] PM2 is installed globally
- [ ] PostgreSQL client installed (if needed)
- [ ] Redis accessible from VPS
- [ ] Port 22 (SSH) is open
- [ ] Firewall configured (block all except SSH)

### Installation
- [ ] Code cloned from git
- [ ] `npm install --production` completed
- [ ] `.env` file created from `.env.example`
- [ ] All environment variables verified
- [ ] Database accessible with provided credentials
- [ ] PostgreSQL migrations ran successfully

### Startup
- [ ] Tested `npm start` (single instance) - works
- [ ] Tested `npm run cluster` (4 instances) - all online
- [ ] `pm2 status` shows 4 instances: chatbot-cluster 0-3
- [ ] Memory usage: ~77MB per instance (total ~310MB)
- [ ] No startup errors in `pm2 logs`

### Verification
- [ ] Send test message to bot on Telegram
- [ ] Bot responds within 1 second
- [ ] Admin media channel receives notifications
- [ ] Logs show message processing: `pm2 logs`
- [ ] No errors in `pm2 logs --err`
- [ ] Health check shows all bots active

### Post-Startup
- [ ] `pm2 save` - process list saved
- [ ] `pm2 startup` - auto-start on reboot configured
- [ ] Monitor memory usage: `pm2 monit`
- [ ] Review logs for warnings: `pm2 logs`
- [ ] Test graceful shutdown: `pm2 stop all`
- [ ] Verify auto-restart: `pm2 start ecosystem.config.js`

## Monitoring Setup

### PM2 Monitoring
- [ ] PM2 Plus account created (optional)
- [ ] Cluster linked to PM2 Plus: `pm2 link <key>`
- [ ] PM2 web dashboard accessible: `pm2 web`
- [ ] Can view logs, CPU, memory from dashboard

### System Monitoring
- [ ] Log rotation configured: `pm2 install pm2-logrotate`
- [ ] Logs auto-rotate after 100MB
- [ ] Old logs compressed and archived
- [ ] Disk space monitoring enabled
- [ ] Alert system configured (if available)

### Performance Monitoring
- [ ] Memory usage tracked and alerts set
- [ ] Response time baseline established
- [ ] Database query performance monitored
- [ ] Redis cache hit rate tracked
- [ ] Error rate monitoring enabled

## Health Checks

### Functionality Tests
- [ ] Send message - bot responds
- [ ] Send media - forwarded to admin channel
- [ ] Create user - saved to database
- [ ] Find match - user paired with stranger
- [ ] Admin commands - work correctly
- [ ] VIP features - function properly

### Load Tests (Optional)
- [ ] Simulate 100 concurrent users - stable
- [ ] Simulate 1000 messages/minute - no lag
- [ ] Monitor CPU during load - stays < 50%
- [ ] Monitor memory during load - stable
- [ ] Monitor database connections - within limits

### Failover Tests
- [ ] Kill one instance - others handle traffic
- [ ] Restart cluster - all instances come online
- [ ] Database unavailable - graceful error
- [ ] Redis unavailable - fallback to memory
- [ ] Network latency - bot still responsive

## Maintenance Plan

### Daily
- [ ] Check `pm2 status` - all instances online
- [ ] Review error logs: `pm2 logs --err --lines 50`
- [ ] Monitor memory usage: `pm2 monit`
- [ ] Verify backups ran

### Weekly
- [ ] Review performance trends
- [ ] Check database size and growth
- [ ] Verify log rotation is working
- [ ] Review security logs for suspicious activity
- [ ] Test backup restoration (1x per month)

### Monthly
- [ ] Update dependencies: `npm update`
- [ ] Review and rotate secrets
- [ ] Analyze usage patterns
- [ ] Plan for scaling if needed
- [ ] Update documentation with learnings

### Quarterly
- [ ] Major security review
- [ ] Performance optimization review
- [ ] Capacity planning assessment
- [ ] Disaster recovery drill
- [ ] Code audit and refactoring

## Scaling Plan

### 5k Users (Current Capacity)
- [ ] 4 PM2 instances ✅
- [ ] SQLite or PostgreSQL 5GB
- [ ] Redis for user cache
- [ ] Works fine as-is

### 10k Users
- [ ] Scale to 6 instances: `pm2 scale chatbot-cluster 6`
- [ ] Upgrade PostgreSQL to 20GB tier
- [ ] Enable Redis persistence
- [ ] Monitor response times

### 20k Users
- [ ] Scale to 8 instances: `pm2 scale chatbot-cluster 8`
- [ ] Upgrade PostgreSQL to 50GB tier
- [ ] Add database read replica
- [ ] Setup Redis Cluster

### 40k+ Users
- [ ] Consider multiple PM2 clusters
- [ ] Database sharding by user_id
- [ ] Dedicated Redis cluster
- [ ] Load balancer (Nginx/HAProxy)
- [ ] Consider microservices

## Troubleshooting Reference

### Bot Not Responding
1. Check status: `pm2 status`
2. Check logs: `pm2 logs --err`
3. Verify bot token: `grep BOT_TOKENS .env`
4. Check database connection: `npm run test-db`
5. Restart cluster: `npm run reload`

### High Memory Usage
1. Check current usage: `pm2 monit`
2. Check memory trend: `pm2 logs | grep memory`
3. Reduce instances if necessary: `pm2 scale chatbot-cluster 2`
4. Investigate memory leaks: `node --inspect=0.0.0.0:9229 bot.js`

### Database Connection Errors
1. Verify PostgreSQL is running
2. Check connection string: `grep POSTGRES_URI .env`
3. Verify credentials are correct
4. Check if database exists and user has permissions
5. Try connection: `psql -h host -U user -d dbname`

### Redis Connection Errors
1. Verify Redis is running
2. Check connection string: `grep REDIS_URL .env`
3. Verify Redis password if required
4. Try connection: `redis-cli -h host PING`
5. Check firewall rules

## Rollback Plan

If deployment has critical issues:

### Option 1: Rollback Code
```bash
git revert <commit-hash>
npm install
npm run reload
```

### Option 2: Restore from Backup
```bash
# Restore database from backup
psql -h host -U user dbname < backup-2024-01-15.sql

# Restart cluster
npm run restart
```

### Option 3: Full Rollback
```bash
# Stop current cluster
npm run stop

# Checkout previous version
git checkout v1.0

# Reinstall and restart
npm install
npm run cluster
```

## Go-Live Decision Checklist

**Go-Live only after ALL checkboxes are checked:**

- [ ] All pre-deployment checks passed
- [ ] Code tested locally and on staging
- [ ] All 4 instances online and healthy
- [ ] Database verified with backup
- [ ] Monitoring and alerts configured
- [ ] Team trained on procedures
- [ ] Rollback plan documented
- [ ] Support team on standby
- [ ] Maintenance window scheduled if needed
- [ ] Stakeholders notified of go-live time

---

## 🎉 Deployment Complete!

Once all checks are complete:

1. Monitor for first 24 hours
2. Keep team on alert for issues
3. Review logs daily for first week
4. Gradually increase load testing
5. Celebrate successful deployment! 🚀

---

**Critical Commands During Deployment:**

```bash
# Start production cluster
npm run cluster

# Watch status in real-time
pm2 monit

# View logs
pm2 logs

# Stop if emergency
npm run stop

# Reload without downtime
npm run reload
```

**Support Resources:**

- **Deployment Issues:** See `DEPLOYMENT_GUIDE.md`
- **PM2 Help:** See `PM2_CLUSTER_GUIDE.md`
- **Architecture:** See `PRODUCTION.md`
- **Quick Reference:** See `README_PRODUCTION.md`

---

**Last Updated:** Production Cleanup Complete
**Status:** 🟢 READY FOR DEPLOYMENT
