# 🔐 Lightweight Admin Panel

A minimal, resource-efficient admin dashboard for controlling your Telegram bot.

## Quick Start

### 1. Configure Environment Variables

Add to your `.env` file:

```env
# Admin Panel Settings
ADMIN_PANEL_PORT=4000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password_here
```

### 2. Run Options

**Option A: Run Admin Panel Only**
```bash
npm run admin
```

**Option B: Run Everything (Bots + Admin Panel)**
```bash
npm run all
```

### 3. Access Dashboard

Open: `http://localhost:4000/admin`

---

## Features

### 📊 Overview Tab
- Total users, VIP active, today's joins
- Active chats, queue size, banned users
- Quick actions: Refresh, Broadcast, Maintenance toggle

### ⚙️ Config Tab
**Feature Flags** (toggle on/off):
- Stars Payments
- VIP System
- Lock Chat
- Referrals
- Admin Alerts
- Cross-Bot Matching
- Affiliate System
- Abuse Detection
- Maintenance Mode

**Lock Chat Pricing** (Stars):
- 5 min / 10 min / 15 min prices

**Required Channels**:
- Enable/disable channel requirement
- Set up to 2 required channels

**Referral Settings**:
- VIP days reward
- Affiliate commission %

### 👥 Users Tab
- Search by User ID or Telegram ID
- Filter: All / Banned / VIP
- Actions: Ban, Unban, Grant VIP

### 🤖 Bots Tab
- View all bot instances
- Enable/disable individual bots
- Token security (masked display)

### ⭐ VIP Plans Tab
- View current VIP plans
- Add new plans (name, days, stars)
- Remove plans

### 📢 Broadcast Tab
- Send messages to all or VIP users
- Supports Telegram Markdown
- Queued for background sending

---

## Security

- Session-based auth (24hr expiry)
- Token stored in localStorage
- Passwords should be set via env vars
- Runs on separate port (doesn't affect bot)

---

## Resource Usage

- **Memory**: ~15MB idle
- **CPU**: Near 0% when idle
- **No external dependencies** beyond Express
- **Single HTML file** with Tailwind CDN

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/login` | POST | Authenticate |
| `/api/admin/logout` | POST | End session |
| `/api/admin/stats` | GET | Get dashboard stats |
| `/api/admin/config` | GET/POST | Read/write config |
| `/api/admin/config/bulk` | POST | Bulk update configs |
| `/api/admin/users` | GET | List users (paginated) |
| `/api/admin/users/:id/ban` | POST | Ban user |
| `/api/admin/users/:id/unban` | POST | Unban user |
| `/api/admin/users/:id/vip` | POST | Grant VIP |
| `/api/admin/bots` | GET | List bots |
| `/api/admin/bots/:id/toggle` | POST | Enable/disable bot |
| `/api/admin/broadcast` | POST | Queue broadcast |

---

## Integration with Existing System

The admin panel uses:
- `ConfigService` - All settings stored in `app_config` table
- `User` model - User management
- `VipSubscription` model - VIP status
- `Redis` - Active chats/queue stats
- `QueueService` - Broadcast delivery
