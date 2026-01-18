#!/bin/bash

# VPS Deployment Script
echo "🚀 Starting VPS Deployment..."

# Create logs directory
mkdir -p logs

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Setup database (if needed)
echo "🗄️ Setting up database..."
# Add database setup commands here if needed

# Start with PM2
echo "🤖 Starting bot with PM2..."
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup
pm2 startup

echo "✅ Deployment complete!"
echo "📊 Check status: pm2 status"
echo "📝 View logs: pm2 logs chatbot"