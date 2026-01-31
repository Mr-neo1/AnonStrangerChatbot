# Quick Deploy Script for Windows PowerShell
# Run this from your local machine to deploy to VPS

# ===========================================
# CONFIGURATION - UPDATE THESE VALUES
# ===========================================
$VPS_IP = "YOUR_VPS_IP"          # e.g., "167.71.xx.xx"
$VPS_USER = "root"
$PROJECT_PATH = "C:\Users\rkrai\OneDrive\Desktop\VsCode\AnonStrangerChatbot"
$REMOTE_PATH = "/opt/chatbot"

# ===========================================
# STEP 1: Upload files to VPS
# ===========================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 Deploying to VPS: $VPS_IP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`n📦 Uploading files..." -ForegroundColor Yellow

# Create exclude file for rsync-like behavior with scp
$excludeItems = @(
    "node_modules",
    ".git",
    "*.log",
    "chatbot.db",
    "chatbot.db.bak",
    ".env.local"
)

# Use scp to upload (exclude node_modules manually by not including it)
Write-Host "Uploading main files..." -ForegroundColor Gray

# Upload specific directories and files
$itemsToUpload = @(
    "config",
    "constants", 
    "controllers",
    "database",
    "deploy",
    "docs",
    "jobs",
    "middlewares",
    "models",
    "public",
    "routes",
    "scripts",
    "services",
    "utils",
    "*.js",
    "*.json",
    "*.md",
    "init_schema.sql"
)

foreach ($item in $itemsToUpload) {
    $sourcePath = Join-Path $PROJECT_PATH $item
    if (Test-Path $sourcePath) {
        Write-Host "  Uploading: $item" -ForegroundColor Gray
        scp -r $sourcePath "${VPS_USER}@${VPS_IP}:${REMOTE_PATH}/" 2>$null
    }
}

# Upload .env.production
Write-Host "  Uploading: .env.production" -ForegroundColor Gray
scp "$PROJECT_PATH\deploy\.env.production" "${VPS_USER}@${VPS_IP}:${REMOTE_PATH}/.env"

Write-Host "`n✅ Files uploaded!" -ForegroundColor Green

# ===========================================
# STEP 2: Run remote commands
# ===========================================
Write-Host "`n🔧 Running remote setup..." -ForegroundColor Yellow

$remoteCommands = @"
cd /opt/chatbot

echo "📦 Installing dependencies..."
npm install --production

echo "🗄️ Initializing database..."
node scripts/init-postgres-schema.js

echo "🚀 Starting services with PM2..."
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save

echo ""
echo "✅ Deployment complete!"
pm2 status
"@

ssh "${VPS_USER}@${VPS_IP}" $remoteCommands

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nAdmin Panel: http://${VPS_IP}:4000" -ForegroundColor Yellow
Write-Host "SSH: ssh ${VPS_USER}@${VPS_IP}" -ForegroundColor Gray
Write-Host "Logs: pm2 logs" -ForegroundColor Gray
