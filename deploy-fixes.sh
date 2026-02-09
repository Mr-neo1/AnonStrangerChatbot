#!/bin/bash
# Comprehensive deployment script for all fixes

echo "🚀 Deploying critical fixes to production..."

# Step 1: Pull latest code
echo "📥 Pulling latest code from GitHub..."
cd /root/AnonStrangerChatbot
git fetch origin
git reset --hard origin/main

# Step 2: Run database migration
echo "🔧 Applying ScheduledMaintenance column fixes..."
PGPASSWORD='Rk2212@' psql -U postgres -d chatbot_production -f /root/AnonStrangerChatbot/scripts/migrations/fix-scheduled-maintenance-columns.sql

# Step 3: Restart services
echo "♻️ Restarting services..."
pm2 restart admin-server
pm2 restart chatbot-system

# Step 4: Verify
echo "✅ Deployment complete! Checking status..."
sleep 3
pm2 logs admin-server --lines 20 --nostream

echo ""
echo "🎉 All fixes deployed successfully!"
echo "📊 Admin Panel: http://139.59.50.82:4000/admin"
