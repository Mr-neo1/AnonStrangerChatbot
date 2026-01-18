# Bot Restart Script - Kills all Node processes and restarts bot cleanly

Write-Host "🛑 Stopping all Node.js processes..." -ForegroundColor Yellow

# Kill all node.exe processes
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Wait a moment for processes to terminate
Start-Sleep -Seconds 2

# Verify all processes are stopped
$remaining = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "⚠️ Some processes still running, force killing..." -ForegroundColor Red
    $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Final check
$finalCheck = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($finalCheck) {
    Write-Host "❌ Failed to stop all Node processes. Please manually close them." -ForegroundColor Red
    Write-Host "Remaining processes:" -ForegroundColor Red
    $finalCheck | Format-Table Id, ProcessName, CPU
    exit 1
} else {
    Write-Host "✅ All Node.js processes stopped successfully!" -ForegroundColor Green
}

Write-Host ""
Write-Host "🚀 Starting bot..." -ForegroundColor Cyan
Write-Host ""

# Start the bot
node bots.js
