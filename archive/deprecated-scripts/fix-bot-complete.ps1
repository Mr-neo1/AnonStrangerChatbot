# Complete Bot Fix Script - Stops everything and provides clear instructions

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   BOT FIX & RESTART SCRIPT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Stop all Node processes
Write-Host "[1/4] Stopping all Node.js processes..." -ForegroundColor Yellow
$killed = 0
$maxAttempts = 5

for ($i = 1; $i -le $maxAttempts; $i++) {
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue
    if (-not $processes) {
        Write-Host "✅ All processes stopped!" -ForegroundColor Green
        break
    }
    
    Write-Host "  Attempt $i/$maxAttempts - Killing $($processes.Count) process(es)..." -ForegroundColor Gray
    $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    $killed += $processes.Count
    Start-Sleep -Seconds 2
}

if ($killed -gt 0) {
    Write-Host "✅ Stopped $killed process(es)" -ForegroundColor Green
}

# Step 2: Check for PM2
Write-Host ""
Write-Host "[2/4] Checking for PM2..." -ForegroundColor Yellow
$pm2Process = Get-Process -Name "pm2" -ErrorAction SilentlyContinue
if ($pm2Process) {
    Write-Host "⚠️  PM2 detected! Stopping PM2 processes..." -ForegroundColor Yellow
    $pm2Process | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Step 3: Final verification
Write-Host ""
Write-Host "[3/4] Verifying all processes stopped..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$remaining = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "⚠️  Warning: Some processes still running:" -ForegroundColor Red
    $remaining | Format-Table Id, ProcessName, CPU -AutoSize
    Write-Host ""
    Write-Host "Please manually close these processes or restart your computer." -ForegroundColor Yellow
} else {
    Write-Host "✅ All clear! No Node processes running." -ForegroundColor Green
}

# Step 4: Instructions
Write-Host ""
Write-Host "[4/4] Ready to start!" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   NEXT STEPS:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start the bot, run:" -ForegroundColor White
Write-Host "  node bots.js" -ForegroundColor Yellow
Write-Host ""
Write-Host "Or use the restart script:" -ForegroundColor White
Write-Host "  .\restart-bot.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Ask if user wants to start now
$response = Read-Host "Start bot now? (Y/N)"
if ($response -eq "Y" -or $response -eq "y") {
    Write-Host ""
    Write-Host "🚀 Starting bot..." -ForegroundColor Green
    Write-Host ""
    node bots.js
}
