module.exports = {
  apps: [
    // App 1: Bot single process (multi-bot handled inside bots.js)
    // All tokens are loaded in one process to avoid Telegram 409 conflicts
    {
      name: 'bot',
      script: 'bots.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        CLUSTER_MODE: 'false',
        ENABLE_CROSS_BOT_MATCHING: 'true',
        // Multi-bot tokens: add your bot tokens here (comma-separated)
        // Currently: token1, token2 (placeholder)
        BOT_TOKENS: '7571902799:AAEeaTpq9nXKuWv8dhXY1_a1seNWdDewepM,8036452705:AAEsvgMDTtesMcTR5jAc_IqLD2cxYp_W6Oo',
        BOT_TOKEN: '7571902799:AAEeaTpq9nXKuWv8dhXY1_a1seNWdDewepM',
        ADMIN_CONTROL_CHAT_ID: '1893973888',
        ADMIN_TELEGRAM_IDS: '1893973888',
        REDIS_URL: 'memory://',
        SQLITE_DB_PATH: './chatbot.db'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        CLUSTER_MODE: 'false',
        ENABLE_CROSS_BOT_MATCHING: process.env.ENABLE_CROSS_BOT_MATCHING || 'true',
        BOT_TOKENS: process.env.BOT_TOKENS || '',
        BOT_TOKEN: process.env.BOT_TOKEN || '',
        ADMIN_CONTROL_CHAT_ID: process.env.ADMIN_CONTROL_CHAT_ID || '',
        ADMIN_TELEGRAM_IDS: process.env.ADMIN_TELEGRAM_IDS || '',
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
        SQLITE_DB_PATH: process.env.SQLITE_DB_PATH || './chatbot.db'
      },

      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      instance_var: 'INSTANCE_ID',
      max_restarts: 10,
      min_uptime: '10s',
      pmx: true,
      automation: false
    },

    // App 2: Admin panel in fork mode (dedicated single core)
    {
      name: 'admin-panel',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 5000,

      env: {
        NODE_ENV: 'development',
        ADMIN_PORT: 3001
      },
      env_production: {
        NODE_ENV: 'production',
        ADMIN_PORT: 3001
      },

      error_file: './logs/admin-err.log',
      out_file: './logs/admin-out.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },

    // App 3: Backup job (SQLite copy or pg_dump). Runs on cron and exits.
    {
      name: 'db-backup',
      script: 'scripts/backup-db.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false, // run-on-cron only
      watch: false,
      cron_restart: '0 3 * * *', // daily at 03:00 server time
      kill_timeout: 5000,

      env: {
        NODE_ENV: 'production' // backups should use prod env
      },

      error_file: './logs/backup-err.log',
      out_file: './logs/backup-out.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
