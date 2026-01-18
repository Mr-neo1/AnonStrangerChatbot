#!/bin/bash
# PM2 Cluster Deployment Script for VPS
# Usage: ./deploy-cluster.sh

echo "🚀 Deploying Bot in Cluster Mode..."
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 not found. Installing PM2..."
    npm install -g pm2
    echo "✅ PM2 installed"
fi

# Stop existing instances
echo "🛑 Stopping existing instances..."
pm2 stop chatbot-cluster 2>/dev/null || true
pm2 delete chatbot-cluster 2>/dev/null || true

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Start cluster
echo "🚀 Starting cluster with 4 instances..."
pm2 start ecosystem.config.js --env production

# Save PM2 process list
echo "💾 Saving PM2 configuration..."
pm2 save

# Setup PM2 startup (auto-restart on server reboot)
echo "⚙️ Configuring auto-startup..."
pm2 startup

echo ""
echo "=========================================="
echo "✅ Cluster Deployment Complete!"
echo "=========================================="
echo ""
echo "Status:"
pm2 status

echo ""
echo "Useful commands:"
echo "  pm2 status          - View cluster status"
echo "  pm2 logs            - View logs (all instances)"
echo "  pm2 monit           - Live monitoring dashboard"
echo "  pm2 reload all      - Zero-downtime reload"
echo "  pm2 restart all     - Restart all instances"
echo "  pm2 stop all        - Stop cluster"
echo ""
