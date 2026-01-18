# Stop Bot Script - Safely stops all Node.js processes

Write-Host "🛑 Stopping all Node.js processes..." -ForegroundColor Yellow

# Kill all node.exe processes
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Wait a moment
Start-Sleep -Seconds 2

# Verify
$remaining = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "⚠️ Force killing remaining processes..." -ForegroundColor Yellow
    $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

$finalCheck = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($finalCheck) {
    Write-Host "❌ Some processes still running:" -ForegroundColor Red
    $finalCheck | Format-Table Id, ProcessName, CPU
} else {
    Write-Host "✅ All Node.js processes stopped!" -ForegroundColor Green
}
