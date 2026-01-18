# PM2 Cluster Deployment Script for Windows VPS
# Usage: .\deploy-cluster.ps1

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   PM2 Cluster Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if PM2 is installed
Write-Host "[1/6] Checking PM2..." -ForegroundColor Yellow
try {
    $pm2Version = pm2 --version 2>$null
    Write-Host "✅ PM2 installed: v$pm2Version" -ForegroundColor Green
} catch {
    Write-Host "❌ PM2 not found. Installing..." -ForegroundColor Red
    npm install -g pm2
    Write-Host "✅ PM2 installed" -ForegroundColor Green
}

# Stop existing instances
Write-Host ""
Write-Host "[2/6] Stopping existing instances..." -ForegroundColor Yellow
pm2 stop chatbot-cluster 2>$null
pm2 delete chatbot-cluster 2>$null
Write-Host "✅ Cleaned up old instances" -ForegroundColor Green

# Install dependencies
Write-Host ""
Write-Host "[3/6] Installing dependencies..." -ForegroundColor Yellow
npm install --production
Write-Host "✅ Dependencies installed" -ForegroundColor Green

# Start cluster
Write-Host ""
Write-Host "[4/6] Starting cluster (4 instances)..." -ForegroundColor Yellow
pm2 start ecosystem.config.js --env production
Write-Host "✅ Cluster started" -ForegroundColor Green

# Save PM2 configuration
Write-Host ""
Write-Host "[5/6] Saving PM2 configuration..." -ForegroundColor Yellow
pm2 save --force
Write-Host "✅ Configuration saved" -ForegroundColor Green

# Setup startup (Windows)
Write-Host ""
Write-Host "[6/6] Configuring auto-startup..." -ForegroundColor Yellow
pm2 startup
Write-Host "⚠️ Follow the instructions above to enable startup" -ForegroundColor Yellow

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Deployment Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Show status
pm2 status

Write-Host ""
Write-Host "📊 Cluster Information:" -ForegroundColor Cyan
Write-Host "  Total Instances: 4" -ForegroundColor White
Write-Host "  Mode: Cluster (load balanced)" -ForegroundColor White
Write-Host "  Memory per instance: Max 1GB" -ForegroundColor White
Write-Host "  Auto-restart: Enabled" -ForegroundColor White
Write-Host ""

Write-Host "🔧 Useful Commands:" -ForegroundColor Cyan
Write-Host "  pm2 status          - View cluster status" -ForegroundColor White
Write-Host "  pm2 logs            - View all logs" -ForegroundColor White
Write-Host "  pm2 logs 0          - View specific instance" -ForegroundColor White
Write-Host "  pm2 monit           - Live monitoring" -ForegroundColor White
Write-Host "  pm2 reload all      - Zero-downtime reload" -ForegroundColor White
Write-Host "  pm2 restart all     - Restart cluster" -ForegroundColor White
Write-Host "  pm2 stop all        - Stop cluster" -ForegroundColor White
Write-Host "  pm2 delete all      - Remove all processes" -ForegroundColor White
Write-Host ""

Write-Host "✅ Your bot is now running in cluster mode!" -ForegroundColor Green
Write-Host ""
