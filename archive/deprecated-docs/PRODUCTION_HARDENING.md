# Production Hardening Checklist

## Security
- Validate webhook payloads if webhooks are used.
- Enforce idempotent payment handling (unique `telegramChargeId` enforced in DB).
- Protect admin commands using `ADMIN_CHAT_ID` allowlist.

## Data safety
- Unique constraints on `telegramChargeId` in payments.
- Use DB transactions for payments and VIP activation.
- Redis TTLs for locks and sessions; cleanup on chat end.

## Abuse prevention
- Lock spam limits (enforced on payments/lock creation path).
- Referral duplication checks.
- Force disconnect logging and admin alerts.

## Scalability
- Use Redis connection pooling in production.
- Keep bot instances stateless; prefer centralized queues for broadcasts.
- PM2 cluster mode ready (process manager used in repo).

## Observability
- Add detailed logs for payments, locks, referrals.
- Send admin alerts on anomalies (feature flag controlled).

## Rollback
- Feature flags for instant disable (see `config/featureFlags.js`).
- Graceful handling of partial failures and DB transaction rollbacks.
