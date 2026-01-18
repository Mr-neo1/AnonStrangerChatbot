# Check Bot Status Script

Write-Host "🔍 Checking Bot Status..." -ForegroundColor Cyan
Write-Host ""

# Check Node processes
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "⚠️ Node.js processes running:" -ForegroundColor Yellow
    $nodeProcesses | Format-Table Id, ProcessName, @{Label="CPU Time";Expression={$_.CPU}}, @{Label="Memory (MB)";Expression={[math]::Round($_.WS/1MB,2)}}
    Write-Host "Total processes: $($nodeProcesses.Count)" -ForegroundColor Yellow
} else {
    Write-Host "✅ No Node.js processes running" -ForegroundColor Green
}

Write-Host ""

# Check if bot files exist
$botFiles = @("bots.js", "bot.js", ".env")
Write-Host "📁 Bot Files:" -ForegroundColor Cyan
foreach ($file in $botFiles) {
    if (Test-Path $file) {
        Write-Host "  ✅ $file exists" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $file NOT found" -ForegroundColor Red
    }
}

Write-Host ""

# Check database connection (if possible)
Write-Host "💾 Database Status:" -ForegroundColor Cyan
Write-Host "  ℹ️  Check database connection manually" -ForegroundColor Gray

Write-Host ""
Write-Host "📝 To start bot: node bots.js" -ForegroundColor Cyan
Write-Host "📝 To stop bot: .\stop-bot.ps1" -ForegroundColor Cyan
