# Security Checklist

- Protect admin commands via allowlist (`ADMIN_CHAT_ID`).
- Validate payment idempotency via `telegramChargeId` unique constraint.
- Ensure feature flags can disable monetized features immediately.
- Sanitize/validate all incoming payloads.
