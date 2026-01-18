# Payment Setup Helper Script

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   PAYMENT SETUP HELPER" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (Test-Path .env) {
    Write-Host "✅ .env file found" -ForegroundColor Green
    Write-Host ""
    
    # Check for payment settings
    $envContent = Get-Content .env -Raw
    $hasPayments = $envContent -match "ENABLE_STARS_PAYMENTS"
    $hasToken = $envContent -match "PAYMENT_PROVIDER_TOKEN"
    
    if ($hasPayments -and $hasToken) {
        Write-Host "✅ Payment settings found in .env" -ForegroundColor Green
        
        # Check if enabled
        if ($envContent -match "ENABLE_STARS_PAYMENTS\s*=\s*true") {
            Write-Host "✅ Payments are ENABLED" -ForegroundColor Green
        } else {
            Write-Host "⚠️  ENABLE_STARS_PAYMENTS is not set to 'true'" -ForegroundColor Yellow
        }
        
        # Check if token is set
        if ($envContent -match "PAYMENT_PROVIDER_TOKEN\s*=\s*[^\s]+") {
            Write-Host "✅ Payment Provider Token is set" -ForegroundColor Green
        } else {
            Write-Host "⚠️  PAYMENT_PROVIDER_TOKEN appears to be empty" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ Payment settings missing from .env" -ForegroundColor Red
        Write-Host ""
        Write-Host "Adding payment configuration..." -ForegroundColor Yellow
        
        # Add payment settings if missing
        $paymentConfig = @"

# Payment Configuration (REQUIRED FOR PAYMENTS TO WORK)
ENABLE_STARS_PAYMENTS=true
PAYMENT_PROVIDER_TOKEN=your_payment_provider_token_from_botfather
"@
        
        Add-Content -Path .env -Value $paymentConfig
        Write-Host "✅ Added payment configuration template" -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠️  IMPORTANT: You need to:" -ForegroundColor Yellow
        Write-Host "   1. Get Payment Provider Token from BotFather" -ForegroundColor White
        Write-Host "   2. Replace 'your_payment_provider_token_from_botfather' in .env" -ForegroundColor White
    }
} else {
    Write-Host "❌ .env file NOT found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Creating .env file from template..." -ForegroundColor Yellow
    
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
        Write-Host "✅ Created .env from .env.example" -ForegroundColor Green
    } else {
        Write-Host "⚠️  .env.example not found. Creating basic .env..." -ForegroundColor Yellow
        
        $basicEnv = @"
# Bot Configuration
BOT_TOKENS=your_bot_token_here
BOT_TOKEN=your_bot_token_here

# Payment Configuration (REQUIRED FOR PAYMENTS TO WORK)
ENABLE_STARS_PAYMENTS=true
PAYMENT_PROVIDER_TOKEN=your_payment_provider_token_from_botfather

# Feature Flags
ENABLE_VIP=true
ENABLE_LOCK_CHAT=true
"@
        Set-Content -Path .env -Value $basicEnv
        Write-Host "✅ Created basic .env file" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "⚠️  IMPORTANT: Edit .env file and add:" -ForegroundColor Yellow
    Write-Host "   1. Your bot token(s)" -ForegroundColor White
    Write-Host "   2. Payment Provider Token from BotFather" -ForegroundColor White
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   HOW TO GET PAYMENT PROVIDER TOKEN" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open Telegram and search for @BotFather" -ForegroundColor White
Write-Host "2. Send: /mybots" -ForegroundColor White
Write-Host "3. Select your bot" -ForegroundColor White
Write-Host "4. Choose: Payments → Configure Payments" -ForegroundColor White
Write-Host "5. Follow setup wizard (connect Stripe or other provider)" -ForegroundColor White
Write-Host "6. Copy the Payment Provider Token" -ForegroundColor White
Write-Host "7. Paste it in .env file as PAYMENT_PROVIDER_TOKEN=..." -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "After updating .env, restart your bot:" -ForegroundColor Yellow
Write-Host "  .\restart-bot.ps1" -ForegroundColor Cyan
Write-Host ""
