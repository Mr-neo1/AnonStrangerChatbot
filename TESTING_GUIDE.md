# 🧪 Testing Guide

## Complete Testing Guide for All Features

**Version:** 2.0.0  
**Last Updated:** 2026-01-16

---

## 📋 Testing Checklist

### Pre-Testing Setup

1. **Environment Setup**
   ```bash
   # Set up test environment
   cp .env.example .env.test
   # Edit .env.test with test bot token
   NODE_ENV=test npm run dev
   ```

2. **Database Setup**
   ```bash
   # Use test database
   POSTGRES_URI=postgresql://user:pass@localhost:5432/chatbot_test
   # Or use SQLite for testing
   SQLITE_DB_PATH=./chatbot_test.db
   ```

3. **Redis Setup**
   ```bash
   # Use memory Redis for testing
   REDIS_URL=memory://
   ```

---

## ✅ Feature Testing

### 1. User Registration Flow

**Test Steps:**
1. Send `/start` to bot
2. Verify channel check (if required)
3. Select gender (Male/Female/Other)
4. Enter age (13-120)
5. Verify profile saved

**Expected Results:**
- ✅ Bot responds with profile setup prompts
- ✅ Gender selection works
- ✅ Age input validated (rejects <13 or >120)
- ✅ Profile saved to database
- ✅ Main menu shown after completion

**Test Commands:**
```
/start
👨 Male (or button)
25 (age)
```

---

### 2. Partner Matching Flow

**Test Steps:**
1. Complete profile setup
2. Click "🔍 Find Partner" or send `/search`
3. Verify search message appears
4. Wait for match (or test with two users)
5. Verify both users notified

**Expected Results:**
- ✅ User enqueued in appropriate queue (VIP/Free)
- ✅ Search message rotates every 3 seconds
- ✅ Match found when partner available
- ✅ Both users receive partner profile
- ✅ Active chat keyboard shown

**Test Commands:**
```
/search
🔍 Find Partner (button)
```

**Test with Two Users:**
1. User A: `/search`
2. User B: `/search`
3. Both should match immediately

---

### 3. Chat Message Relay

**Test Steps:**
1. Match two users
2. User A sends text message
3. Verify User B receives message
4. User B sends message
5. Verify User A receives message

**Expected Results:**
- ✅ Messages relayed correctly
- ✅ Session marked as active
- ✅ Bot tracking updated
- ✅ Error handled if partner blocked bot

**Test Messages:**
```
Hello!
How are you?
Test message 123
```

---

### 4. Media Forwarding

**Test Steps:**
1. Match two users
2. User A sends photo
3. Verify User B receives photo
4. Verify admin channel receives forwarded media
5. Test with video, document, voice

**Expected Results:**
- ✅ Media relayed to partner
- ✅ Media forwarded to admin channel
- ✅ View-once media handled correctly
- ✅ All media types supported

**Test Media:**
- Photo
- Video
- Voice message
- Document
- Sticker

---

### 5. Stop Chat

**Test Steps:**
1. Match two users
2. User A clicks "❌ Stop Chat" or sends `/stop`
3. Verify both users notified
4. Verify pair removed from Redis
5. Verify main menu shown

**Expected Results:**
- ✅ Chat ended for both users
- ✅ Pair state cleaned up
- ✅ Users removed from queues
- ✅ Rating buttons shown to partner
- ✅ Main menu shown

**Test Commands:**
```
/stop
❌ Stop Chat (button)
```

---

### 6. Next Partner

**Test Steps:**
1. Match two users
2. User A clicks "⏭ Next Partner"
3. Verify chat stopped
4. Verify new search started
5. Test with locked chat (should fail)

**Expected Results:**
- ✅ Current chat stopped
- ✅ New search started
- ✅ Locked chat prevents skip
- ✅ Abuse recorded if attempted

**Test Commands:**
```
/find
⏭ Next Partner (button)
```

---

### 7. VIP Subscription

**Test Steps:**
1. Click "⭐ Buy Premium"
2. Select VIP plan
3. Complete Telegram Stars payment
4. Verify VIP activated
5. Verify priority matching works

**Expected Results:**
- ✅ VIP plans shown
- ✅ Payment processed correctly
- ✅ VIP subscription created
- ✅ Redis cache updated
- ✅ Priority matching enabled
- ✅ Gender preference available

**Test Flow:**
```
⭐ Buy Premium
→ Select plan (BASIC/PLUS/PRO/etc)
→ Complete payment
→ Verify VIP status
```

---

### 8. Lock Chat

**Test Steps:**
1. Match two users
2. User A clicks "🔒 Lock Chat"
3. Select duration (5/10/15 min)
4. Verify lock activated
5. Try to skip (should fail)
6. Wait for expiry

**Expected Results:**
- ✅ Lock credits checked
- ✅ Lock created if credits available
- ✅ Both users notified
- ✅ Skip prevented during lock
- ✅ Lock expires automatically

**Test Flow:**
```
🔒 Lock Chat
→ Select duration
→ Verify lock active
→ Try /find (should fail)
```

---

### 9. Referral System

**Test Steps:**
1. User A gets referral link: `/start ref_ABC123`
2. User B uses referral link
3. User B completes profile
4. Verify referral recorded
5. Verify User A gets VIP days

**Expected Results:**
- ✅ Referral link tracked
- ✅ Referral record created
- ✅ Referrer rewarded
- ✅ Abuse detection works

**Test Commands:**
```
/start ref_ABC123
```

---

### 10. Profile Management

**Test Steps:**
1. Click "⚙️ Settings"
2. Update gender
3. Update age
4. View profile
5. View stats

**Expected Results:**
- ✅ Settings menu shown
- ✅ Gender updated
- ✅ Age updated
- ✅ Profile displayed correctly
- ✅ Stats calculated correctly
- ✅ Daily streak updated

**Test Commands:**
```
⚙️ Settings
👤 Update Gender
🎂 Update Age
👤 My Profile
📊 My Stats
```

---

### 11. Admin Panel

**Test Steps:**
1. Access `/admin/login`
2. Request login code
3. Send `/admin_login <code>` to bot
4. Access dashboard
5. Test all features

**Expected Results:**
- ✅ Login code generated
- ✅ Session created
- ✅ Dashboard accessible
- ✅ All endpoints work
- ✅ Rate limiting works
- ✅ Input validation works

**Test Endpoints:**
```
GET /api/overview
GET /api/users
GET /api/stats
GET /api/config
POST /api/config
POST /api/broadcast
GET /api/users/:userId
POST /api/users/:userId/ban
POST /api/users/:userId/unban
```

---

### 12. Error Handling

**Test Steps:**
1. Test invalid inputs
2. Test network errors
3. Test database errors
4. Test Redis errors
5. Verify errors logged

**Expected Results:**
- ✅ Errors caught and logged
- ✅ User-friendly error messages
- ✅ No silent failures
- ✅ Errors in logs/error.log
- ✅ System remains stable

**Test Cases:**
- Invalid age (<13 or >120)
- Invalid gender
- Database connection lost
- Redis connection lost
- Invalid callback data

---

## 🔍 Performance Testing

### Load Testing

**Test Scenarios:**
1. **100 concurrent users**
   - All searching for partners
   - Verify matching works
   - Check memory usage
   - Check response times

2. **1000 messages/minute**
   - Multiple active chats
   - Verify message relay
   - Check database load
   - Check Redis cache hit rate

3. **VIP priority matching**
   - 10 VIP users
   - 90 free users
   - Verify VIP users match first

**Metrics to Monitor:**
- Response time (<100ms)
- Memory usage (<512MB per instance)
- Database connections (<30)
- Redis memory usage
- Error rate (<0.1%)

---

## 🐛 Bug Testing

### Known Edge Cases

1. **User blocks bot mid-chat**
   - Verify error handled gracefully
   - Verify partner notified

2. **Multiple search attempts**
   - Verify user not enqueued twice
   - Verify search message rotation

3. **Lock expires mid-chat**
   - Verify lock cleaned up
   - Verify users can skip after expiry

4. **VIP expires mid-chat**
   - Verify VIP benefits preserved
   - Verify downgrade on next search

5. **Database connection lost**
   - Verify retry logic
   - Verify graceful degradation

---

## 📊 Test Results Template

```markdown
## Test Results - [Date]

### Feature: [Feature Name]
- ✅ Pass / ❌ Fail
- Notes: [Any issues found]

### Performance
- Response Time: [ms]
- Memory Usage: [MB]
- Error Rate: [%]

### Issues Found
1. [Issue description]
   - Severity: [Critical/High/Medium/Low]
   - Status: [Fixed/Pending]
```

---

## 🚀 Automated Testing (Future)

### Unit Tests
```javascript
// Example test structure
describe('SearchHandler', () => {
  it('should enqueue user in correct queue', async () => {
    // Test implementation
  });
});
```

### Integration Tests
```javascript
describe('Matching Flow', () => {
  it('should match two users', async () => {
    // Test implementation
  });
});
```

---

## ✅ Sign-Off Checklist

Before production deployment:

- [ ] All features tested
- [ ] All workflows verified
- [ ] Performance tested
- [ ] Error handling verified
- [ ] Admin panel tested
- [ ] Security tested
- [ ] Documentation reviewed
- [ ] Logs reviewed
- [ ] No critical bugs found

---

**Last Updated:** 2026-01-16  
**Version:** 2.0.0
