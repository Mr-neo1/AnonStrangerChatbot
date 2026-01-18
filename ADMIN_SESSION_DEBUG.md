# 🔍 Admin Session Debugging Guide

## Current Issue
Getting `{"error":"Invalid or expired session"}` when accessing `/admin/dashboard`

## Possible Causes

### 1. **Not Logged In** (Most Common)
- User is trying to access dashboard without logging in first
- **Solution**: Go to `/admin/login` first and complete the login process

### 2. **Redis Connection Issue**
- Sessions are stored in Redis, if Redis is down, sessions won't work
- **Check**: Look for Redis connection errors in server logs
- **Solution**: Ensure Redis is running and connected

### 3. **Cookie Not Set**
- Browser might not be accepting cookies
- Cookie might be blocked by browser settings
- **Solution**: 
  - Check browser console for cookie errors
  - Ensure cookies are enabled
  - Try in incognito/private mode

### 4. **Session Expired**
- Sessions expire after 24 hours
- **Solution**: Login again

## Login Flow

1. **Go to**: `http://localhost:3000/admin/login`
2. **Enter**: Your Telegram ID (must be in `ADMIN_TELEGRAM_IDS`)
3. **Get**: 6-digit code
4. **Send to bot**: `/admin_login <code>` in Telegram
5. **Wait**: Frontend polls every 2 seconds
6. **Redirect**: Automatically redirects to dashboard when confirmed

## Debugging Steps

### Step 1: Check if you're logged in
```bash
# Check browser cookies
# Open DevTools (F12) > Application > Cookies
# Look for: adminToken cookie
```

### Step 2: Check Redis
```bash
# If using real Redis, check connection
redis-cli ping
# Should return: PONG
```

### Step 3: Check Server Logs
Look for:
- `[AdminAuth] Session created for user...` - Session was created
- `[AdminAuth] Session not found in Redis...` - Session missing
- `[AdminAuth] Session expired...` - Session expired

### Step 4: Test Login Flow
1. Clear all cookies for `localhost:3000`
2. Go to `/admin/login`
3. Complete login process
4. Check if cookie is set
5. Try accessing `/admin/dashboard`

## Quick Fix

If you're getting the error:
1. **Go to**: `http://localhost:3000/admin/login`
2. **Login again** using the OTP method
3. **Wait for redirect** to dashboard

## Common Issues

### Issue: "Authentication required"
- **Cause**: No cookie found
- **Fix**: Login first

### Issue: "Invalid or expired session"
- **Cause**: Cookie exists but session not in Redis
- **Possible reasons**:
  - Redis restarted (sessions lost)
  - Session expired
  - Cookie corrupted
- **Fix**: Login again

### Issue: Cookie not being set
- **Check**: Browser console for errors
- **Check**: Server logs for cookie setting errors
- **Try**: Different browser or incognito mode

---

**Note**: The dashboard route now redirects to login if not authenticated, so you should see the login page instead of JSON error.
