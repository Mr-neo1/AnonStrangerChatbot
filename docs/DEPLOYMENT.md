# Deployment Notes

- Ensure `BOT_TOKEN`, `REDIS_URL`, `DATABASE_URL`, `ADMIN_CHAT_ID` are set.
- For production enable feature flags as needed.
- Consider using Redis (not memory) and PostgreSQL for scaling.
- Run `jobs/vipExpiryJob.js` on a scheduler (e.g., cron or worker process).
