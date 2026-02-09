#!/bin/bash
# DEPLOYMENT SCRIPT - Run this on production server (root@139.59.50.82)
# This applies all critical fixes

echo "═══════════════════════════════════════════════════"
echo "🚀 DEPLOYING ALL CRITICAL FIXES"
echo "═══════════════════════════════════════════════════"
echo ""

# Stop services
echo "⏸️  Step 1: Stopping services..."
pm2 stop admin-server chatbot-system

# Pull latest code
echo "📥 Step 2: Pulling latest code from GitHub..."
cd /root/AnonStrangerChatbot
git fetch origin
git reset --hard origin/main
echo "✅ Code updated to: $(git log --oneline -1)"
echo ""

# Apply database migration
echo "🔧 Step 3: Applying database fixes..."
PGPASSWORD='Rk2212@' psql -U postgres -d chatbot_production << 'EOF'
-- Add missing columns to ScheduledMaintenance
ALTER TABLE "ScheduledMaintenance" ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;
ALTER TABLE "ScheduledMaintenance" ADD COLUMN IF NOT EXISTS "notifyUsers" BOOLEAN DEFAULT true;
ALTER TABLE "ScheduledMaintenance" ADD COLUMN IF NOT EXISTS "notificationSentAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "ScheduledMaintenance" ADD COLUMN IF NOT EXISTS "notifyBeforeMinutes" INTEGER DEFAULT 30;
ALTER TABLE "ScheduledMaintenance" ADD COLUMN IF NOT EXISTS "userMessage" TEXT;

-- Verify StarTransactions table structure
\d "StarTransactions"
EOF
echo "✅ Database migration complete"
echo ""

# Restart services
echo "♻️  Step 4: Restarting services..."
pm2 restart admin-server
pm2 restart chatbot-system

# Wait and check logs
echo "⏳ Step 5: Checking for errors..."
sleep 5
echo ""
echo "═══════════════════════════════════════════════════"
echo "📊 ADMIN SERVER LOGS (last 15 lines):"
echo "═══════════════════════════════════════════════════"
pm2 logs admin-server --lines 15 --nostream --err

echo ""
echo "═══════════════════════════════════════════════════"
echo "🤖 CHATBOT SYSTEM LOGS (last 10 lines):"
echo "═══════════════════════════════════════════════════"
pm2 logs chatbot-system --lines 10 --nostream --err

echo ""
echo "═══════════════════════════════════════════════════"
echo "✅ DEPLOYMENT COMPLETE!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "🎯 FIXES APPLIED:"
echo "  1. StarTransaction.status errors (4 instances fixed)"
echo "  2. AuditService missing imports (3 endpoints fixed)"
echo "  3. ScheduledMaintenance missing columns (5 columns added)"
echo "  4. CSV export column names fixed"
echo "  5. UI error handling improved"
echo ""
echo "📊 Admin Panel: http://139.59.50.82:4000/admin"
echo "🔐 Login: admin / Rk2212@"
echo ""
echo "🧪 TEST THESE TABS:"
echo "  ✓ Revenue - Should load without 'status does not exist' error"
echo "  ✓ Users - Mass unban/ban should work"
echo "  ✓ Maintenance - Should load without 'durationMinutes' error"
echo "  ✓ Export - CSV should show correct VIP status"
echo ""
echo "If you see any errors above, run: pm2 logs --err --lines 50"
echo "═══════════════════════════════════════════════════"
