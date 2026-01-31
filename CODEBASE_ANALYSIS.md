# 🤖 ANONYMOUS CHAT BOT - COMPLETE CODEBASE ANALYSIS

**Project Type:** Telegram Bot with Admin Dashboard | Multi-bot Federation | Monetization System
**Stack:** Node.js | Express | Telegram Bot API | PostgreSQL/SQLite | Redis | Sequelize ORM

---

## 📋 TABLE OF CONTENTS
1. [Architecture Overview](#architecture-overview)
2. [Core Entry Points](#core-entry-points)
3. [Controllers & Message Handlers](#controllers--message-handlers)
4. [Services Layer](#services-layer)
5. [Models & Database](#models--database)
6. [Utilities & Helpers](#utilities--helpers)
7. [Routes & Admin Panel](#routes--admin-panel)
8. [Configuration & Middleware](#configuration--middleware)

---

## ARCHITECTURE OVERVIEW

### System Layers
```
┌─────────────────────────────────────────────────────────────┐
│                    TELEGRAM USERS                            │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│         BOT CONTROLLERS (Message Handlers)                   │
│  - EnhancedChatController     (Chat logic)                   │
│  - AdminController             (Admin commands)              │
│  - PaymentController           (Stars payment)               │
│  - MediaController             (File forwarding)             │
│  - ReferralController          (Invite system)               │
│  - AdminLoginController        (Web auth)                    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│         SERVICES LAYER (Business Logic)                      │
│  - MatchingService            (Pairing algorithm)            │
│  - VipService                 (Premium membership)           │
│  - LockChatService            (Time-based paywalls)          │
│  - PaymentService             (Stars transactions)           │
│  - ReferralService            (Invite rewards)               │
│  - AbuseService               (Violation tracking)           │
│  - AffiliateService           (Commission system)            │
│  - UserCacheService           (Performance caching)          │
│  - ConfigService              (Dynamic settings)             │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  DATABASE & CACHE (Data Persistence)                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ PostgreSQL/SQLite (Sequelize ORM)                   │    │
│  │ ├─ User (Telegram users)                            │    │
│  │ ├─ Chat (Conversation history)                      │    │
│  │ ├─ VipSubscription (Premium access)                 │    │
│  │ ├─ StarTransaction (Payment records)                │    │
│  │ ├─ LockChat (Time-locked sessions)                  │    │
│  │ ├─ Referral (Invite tracking)                       │    │
│  │ └─ AffiliateReward (Commission ledger)              │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Redis/Memory Cache (High-speed operations)          │    │
│  │ ├─ queue:* (User matching queues)                   │    │
│  │ ├─ pair:* (Active conversations)                    │    │
│  │ ├─ user:vip:* (VIP status cache)                    │    │
│  │ ├─ chat:locks:* (Time-lock keys)                    │    │
│  │ └─ rate:* (Rate limiting counters)                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## CORE ENTRY POINTS

### 📄 [bots.js](bots.js) - Bot Bootstrap & Federation
**Responsibility:** Initialize all bot instances from config/env

**Functions:**
- `initBots()` - ENTRY POINT
  - Loads bot tokens from ConfigService database or env vars
  - Creates Telegram bot instance for each token
  - Registers controllers (chat, admin, payment, media, referral)
  - Attaches metadata (botId, botName) to each bot instance
  - Calls `bot.initApp()` for database initialization
  - Returns success/failure status
  - **Features:** Multi-bot federation support, token hot-reload from DB

- `stopAllBots()` - Graceful shutdown
  - Stops polling for each bot
  - Releases process lock
  - Logs shutdown completion

- `getBotById(botId)` - Retrieve single bot
  - Input: `botId` (e.g., 'bot_0', 'bot_1')
  - Returns: Telegram bot instance or null
  - Used for: Cross-bot message routing

- `getAllBots()` - Retrieve all active bots
  - Returns: Array of all bot instances
  - Used for: Broadcast operations, admin commands

- `getDefaultBot()` - Get primary bot
  - Returns: First initialized bot instance
  - Fallback for single-bot configurations

- `getBotsMap()` - Get ID→Bot mapping
  - Returns: Map object for bot lookups
  - Performance: O(1) lookup time

---

### 🤖 [bot.js](bot.js) - Bot Instance Creation & Polling

**Responsibility:** Create individual bot with polling and error recovery

**Functions:**
- `createBotWithControllers(token, options)` - Factory function
  - Input: `token` (Telegram bot token), `options` (botId, etc)
  - Creates: `TelegramBot` instance with polling disabled initially
  - **Attaches Controllers:**
    - `EnhancedChatController(bot)` → Chat pairing logic
    - `MediaController(bot)` → File forwarding
    - `AdminController(bot)` → Admin commands
    - `PaymentController(bot)` → Stars payment handling
    - `ReferralController(bot)` → Invite tracking
    - `AdminLoginController(bot)` → Web authentication
  
  - Initializes: `bot._pollingState` (tracking polling status)
    ```javascript
    {
      active: boolean,
      retryCount: number,
      maxRetries: 10,
      retryDelayMs: 2000,
      errorCache: [] // Last 60s errors
    }
    ```
  
  - **Error Handling:**
    - **Network errors** (ECONNRESET, ETIMEDOUT): Exponential backoff retry
    - **Auth errors** (400, invalid token): Permanent failure, no retry
    - **409 Conflict** (duplicate polling): Fatal, suggests multi-instance issue
  
  - Returns: Configured bot instance ready for polling

- `polling_error` handler
  - Listens for polling failures continuously
  - Distinguishes error types: network vs auth vs conflict
  - Implements smart recovery with exponential backoff
  - Max 10 retry attempts (2s, 4s, 8s... up to 60s)
  - Logs errors with context (errorCode, message)

- `initApp()` - Initialize bot application
  - Ensures database connection (Sequelize)
  - Runs safe migrations
  - Creates LockCredits table if missing
  - Initializes config defaults
  - Called once per bot process at startup

---

### 🚀 [server.js](server.js) - Admin Dashboard Server

**Responsibility:** Express server for web-based admin panel

**Functions:**
- `startServer()` - ENTRY POINT for admin dashboard
  - Port: `process.env.ADMIN_PORT || 3000`
  - **Middleware Stack:**
    - `express.json()` - JSON parsing
    - `express.urlencoded()` - Form data
    - `cookieParser()` - Cookie handling
    - `express.static()` - Serve static files from `/public`
  
  - **Initializations:**
    - Database authentication (`sequelize.authenticate()`)
    - Sync app_config table
    - Create LockCredits table (if missing)
    - Initialize ConfigService defaults
  
  - **Routes:**
    - `GET /` → Redirect to `/admin/login`
    - `GET /health` → Health check endpoint
    - `GET|POST /admin/*` → Admin routes (see adminRoutes.js)
  
  - **Graceful Shutdown:**
    - Listens for SIGTERM/SIGINT signals
    - Closes server properly on shutdown
    - Exit code 0 on success, 1 on error

---

## CONTROLLERS & MESSAGE HANDLERS

### 🎯 [EnhancedChatController.js](controllers/enhancedChatController.js) - Main Chat Logic
**Responsibility:** Handle user chat flow, matching, profile management

**Class: EnhancedChatController**

#### Initialization
- `constructor(bot)` - Setup
  - Stores bot instance
  - Creates `withChannelVerification` wrapper (security middleware)
  - Registers command handlers via `initializeCommands()`
  - Registers message relay via `initializeMessageRelay()`

#### Command Handlers (1332 lines total)

**Main Menu Commands:**
1. `🔍 Find Partner` → `handleSearch(msg)`
   - Checks if user already searching or paired
   - Verifies channel membership (mandatory)
   - Enqueues user in matching queue
   - Shows rotating "searching..." messages
   - Updates UI to "active chat" state
   - **Rate limiting:** 90 messages/minute per user
   - **Rotation:** 3 different search messages (UX engagement)

2. `❌ Stop Chat` → `stopChatInternal(chatId)`
   - Finds active partner via Redis `pair:chatId`
   - Notifies both users of disconnect
   - Clears session keys from Redis
   - Logs chat end to database
   - Returns both users to main menu
   - **Special:** Handles premature stops during locks (abuse tracking)

3. `📊 My Stats` → `showUserStats(msg)`
   - Fetches user from DB (cached via UserCacheService)
   - Calculates stats: total chats, daily streak
   - Displays: Chat count, VIP status, streak info
   - Formats with emojis for engagement

4. `⚙️ Settings` → `showSettings(msg)`
   - Displays settings menu keyboard
   - Shows VIP gender preference option for VIP users
   - Navigation to gender/age updates

5. `☰ Menu` → Menu keyboard display
   - Profile, Stats, Settings, Rules
   - ID display, Premium purchase
   - Rewards/Redeem section

**Active Chat Commands (shown during conversation):**
1. `⏭ Next Partner` → `handleFind(msg)`
   - Ends current chat with partner
   - Immediately re-enqueues user
   - Seamless partner-switching experience

2. `🔒 Lock Chat` → `handleLockChat(msg)`
   - Prevents partner from skipping/stopping
   - Shows lock duration selector (5/10/15 min)
   - Deducts Stars from user balance
   - Sets Redis lock keys with TTL
   - Notifies both users of lock status
   - **Cost:** 15/25/35 Stars respectively

**Profile Management Commands:**
1. `👤 Update Gender` → `updateGender(msg)`
   - Shows gender selector keyboard
   - Updates User.gender in DB
   - Invalidates cache via UserCacheService

2. `🎂 Update Age` → `updateAge(msg)`
   - Collects age input via prompt
   - Validates: integer 13-100
   - Updates User.age in DB

3. `⭐ Partner Gender Preference` → `updateVipGenderPreference(msg)` (VIP only)
   - Shows 4-option keyboard: Male, Female, Other, Any
   - Updates VipSubscription preferences
   - Used in VIP matching algorithm

4. `⭐ Buy Premium` → VIP plans display
   - Fetches dynamic plans from config
   - Generates Telegram Stars invoice for each plan
   - Each plan: name, duration (days), stars cost
   - **Format:** `STAR_BUY:VIP:PLANID` callback data

#### Message Relay
- `initializeMessageRelay()` - Register on 'message' event
  - **Logic:** If message content && `pair:chatId` exists
    - Get partner ID from Redis
    - Route message to partner via BotRouter
    - Log message to Chat model
    - Increment user message counter
    - Check rate limits
    - Update session TTLs (extend 24h)
  
  - **Special Handling:**
    - Text messages: Direct relay
    - Media (photo, video, document): Forward via MediaController
    - Commands: Skip relay, handle locally
    - Forwarded messages: Strip source info for anonymity

- **Performance Optimizations:**
  - Caching user data (5 min TTL)
  - Redis for session lookup (O(1) instead of DB)
  - Batch expiry updates (use pipeline)

---

### 👨‍💼 [AdminController.js](controllers/adminController.js) - Admin Commands

**Responsibility:** Admin-only operations for moderation/stats

**Class: AdminController**

**Key Methods:**
- `isAdmin(chatId)` - Check if user is admin
  - Compares chatId against `config.ADMIN_CONTROL_CHAT_ID`
  - Returns: boolean

- `registerAdminNotifier(fn)` - Register alert sender
  - Stores callback function globally
  - Used by other services to send admin notifications
  - **Why global?** Avoids circular dependency with bot instance

- `notifyAdmin(text)` - Send alert message
  - If admin notifier registered, calls it
  - Error handling: Silently fails (non-blocking)

#### Admin Commands (regex-based)

1. `/ban <userId>` → Ban user from chat
   - Input: `/ban 123456789`
   - Operation: Set User.banned = true
   - Effect: User blocked from all functionality
   - Confirmation message sent to admin

2. `/unban <userId>` → Unban user
   - Input: `/unban 123456789`
   - Operation: Set User.banned = false
   - Confirmation message sent

3. `/broadcast <message>` → Send to all users
   - Input: `/broadcast Hello all!`
   - Operation: Fetches all users, sends DM to each
   - Handles failures gracefully (continues on error)
   - Confirmation: "Broadcast job queued"
   - **Note:** Not queued, executes immediately

4. `/stats` - Display platform metrics
   - Counts: Total users, VIP users
   - Queries Redis keys for VIP status
   - Displays formatted stats

5. `/locks` - List active locks
   - Scans Redis for `chat:locks:*` keys
   - Shows: Lock owner, duration remaining
   - Admin can manually remove locks if needed

---

### 💰 [PaymentController.js](controllers/paymentController.js) - Telegram Stars

**Responsibility:** Lightweight wrapper around PaymentService

**Class: PaymentController**

**Key Methods:**
- `constructor(bot)` - Initialize
  - Creates PaymentService instance (which listens to events)
  - Keeps controller minimal (business logic in service)

---

### 📹 [MediaController.js](controllers/mediaController.js) - File Forwarding

**Responsibility:** Handle media (photo, video, document) forwarding between users

**Class: MediaController**

**Key Methods:**
- `getCachedBotAssignment(userId)` - Get user's bot instance
  - Checks in-memory cache (1 min TTL)
  - Falls back to Redis lookup
  - Default: 'bot_0'
  - **Why cache?** Avoid Redis hits for every message

- `cleanupCaches()` - Garbage collection
  - Removes expired entries from botAssignmentCache
  - Deletes old files from disk
  - Called periodically to prevent memory leaks

- `isValidAdminChannelId(channelId)` - Validate channel format
  - Accepts: `@channel_name`, `-100XXXXX` (supergroup), `XXXXX` (numeric)
  - Returns: boolean
  - Used for: Validating admin forwarding destination

- `initializeMediaHandlers()` - Register media listeners
  - Photo handler: `bot.on('photo', ...)`
  - Video handler: `bot.on('video', ...)`
  - Document handler: `bot.on('document', ...)`
  - Audio handler: `bot.on('audio', ...)`
  - **Logic:**
    1. Download file from Telegram
    2. Store in cache (prevents re-download on relay)
    3. Forward to partner via partner's bot
    4. Forward to admin channel if configured
    5. Compress for bandwidth optimization (30-35% reduction via Sharp)

- **File Cache System:**
  - Key: `filename` (generated from file_id)
  - Value: `{path, time}` (local file path + timestamp)
  - TTL: 5 minutes
  - Prevents: Redundant downloads for re-sends

- **Admin Channel Cache:**
  - Stores invalid channel IDs temporarily
  - Prevents repeated API errors
  - Key: `badAdminChannels` Set

---

### 🎁 [ReferralController.js](controllers/referralController.js) - Invite System

**Responsibility:** Track and manage referral/invite system

**Functions (inferred from ReferralService):**
1. Generate referral codes/links
2. Track when invited user joins
3. Calculate rewards (VIP days based on referral count)
4. Affiliate payments processing
5. Referral milestone achievements (every 5 referrals = 15 VIP days)

---

### 🔐 [AdminLoginController.js](controllers/adminLoginController.js) - Web Auth

**Responsibility:** Authenticate admin users for web dashboard

**Key Functions:**
1. Generate one-time login codes
2. Verify codes against Telegram DM
3. Issue session tokens
4. Validate session persistence
5. Track login attempts (rate limiting)

---

## SERVICES LAYER

### 🎲 [MatchingService.js](services/matchingService.js) - Pairing Algorithm

**Responsibility:** Find and pair users for anonymous chats

**Class: MatchingService**

**Key Methods:**

1. `isUserQueued(botId, userId)` - Check if already searching
   - Scans all queue types for user ID
   - Returns: boolean
   - **Modes:**
     - Single-bot: Searches bot-scoped queues only
     - Cross-bot (federation): Searches global queues

2. `enqueueUser(botId, userId)` - Add user to queue
   - **Decision Tree:**
     ```
     Is user VIP?
     ├─ YES
     │  └─ Get gender preference (prefs.gender)
     │     ├─ Male/Female/Other → queue:vip:gender:{type}
     │     └─ Any → queue:vip:any
     └─ NO
        └─ queue:general + queue:free
     ```
   - **Redis Queues (Single-bot mode):**
     - `queue:vip:bot_X` - All VIP users
     - `queue:vip:gender:male:bot_X` - VIP males
     - `queue:vip:gender:female:bot_X` - VIP females
     - `queue:vip:any:bot_X` - VIP with no preference
     - `queue:general:bot_X` - Free users
     - `queue:free:bot_X` - Duplicate for consistency
   
   - **Cross-bot mode (federation):**
     - `queue:vip` - Global VIP pool
     - `queue:vip:gender:male` - Global VIP males
     - `queue:vip:any` - Global VIP no preference
     - `queue:general` - Global free users
   
   - **Data Structure:** Redis lists (LPUSH/RPOP)
   - **Deduplication:** Checks `isUserQueued()` before adding

3. `matchNextUser(botId, userId, preferences)` - Find partner
   - **Algorithm (Priority-based):**
     ```
     User is VIP?
     ├─ YES
     │  ├─ Try gender-specific queue first
     │  │  └─ Pop from queue:vip:gender:{pref}
     │  ├─ If empty, try VIP-any
     │  │  └─ Pop from queue:vip:any
     │  └─ If still empty, match with free user
     │     └─ Pop from queue:free
     └─ NO (free user)
        └─ Pop from queue:general (random free user)
     ```
   - **Matching Result:**
     ```javascript
     {
       partnerId: number,
       partnerBot: string, // Bot instance ID
       partnerUser: User,  // Full user object
       isPartnerVip: boolean
     }
     ```
   - **Side Effects:**
     - Creates Redis pair keys: `pair:userId → partnerId`
     - Updates user's botId (for cross-bot routing)
     - Sets 24h expiry on pair key
   
   - **Availability Check:**
     - Verifies partner not banned
     - Verifies partner not already paired
     - Confirms partner channel membership

---

### 👑 [VipService.js](services/vipService.js) - Premium Membership

**Responsibility:** Manage VIP subscriptions and benefits

**Class: VipService**

**Key Methods:**

1. `activateVip(userId, durationDays, opts)` - Grant VIP
   - **Inputs:**
     - `userId`: Telegram ID
     - `durationDays`: Number of days
     - `opts`: {transaction, source, deferSetRedis}
   
   - **Logic:**
     - Check existing VipSubscription
     - If active: Add days to expiresAt (stack subscriptions)
     - If expired/none: Create new with expiry date
     - Set Redis cache with TTL (unless deferSetRedis=true)
   
   - **Database Operation:**
     ```javascript
     VipSubscription.upsert({
       userId,
       expiresAt: new Date(now + days*24*3600*1000),
       source: 'payment'|'referral'|'affiliate'
     })
     ```
   
   - **Redis Operation:**
     ```
     SET user:vip:{userId} 1 EX {ttlSeconds}
     ```
   
   - **Transaction Support:**
     - Integrates with Sequelize transactions
     - Allows deferred Redis updates (set after DB commit)
     - Prevents: Redis cache ≠ DB state

   - **Returns:** New expiry date

2. `isVip(userId)` - Check VIP status
   - **Lookup Order:**
     1. Redis check (fast cache)
     2. DB fallback (accurate, slower)
     3. Update Redis if DB valid
   - **Returns:** boolean

3. `isVipActive(userId)` - Validate & expire
   - **Logic:**
     - Fetch from DB
     - If expired: Delete record, clear Redis
     - If active: Refresh Redis TTL
     - On error: Conservative (assume non-VIP)
   
   - **Logging:** Logs downgrades to `vip.log`
   - **Returns:** boolean

4. `getVipPreferences(userId)` - Get gender preference
   - Uses UserCacheService for performance
   - Returns: `{gender: 'Male'|'Female'|'Other'|'Any'}`
   - Default: 'Any'

5. `setRedisVip(userId, expiryDate)` - Cache VIP status
   - Calculates TTL from expiry
   - Sets Redis key with expiry
   - Ensures: Max TTL <= DB expiry

6. `checkAndExpire(userId)` - Force expiry check
   - Manually triggers expiration logic
   - Returns: true if downgraded

---

### 🔒 [LockChatService.js](services/lockChatService.js) - Time-locked Sessions

**Responsibility:** Prevent partner from skipping/stopping during paid time windows

**Class: LockChatService**

**Key Methods:**

1. `createLock(chatId, userId, durationMinutes, starsPaid)` - Create lock
   - **Pre-checks:**
     - Validates duration against allowed values
     - Rate limit check: VIP (5/hour), non-VIP (1/hour)
   
   - **Rate Limiting:**
     ```
     counter = INCR lock:count:{userId}
     if counter >= limit: throw error
     expire counter after 1 hour
     ```
   
   - **DB Record:**
     ```javascript
     LockHistory.create({
       chatId, userId, durationMinutes,
       expiresAt: now + duration*60*1000,
       starsPaid
     })
     ```
   
   - **Redis Keys:**
     ```
     chat:locks:{chatId}:{userId} = '1' (TTL: durationMinutes*60)
     lock:timer:{chatId}:{userId} = timestamp (TTL: same)
     ```
   
   - **Side Effects:**
     - Logs to `locks.log`
     - Alerts admin on rate-limit violation
     - Throws error if limit exceeded
   
   - **Returns:** `{key, expiresAt}`

2. `createLockRecord(chatId, userId, durationMinutes, starsPaid, opts)` - DB-only
   - Creates database record WITHOUT Redis keys
   - Used within transactions (Redis updated after commit)
   - **Returns:** LockHistory record

3. `setRedisLock(chatId, userId, durationMinutes)` - Set cache
   - Called after transaction commit
   - Sets both `chat:locks:*` and `lock:timer:*` keys
   - **Why separate?** Prevents orphaned Redis keys

4. `isChatLocked(chatId)` - Check if locked
   - Scans Redis for `chat:locks:{chatId}:*`
   - Uses SCAN (non-blocking, iterative)
   - Handles lazy expiry (keys without active locks)
   - **Returns:** boolean

5. `getDurations()` - Get dynamic durations
   - Fetches from `starsPricing.getLockPricing()`
   - Format: `{5: 15, 10: 25, 15: 35}` (minutes → stars)

6. **Static property:**
   - `durations` - Fallback hardcoded values

---

### 💳 [PaymentService.js](services/paymentService.js) - Telegram Stars Transactions

**Responsibility:** Handle payment invoices and transaction completion

**Class: PaymentService**

**Key Methods:**

1. `constructor(bot)` - Setup payment listeners
   - Registers `message` listener for `msg.successful_payment`
   - Registers `callback_query` listener for buy button clicks
   - Handles both events asynchronously

2. **successful_payment Handler** (message event)
   - Triggered: When user completes payment via Telegram
   - **Payload:**
     ```javascript
     msg.successful_payment = {
       currency: 'XTR', // Telegram Stars
       total_amount: 50, // Stars paid
       invoice_payload: JSON.string // {type, planId/duration}
     }
     ```
   - **Processing:**
     1. Parse invoice_payload (JSON)
     2. Validate type: 'VIP' or 'LOCK'
     3. For VIP:
        - Activate VIP subscription
        - Credit affiliate rewards
        - Process referral bonuses
     4. For LOCK:
        - Create lock record
        - Deduct lock credits
     5. Record transaction in DB
   
   - **Affiliate Processing:**
     - Call `ReferralService.processReferralForPayment()`
     - 50% commission to referrer
     - VIP days grant: `affiliateStars / 10`
     - Lock minutes grant: `affiliateStars / 3`

3. **callback_query Handler** (for STAR_BUY:* buttons)
   - Format: `STAR_BUY:TYPE:IDENT`
   - Examples: `STAR_BUY:VIP:BASIC`, `STAR_BUY:LOCK:10`
   - **Logic:**
     1. Extract type & ident
     2. Fetch pricing from starsPricing
     3. Build invoice with title, description, amount
     4. Call `bot.sendInvoice()` with XTR currency
   
   - **Invoice Details:**
     - Currency: 'XTR' (Telegram Stars)
     - Provider: Empty string (Telegram handles it)
     - Prices: `[{label, amount}]`
     - Amount: Stars directly (NOT cents)

4. **VIP Purchase Flow:**
   - Get plan from dynamic config
   - Validate plan exists
   - Build title: `VIP {planName}`
   - Description: `{days} day(s) VIP — {stars} Stars`
   - Payload: `{type: 'VIP', planId, days}`

5. **Lock Purchase Flow:**
   - Get pricing from `starsPricing.getLockPricing()`
   - Title: `Lock Chat — {duration} min`
   - Description: `{duration} minute lock — {stars} Stars`
   - Payload: `{type: 'LOCK', duration}`

---

### 🎁 [ReferralService.js](services/referralService.js) - Invite Rewards

**Responsibility:** Track referrals and process rewards

**Class: ReferralService**

**Key Methods:**

1. `createReferral(inviterId, invitedId)` - Track referral
   - Validates: Not self-referral
   - Checks: Doesn't already exist
   - Creates: `Referral` record with status 'pending'
   - **Status Flow:** pending → accepted (when invited user /start)

2. `processReferralForPayment(userId, payment, opts)` - Called after payment
   - **Input:** userId (who paid), payment object, transaction
   - **Processing:**
     1. Find referral where invitedId=userId AND status='accepted'
     2. If found, calculate affiliate rewards:
        - **Affiliate Commission:** 50% of Stars paid
          - For VIP: `stars * 0.5 / 10 = vipDays`
          - For LOCK: `stars * 0.5 / 3 = lockMinutes`
        - Creates AffiliateReward record
        - Activates VIP for referrer
     
     3. Check milestone achievements:
        - Every 5 referrals = 15 VIP days
        - Count total accepted referrals
        - Calculate new milestones since last reward
        - Grant additional VIP if milestone reached
   
   - **Post-actions:** Array of callbacks to run after transaction commit
     - Deferred Redis updates (to match DB state)
   
   - **Returns:** Array of post-action callbacks

3. `acceptPendingReferrals(invitedId)` - Called on /start
   - Finds all pending referrals for this user
   - Updates status to 'accepted'
   - Logs to `referrals.log`
   - Notifies admin of acceptance
   - **Returns:** Count of accepted referrals

---

### 😤 [AbuseService.js](services/abuseService.js) - Violation Tracking

**Responsibility:** Track abusive behavior and alert admins

**Class: AbuseService**

**Key Methods:**

1. `recordLockAbuse(params)` - Lock violation
   - **When:** Non-owner tries to skip/stop during active lock
   - **Tracking:**
     ```
     key = lock:abuse:{chatId}:{offenderId}
     count = INCR key
     EXPIRE key 3600 (1 hour window)
     ```
   - **Levels:**
     - Count 1-2: NONE
     - Count 3: WARN (logged to abuse.log)
     - Count 4+: ALERT (logged + admin notified)
   
   - **Returns:** `{count, level}`

2. `recordDisconnectAbuse(params)` - Disconnect abuse
   - **When:** User repeatedly disconnects or disconnects during lock
   - **Tracking:**
     ```
     key = disconnect:abuse:{userId}
     count = INCR key
     EXPIRE key 86400 (24 hour window)
     ```
   - **Levels:**
     - Count 1-2: NONE
     - Count 3: WARN
     - Count 5+: ALERT
   
   - **Alert Contains:** userId, chatId, duringLock flag, count
   - **Returns:** `{count, level}`

---

### 👥 [UserCacheService.js](services/userCacheService) - Performance Cache

**Responsibility:** Cache frequently-accessed user data to reduce DB queries

**Key Methods:**

1. `getUser(userId)` - Fetch with cache
   - Checks Redis (5 min TTL)
   - Falls back to DB query
   - Caches result after DB hit
   - Prevents: N+1 query problem

2. `setUser(userId, userData)` - Update cache
   - Stores serialized user object
   - 5 minute expiry
   - Used after profile updates

3. `deleteUser(userId)` - Invalidate cache
   - Removes from Redis
   - Forces fresh DB load on next access

---

### ⚙️ [ConfigService.js](services/configService.js) - Dynamic Configuration

**Responsibility:** Manage bot settings without restarts

**Key Methods:**

1. `get(key, defaultValue)` - Fetch config value
   - Checks `AppConfig` table
   - Returns DB value or default
   - Used for: bot_tokens, feature flags, pricing

2. `set(key, value)` - Update config
   - Upserts `AppConfig` record
   - No restart needed
   - Used by: Admin dashboard

3. `initializeDefaults()` - Setup initial config
   - Creates default AppConfig entries
   - Called at server startup

---

### 🔗 [AffiliateService.js](services/affiliateService.js) - Commission System

**Responsibility:** Calculate and process affiliate rewards

**Class: AffiliateService**

**Key Methods:**

1. `convertStarsToVipDays(starsAmount)` - Calculate reward
   - Formula: `floor(stars / 10) * 0.8`
   - Example: 100 Stars → 8 VIP days
   - Kept for backwards compatibility

2. `creditAffiliate(buyerTelegramId, sourcePaymentId, paidStars, paymentType, opts)` - Process affiliate credit
   - **Pre-checks:**
     - Find referral (invitedId = buyer, status = 'accepted')
     - Prevent self-referral
     - Idempotency: Check if already credited
   
   - **Reward Calculation:**
     - Affiliate gets 50% of Stars paid
     - For VIP: `affiliateStars / 10 = vipDays`
     - For LOCK: `affiliateStars / 3 = lockMinutes`
   
   - **Database:**
     - Creates AffiliateRewardCredit record
     - Status: 'AVAILABLE' (ready for redemption)
   
   - **Logging:**
     - All actions logged to `affiliate.log`
     - Tracks: payments, skips, errors
   
   - **Error Handling:**
     - Errors logged but not thrown
     - Payment flow continues even if affiliate fails
   
   - **Returns:** `{created, reason, referrerId, rewardType, rewardValue}`

---

## MODELS & DATABASE

### 📊 Database Architecture

**ORM:** Sequelize (abstraction layer)
**Supported DBs:**
- **Production:** PostgreSQL (40k+ DAU)
- **Development:** SQLite (max 5k DAU)
- **Cache:** Redis (session data, queues)

**Connection Pooling:**
```javascript
PostgreSQL {
  max: 50,        // High concurrency
  min: 10,        // Keep warm
  acquire: 30000, // 30s timeout
  idle: 10000     // 10s idle timeout
}

SQLite {
  max: 5,         // Limited
  min: 1,
  acquire: 30000,
  idle: 10000
}
```

### 📋 [User Model](models/userModel.js) - Telegram User Records

**Schema:**
```javascript
{
  userId: BIGINT (primaryKey, unique),
  telegramId: BIGINT,
  botId: STRING (default: 'default'),       // Which bot user joined from
  botName: STRING,                          // Human-readable bot name
  gender: ENUM('Male', 'Female', 'Other'),
  vipGender: ENUM('Male', 'Female', 'Other', 'Any'), // VIP preference
  hasStarted: BOOLEAN (default: false),     // Completed /start
  age: INTEGER,
  banned: BOOLEAN (default: false),         // Admin ban status
  totalChats: INTEGER (default: 0),         // Chat count stat
  dailyStreak: INTEGER (default: 0),        // Consecutive days
  lastActiveDate: DATEONLY,                 // For streak tracking
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

**Indexes:** userId (PRIMARY), telegramId, botId (for federation)

**Size Estimate:** ~100 bytes per record (1M users = 100 MB)

---

### 💬 [Chat Model](models/chatModel.js) - Conversation History

**Schema:**
```javascript
{
  id: INTEGER (auto-increment, primaryKey),
  user1: BIGINT,                       // Conversation participant 1
  user2: BIGINT,                       // Conversation participant 2
  active: BOOLEAN (default: true),     // Still ongoing?
  startedAt: TIMESTAMP,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

**Purpose:** Track historical conversations for analytics

**Size Estimate:** ~60 bytes per record (100k chats = 6 MB)

---

### 👑 [VipSubscription Model](models/vipSubscriptionModel.js) - Premium Memberships

**Schema:**
```javascript
{
  id: INTEGER (primaryKey),
  userId: BIGINT (unique),                 // One subscription per user
  expiresAt: TIMESTAMP,                    // When VIP ends
  source: STRING ('payment', 'referral', 'affiliate'),
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

**Query Pattern:** `VipSubscription.findOne({where: {userId}})`

**Size:** ~70 bytes per record

---

### 💰 [StarTransaction Model](models/starTransactionModel.js) - Payment Audit Log

**Schema:**
```javascript
{
  id: INTEGER (primaryKey),
  userId: BIGINT,
  type: ENUM ('VIP', 'LOCK'),              // Purchase type
  amountStars: INTEGER,
  currency: STRING ('XTR'),                // Telegram Stars
  paymentStatus: ENUM ('PENDING', 'SUCCESS', 'FAILED'),
  sourcePaymentId: STRING,                 // Telegram payment ID
  itemId: STRING,                          // Plan ID or duration
  invoicePayload: JSON,                    // Original payload
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

**Purpose:** Audit trail for payments and refunds

---

### 🔒 [LockChat Model](models/lockChatModel.js) - Lock History

**Schema:**
```javascript
{
  id: INTEGER (primaryKey),
  chatId: BIGINT,
  userId: BIGINT,                    // Who created the lock
  durationMinutes: INTEGER,          // 5, 10, or 15
  expiresAt: TIMESTAMP,
  starsPaid: INTEGER,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

**Purpose:** Audit trail for lock purchases

**Size:** ~80 bytes per record

---

### 📬 [Referral Model](models/referralModel.js) - Invite Tracking

**Schema:**
```javascript
{
  id: INTEGER (primaryKey),
  inviterId: BIGINT,                 // Who sent invite
  invitedId: BIGINT,                 // Who got invited
  status: ENUM('PENDING', 'ACCEPTED'),
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

**Status Flow:**
- **PENDING:** Invite sent, waiting for /start
- **ACCEPTED:** Invited user completed /start, eligible for rewards

**Query Pattern:** Find by invitedId to check who referred

---

### 🎁 [AffiliateReward Model](models/affiliateRewardModel.js) - Commission Ledger

**Schema:**
```javascript
{
  id: INTEGER (primaryKey),
  userId: BIGINT,                    // Affiliate (referrer)
  vipDaysGranted: INTEGER,           // Reward in VIP days
  source: ENUM ('affiliate_payment', 'referral_milestone'),
  createdAt: TIMESTAMP
}
```

**Purpose:** Audit trail for affiliate earnings

**Accounting:** Sum `vipDaysGranted` by user to see total earned

---

### 🎫 [AffiliateRewardCredit Model](models/affiliateRewardCreditModel.js) - Credit Pool

**Schema:**
```javascript
{
  id: INTEGER (primaryKey),
  referrerTelegramId: BIGINT,        // Who earned it
  sourcePaymentId: STRING,           // Which purchase triggered it (idempotency key)
  rewardType: ENUM ('VIP_DAYS', 'LOCK_MINUTES'),
  rewardValue: INTEGER,              // Days or minutes
  status: ENUM ('AVAILABLE', 'REDEEMED', 'EXPIRED'),
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

**Purpose:** Redemption pool for referrers to convert to VIP/lock

---

## UTILITIES & HELPERS

### ⌨️ [keyboards.js](utils/keyboards.js) - Interactive Keyboards

**Responsibility:** Generate Telegram keyboard markups for UX

**Key Keyboards:**

1. `mainKeyboard` - Main menu (idle state)
   - [🔍 Find Partner]
   - [☰ Menu]

2. `menuKeyboard` - Full options menu
   - [👤 My Profile] [📊 My Stats]
   - [⚙️ Settings] [📜 Rules]
   - [🆔 My ID] [⭐ Buy Premium]
   - [⭐ Rewards / Redeem] [🔙 Back]

3. `chatActive` - Active chat state
   - [🔒 Lock Chat] [⏭ Next Partner]
   - [❌ Stop Chat]

4. `genderSelection` - Profile setup
   - [👨 Male] [👩 Female]
   - [🌈 Other]

5. `vipGenderPreferenceSelection` - VIP preference
   - [👨 Male] [👩 Female]
   - [🌈 Other] [🌐 Any]

6. `getLockDurationKeyboard()` - Lock selector (inline)
   - [5 minutes] [10 minutes] [15 minutes]
   - [🔙 Cancel]

7. `getSettingsKeyboard(isVip)` - Settings menu
   - Dynamic: Add "Partner Gender Preference" for VIPs

**Keyboard Features:**
- `persistent: true` - Stays visible across messages
- `resize_keyboard: true` - Mobile-optimized
- `one_time: true` - Disappears after selection
- Emoji-rich for engagement

---

### 🎯 [BotRouter.js](utils/botRouter.js) - Cross-Bot Routing

**Responsibility:** Route messages between bots in federation mode

**Key Methods:**

1. `setUserBot(userId, botId)` - Record bot assignment
   - Stores in Redis (24h TTL)
   - Updates User model
   - Used during matching

2. `getUserBot(userId)` - Retrieve bot assignment
   - Redis lookup (fast)
   - DB fallback
   - Default: 'bot_0'

3. `routeMessage(targetUserId, message)` - Send via correct bot
   - Finds target user's bot
   - Uses that bot instance to send
   - Handles cross-bot messages
   - **Example:** User from bot_0 chatting with bot_1 user

4. `relayMedia(targetUserId, mediaType, fileId)` - Forward files
   - Downloads from source bot
   - Caches locally
   - Uploads via target bot
   - Supports: photo, video, document, audio

---

### ⚡ [performance.js](utils/performance.js) - Optimization Utils

**Responsibility:** Caching, rate limiting, memory management

**Objects:**

1. `cache` - User data caching
   - `getUser(userId)` - Fetch with 5 min TTL
   - `setUser(userId, data)` - Store in Redis
   - `deleteUser(userId)` - Invalidate

2. `rateLimiter` - Message rate limiting
   - `checkLimit(userId, action, limit=90, window=60)` - Check if under limit
   - **Default:** 90 messages/minute per user
   - Key: `rate:{action}:{userId}`
   - Uses INCR + EXPIRE

3. `cleanup` - Memory management
   - `cleanInactiveData()` - Remove duplicates from queues
   - `extendActiveSessions()` - Extend pair:* keys to 24h
   - Called: Periodically by job scheduler

**Performance Techniques:**
- **Caching:** Avoid repeated DB queries
- **Rate limiting:** Prevent spam/DDoS
- **Session extension:** Keep important data in Redis
- **Queue dedup:** Remove duplicates from matching queues

---

### 📝 [enhancedMessages.js](utils/enhancedMessages.js) - Message Templates

**Responsibility:** Store message templates with formatting

**Content:**
- Welcome message with emoji
- Profile completion acknowledgment
- Chat started/ended messages
- Lock activated/expired messages
- VIP benefit descriptions
- Error messages

**Format:** Markdown with emoji for visual appeal

---

### 🔍 [helper.js](utils/helper.js) - General Utilities

**Likely Functions:**
- String formatters
- Number validators
- Date/time helpers
- Error handlers

---

### 🗝️ [redisKeys.js](utils/redisKeys.js) - Redis Key Naming

**Responsibility:** Centralize Redis key naming to prevent collisions

**Key Generators:**
- `QUEUE_VIP_KEY(botId)` → `queue:vip:bot_X`
- `QUEUE_GENERAL_KEY(botId)` → `queue:general:bot_X`
- `QUEUE_VIP_GENDER_KEY(botId, gender)` → `queue:vip:gender:male:bot_X`
- `PAIR_KEY(userId)` → `pair:userId`
- `USER_VIP_KEY(userId)` → `user:vip:userId`
- etc.

**Benefits:** Consistency, maintainability, reduces typos

---

### 🔧 [redisOptimizer.js](utils/redisOptimizer.js) - Redis Efficiency

**Responsibility:** Optimize Redis operations for performance

**Likely Features:**
- Pipelining (batch operations)
- Lua scripting (atomic operations)
- Connection pooling
- Error retry logic

---

### 🔐 [redisScanHelper.js](utils/redisScanHelper.js) - Non-blocking Scans

**Responsibility:** SCAN iteration instead of KEYS for large datasets

**Key Method:**
- `scanKeys(redisClient, pattern, count)` - Iterative SCAN
  - Non-blocking (cursor-based)
  - Supports glob patterns
  - Returns all matching keys
  - Used for: Finding locks, abuse records, queues

---

### 🧠 [sessionManager.js](utils/sessionManager.js) - Session Tracking

**Note:** File not found in workspace, but likely includes:
- Session creation/validation
- Session expiry management
- Session data storage
- Cross-request state management

---

### 📊 [logger.js](utils/logger.js) - Logging Utility

**Responsibility:** Append structured logs to files

**Key Method:**
- `appendJsonLog(filename, payload)` - Write JSON log
  - Appends to file (not truncate)
  - Used for: abuse.log, vip.log, locks.log, affiliate.log, referrals.log
  - Enables audit trails and debugging

---

## ROUTES & ADMIN PANEL

### 🛣️ [adminRoutes.js](routes/adminRoutes.js) - REST API (1716 lines)

**Responsibility:** Admin dashboard backend API

**Authentication Middleware:**
- `requireAdmin` - Verify admin session
- `validateAdminId` - Check Telegram ID
- `createSession` - Generate session token
- `isAdmin` - Quick permission check
- `checkRateLimit` - Prevent brute force

**Public Routes:**

1. `GET /login` - Login page
   - Serves `admin-login.html`
   - UI for entering Telegram ID and code

2. `POST /api/request-login` - Generate login code
   - Input: `{telegramId}`
   - Output: Sends one-time code via Telegram DM
   - Validation: Checks if ID in ADMIN_TELEGRAM_IDS
   - Rate limiting: Prevent spam

3. `POST /api/verify-code` - Verify code
   - Input: `{telegramId, code}`
   - Validates: Code matches generated code
   - Creates: Admin session
   - Returns: `{token, expiresAt}`

**Protected Routes (require session):**

4. `GET /dashboard` - Dashboard page
   - Serves `admin/dashboard.html`
   - Redirects to `/login` if unauthorized

5. `GET /api/check-config` - Configuration check
   - Returns: Admin IDs configured, Redis type, bot status
   - Used for: Debugging connection issues

**Admin Statistics Routes:**

6. `GET /api/stats` - Platform metrics
   - Total users count
   - VIP users count
   - Active chats
   - Payment totals

7. `GET /api/users` - User list
   - Pagination support
   - Filters: banned status, gender, VIP status
   - Sorting: creation date, activity

8. `GET /api/users/:userId` - User details
   - Profile info (age, gender, preferences)
   - Chat history
   - VIP status & expiry
   - Referral links

**User Management Routes:**

9. `POST /api/users/:userId/ban` - Ban user
   - Sets User.banned = true
   - Prevents future access
   - Logs action

10. `POST /api/users/:userId/unban` - Unban user
    - Sets User.banned = false
    - Restores access

11. `DELETE /api/users/:userId` - Delete user
    - Hard delete all user records
    - Clears Redis caches
    - Logs action

**Payment Management Routes:**

12. `GET /api/payments` - Payment history
    - Lists StarTransaction records
    - Filters: date range, type (VIP/LOCK), status
    - Sorting: newest first

13. `GET /api/payments/:paymentId` - Payment details
    - Full invoice data
    - User info
    - Affiliate details

14. `POST /api/payments/:paymentId/refund` - Refund payment
    - Via Telegram API
    - Reverses: VIP grant or lock credits
    - Logs refund

**VIP Management Routes:**

15. `GET /api/vip` - VIP users list
    - Shows all active VIPs
    - Expiry dates
    - Grant sources (payment, referral)

16. `POST /api/vip/:userId` - Grant VIP
    - Input: `{durationDays}`
    - Direct admin grant (no payment)
    - Logs grant with admin ID

17. `DELETE /api/vip/:userId` - Revoke VIP
    - Ends subscription early
    - Notifies user

**Referral Management Routes:**

18. `GET /api/referrals` - Referral list
    - Shows all referral relationships
    - Status (pending/accepted)
    - Rewards granted

19. `GET /api/referrals/by-user/:userId` - User's referrals
    - Invites sent by user
    - Conversion rates
    - Earnings

**Configuration Routes:**

20. `GET /api/config` - Fetch all config
    - Bot tokens (masked)
    - Feature flags
    - Pricing settings
    - Admin settings

21. `POST /api/config` - Update config
    - Input: `{key, value}`
    - Updates AppConfig table
    - No restart needed
    - Changes take effect immediately

22. `GET /api/config/:key` - Fetch single config
    - Returns: Current value

23. `POST /api/config/pricing` - Update pricing
    - VIP plan prices
    - Lock prices
    - Affiliate percentages

**Broadcast Routes:**

24. `POST /api/broadcast` - Send to all users
    - Input: `{message, messageType}` (text/image)
    - Sends DM to all active users
    - Tracks: delivery status, failures
    - Logs to `broadcasts.log`

**Lock Management Routes:**

25. `GET /api/locks` - Active locks list
    - All currently active time-locks
    - Remaining duration
    - Users locked in chat

26. `DELETE /api/locks/:lockId` - Manual lock removal
    - Admin override
    - Notifies both users
    - Logs removal

**Logs & Audit Routes:**

27. `GET /api/logs/:logType` - Fetch log file
    - Types: abuse.log, vip.log, locks.log, affiliate.log, referrals.log, broadcasts.log
    - Pagination support
    - Sorting: newest first

28. `GET /api/audit/:userId` - User audit trail
    - All actions affecting user
    - Date range
    - Action type

---

## CONFIGURATION & MIDDLEWARE

### 🔧 [config/config.js](config/config.js) - Environment Configuration

**Loaded from `.env` file:**

**Bot Configuration:**
- `BOT_TOKEN` - Primary bot token (single bot)
- `BOT_TOKENS` - Array of tokens (multi-bot)
- `BOT_ID` - Default bot identifier

**Database:**
- `POSTGRES_URI` - PostgreSQL connection (production)
- `REDIS_URL` - Redis server URL (or memory://)
- `DB_SSL` - Enable SSL for Postgres

**Admin:**
- `ADMIN_TELEGRAM_IDS` - Comma-separated admin IDs
- `ADMIN_CHAT_ID` - Primary admin channel
- `ADMIN_CONTROL_CHAT_ID` - Alternative admin ID

**Channels:**
- `REQUIRED_CHANNEL_IDS` - Mandatory joins
- `ADMIN_CHANNEL_ID` - Media forwarding destination

**Server:**
- `ADMIN_PORT` - Express server port
- `NODE_ENV` - 'development' or 'production'

---

### 🛡️ [middlewares/authMiddleware.js](middlewares/authMiddleware.js) - Channel Verification

**Key Function:**

`checkUserJoined(bot, userId, chatId)` - Verify channel membership
- **Logic:**
  1. Get required channels from config
  2. For each channel:
     - Call `bot.getChatMember(channelId, userId)`
     - Check status: 'member', 'administrator', 'creator'
  3. If all channels joined: Return true
  4. If any missing: Send message listing channels, return false
- **Cache:** Optional caching to avoid repeated API calls
- **Error Handling:** Graceful handling of invalid channel IDs

---

### 🔐 [middlewares/adminAuth.js](middlewares/adminAuth.js) - Session Management

**Key Functions:**

1. `requireAdmin(req, res, next)` - Protect routes
   - Checks: `req.cookies.adminToken`
   - Validates: Token in session store
   - If invalid: Redirect to `/admin/login`
   - If valid: Continue to route handler

2. `validateSession(token)` - Check token validity
   - Looks up token in memory/Redis store
   - Checks: Expiry, permissions
   - Returns: Session object or null

3. `createSession(adminId)` - Generate new session
   - Creates: Random token
   - Stores: In session store with TTL (24h)
   - Sets: Cookie on response
   - Returns: {token, expiresAt}

4. `isAdmin(chatId)` - Quick permission check
   - Compares: chatId vs ADMIN_TELEGRAM_IDS
   - Returns: boolean

---

### 🚫 [middlewares/featureGuard.js](middlewares/featureGuard.js) - Feature Flags

**Responsibility:** Enable/disable features without deployment

**Key Function:**

`isFeatureEnabled(featureName)` - Check if enabled
- Gets: Feature flag from config
- Returns: boolean
- Uses: `featureFlags.js` configuration

---

### 📋 [config/featureFlags.js](config/featureFlags.js) - Feature Toggle Configuration

**Flags:**
- `ENABLE_STARS_PAYMENTS` - Toggle payment system
- `ENABLE_CROSS_BOT_MATCHING` - Cross-bot federation
- `ENABLE_ADMIN_ALERTS` - Send alerts to admin
- `ENABLE_VIP_LOCK_PREFERENCE` - VIP gender filters
- `ENABLE_AFFILIATE_SYSTEM` - Referral rewards

---

### 💵 [constants/starsPricing.js](constants/starsPricing.js) - Dynamic Pricing

**Provides:**

`getVipPlans()` - Fetch VIP subscription plans
- Format:
  ```javascript
  {
    BASIC: {id: 'basic', name: 'Basic', days: 7, stars: 49},
    PLUS: {id: 'plus', name: 'Plus', days: 30, stars: 199},
    PREMIUM: {id: 'premium', name: 'Premium', days: 90, stars: 499}
  }
  ```

`getLockPricing()` - Fetch lock prices
- Format: `{5: 15, 10: 25, 15: 35}` (minutes → stars)
- Sourced from: Database config (hot-updatable)

---

## JOBS & BACKGROUND TASKS

### 🧹 [jobs/cleanupJob.js](jobs/cleanupJob.js) - Maintenance

**Responsibility:** Periodic cleanup of stale data

**Tasks:**
- Remove expired sessions
- Clean obsolete queue entries
- Clear old Redis cache keys
- Archive old logs
- Optimize database (VACUUM for SQLite)

**Schedule:** Runs hourly (configured via cron)

---

### 🪪 [jobs/vipExpiryJob.js](jobs/vipExpiryJob.js) - VIP Expiration

**Responsibility:** Detect and process VIP downgrades

**Tasks:**
- Find expired VipSubscription records
- Delete records (already handled by VipService)
- Log downgrades to `vip.log`
- Notify users of expiration

**Schedule:** Runs daily

---

### 🤝 [jobs/referralAuditJob.js](jobs/referralAuditJob.js) - Referral Validation

**Responsibility:** Ensure referral integrity

**Tasks:**
- Find pending referrals older than 30 days
- Check if invited user ever /start
- Clean up stale pending referrals
- Audit affiliate ledger for duplicates

**Schedule:** Runs daily

---

## DEPLOYMENT & DEVOPS

### 📦 [ecosystem.config.js](ecosystem.config.js) - PM2 Configuration

**Responsibility:** Define process management for production

**Processes:**
- `bots.js` - Bot worker (1 instance per token)
- `server.js` - Admin dashboard (1 instance)

**Features:**
- Auto-restart on crash
- Watch file changes (development mode)
- Log rotation
- Environment-specific settings (production/development)

**Usage:**
```bash
pm2 start ecosystem.config.js --env production  # Deploy
pm2 monit                                        # Monitor
pm2 logs --lines 100                           # View logs
```

---

### 🐳 [Dockerfile](Dockerfile) - Container Image

**Responsibility:** Package app for Docker deployment

**Base Image:** node:16-alpine

**Stack:**
- Copy source files
- Install dependencies
- Expose ports (3000 for admin)
- Health check: `/health` endpoint
- Run: `npm start` (bots.js)

---

### 📝 [Database Migrations](database/safeMigrations.js)

**Responsibility:** Version-controlled schema changes

**Approach:**
- No runtime auto-sync (prevent accidental changes)
- Offline SQL migrations applied manually
- Tracked in version control
- Reversible (rollback scripts)

---

## SUMMARY

This codebase is a **production-ready Telegram bot** with:

✅ **Multi-bot federation** (scaling across multiple bots)
✅ **Monetization system** (Telegram Stars: VIP subscriptions, time-locks)
✅ **Affiliate program** (50% referral commission)
✅ **Admin dashboard** (web-based control panel)
✅ **Performance optimizations** (caching, rate limiting, session management)
✅ **Abuse prevention** (tracking and alerts)
✅ **Multi-database support** (PostgreSQL for production, SQLite for dev)
✅ **Graceful error handling** (recovery, logging, admin notifications)

**Architecture:** Service-oriented (clean separation of concerns, testable, maintainable)

**Scalability:** Designed for 40k+ daily active users with PostgreSQL + Redis
