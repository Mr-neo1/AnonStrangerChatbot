module.exports = {
  apps: [
    // Bot single process (multi-bot handled inside bots.js)
    // All tokens are loaded in one process to avoid Telegram 409 conflicts
    {
      name: 'bot',
      script: 'bots.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',  // Reduced for 2GB VPS
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      env: {
        NODE_ENV: 'development',
        CLUSTER_MODE: 'false',
        ENABLE_CROSS_BOT_MATCHING: 'true'
      },
      env_production: {
        NODE_ENV: 'production',
        CLUSTER_MODE: 'false',
        ENABLE_CROSS_BOT_MATCHING: 'true'
      },

      error_file: './logs/bot-err.log',
      out_file: './logs/bot-out.log',
      log_file: './logs/bot-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      instance_var: 'INSTANCE_ID',
      max_restarts: 10,
      min_uptime: '10s',
      pmx: true,
      automation: false
    },

    // Lightweight Admin Panel
    {
      name: 'admin-panel',
      script: 'admin-server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      kill_timeout: 3000,

      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },

      error_file: './logs/admin-err.log',
      out_file: './logs/admin-out.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },

    // Backup job (SQLite copy or pg_dump). Runs on cron and exits.
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
