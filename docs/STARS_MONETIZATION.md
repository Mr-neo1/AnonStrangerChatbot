# Stars Monetization

Overview of accepted Stars payments and routing to VIP or Lock features.

- Payments are received via Telegram successful_payment messages.
- Invoice `payload` must include `type` (VIP|LOCK) and other params (days|duration|chatId).
- All payments are idempotent and recorded in `StarTransaction` table.
