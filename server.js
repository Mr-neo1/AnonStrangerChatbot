const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { sequelize } = require('./database/connectionPool');
const ConfigService = require('./services/configService');

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Admin routes
const adminRoutes = require('./routes/adminRoutes');
app.use('/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/admin/login');
});

/**
 * Start Express server
 */
async function startServer() {
  try {
    // Ensure database is connected
    await sequelize.authenticate();
    
    // Sync app_config table
    await sequelize.sync({ alter: false }); // Don't auto-alter, just create if missing
    
    // Create LockCredits table if it doesn't exist (fix for lock chat feature)
    const { createLockCreditsTable } = require('./database/createLockCreditsTable');
    await createLockCreditsTable().catch(err => {
      console.warn('⚠️  Could not create LockCredits table (may already exist):', err.message);
    });
    
    // Initialize default config values
    await ConfigService.initializeDefaults();

    const server = app.listen(PORT, () => {
      console.log(`\n🌐 Admin Dashboard running at http://localhost:${PORT}/admin`);
      console.log(`✅ Express server started on port ${PORT}`);
    });

    // Prevent server from auto-closing
    server.on('error', (err) => {
      console.error('Server error:', err);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, closing server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, closing server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start admin server:', error);
    process.exit(1);
  }
}

// Export for external start
module.exports = { app, startServer };

// Auto-start if run directly
if (require.main === module) {
  startServer();
}
