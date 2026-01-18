# Safe Bot Startup Script - Prevents multiple instances and enforces clean shutdown
# Usage: .\safe-start-bot.ps1

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "      SAFE BOT STARTUP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check for existing Node processes
Write-Host "[1/3] Checking for existing bot instances..." -ForegroundColor Yellow
$existing = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "⚠️ Found existing Node.js process(es):" -ForegroundColor Red
    $existing | Format-Table Id, ProcessName, @{Name="PID";Expression={$_.Id}} -AutoSize
    Write-Host ""
    
    $response = Read-Host "Do you want to stop existing processes? (Y/N)"
    if ($response -eq "Y" -or $response -eq "y") {
        Write-Host ""
        Write-Host "🛑 Stopping existing processes..." -ForegroundColor Yellow
        $existing | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        
        # Verify they're stopped
        $remaining = Get-Process -Name "node" -ErrorAction SilentlyContinue
        if ($remaining) {
            Write-Host "⚠️ Some processes still running. Waiting 3 seconds..." -ForegroundColor Yellow
            Start-Sleep -Seconds 3
        } else {
            Write-Host "✅ All processes stopped" -ForegroundColor Green
        }
    } else {
        Write-Host ""
        Write-Host "❌ Cannot start bot while another instance is running" -ForegroundColor Red
        Write-Host "   Please stop existing processes first." -ForegroundColor Red
        exit 1
    }
}

# Step 2: Clean up lock file if needed
if (Test-Path ".\.bot.lock") {
    Write-Host ""
    Write-Host "[2/3] Cleaning up lock file..." -ForegroundColor Yellow
    Remove-Item ".\.bot.lock" -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Lock file cleared" -ForegroundColor Green
}

# Step 3: Start the bot
Write-Host ""
Write-Host "[3/3] Starting bot with process protection..." -ForegroundColor Yellow
Write-Host ""
Write-Host "To stop the bot, press Ctrl+C" -ForegroundColor Cyan
Write-Host ""

# Start the bot - process lock will prevent duplicates
node bots.js

# If we get here, the bot was stopped
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Bot stopped. You can restart it anytime." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
