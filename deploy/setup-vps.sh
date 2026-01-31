#!/bin/bash

# ===========================================
# VPS Setup Script for Anonymous Chatbot
# Ubuntu 24.04 LTS - 2GB RAM / 1 vCPU
# ===========================================

set -e  # Exit on error

echo "=========================================="
echo "🚀 Anonymous Chatbot VPS Setup"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    print_error "Please run as root (sudo ./setup-vps.sh)"
    exit 1
fi

# ===========================================
# 1. System Update
# ===========================================
echo ""
echo "📦 Step 1: Updating system packages..."
apt update && apt upgrade -y
print_status "System updated"

# ===========================================
# 2. Install Essential Tools
# ===========================================
echo ""
echo "🔧 Step 2: Installing essential tools..."
apt install -y curl wget git build-essential software-properties-common
print_status "Essential tools installed"

# ===========================================
# 3. Install Node.js 20.x LTS
# ===========================================
echo ""
echo "📗 Step 3: Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
print_status "Node.js $(node -v) installed"
print_status "npm $(npm -v) installed"

# ===========================================
# 4. Install PM2 (Process Manager)
# ===========================================
echo ""
echo "⚙️ Step 4: Installing PM2..."
npm install -g pm2
print_status "PM2 installed"

# ===========================================
# 5. Install PostgreSQL
# ===========================================
echo ""
echo "🐘 Step 5: Installing PostgreSQL..."
apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
systemctl start postgresql
systemctl enable postgresql

# Create database and user
print_status "PostgreSQL installed, creating database..."

# Generate a random password or use a fixed one
DB_PASSWORD="ChatBot2024Secure!"

sudo -u postgres psql <<EOF
-- Create database
CREATE DATABASE chatbot_production;

-- Set password for postgres user
ALTER USER postgres WITH PASSWORD '${DB_PASSWORD}';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE chatbot_production TO postgres;
EOF

print_status "PostgreSQL database 'chatbot_production' created"
print_warning "Database password: ${DB_PASSWORD}"

# ===========================================
# 6. Install Redis
# ===========================================
echo ""
echo "🔴 Step 6: Installing Redis..."
apt install -y redis-server

# Configure Redis for production
sed -i 's/supervised no/supervised systemd/' /etc/redis/redis.conf

# Optimize Redis for low memory
cat >> /etc/redis/redis.conf <<EOF

# Memory optimization for 2GB VPS
maxmemory 256mb
maxmemory-policy allkeys-lru
EOF

# Start and enable Redis
systemctl restart redis-server
systemctl enable redis-server

print_status "Redis installed and configured"

# ===========================================
# 7. Configure Firewall
# ===========================================
echo ""
echo "🛡️ Step 7: Configuring firewall..."
apt install -y ufw

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH
ufw allow 4000/tcp      # Admin Panel
# Don't allow PostgreSQL/Redis from outside (local only)

# Enable firewall (without prompting)
echo "y" | ufw enable

print_status "Firewall configured (SSH:22, Admin:4000)"

# ===========================================
# 8. Create Application Directory
# ===========================================
echo ""
echo "📁 Step 8: Setting up application directory..."
mkdir -p /opt/chatbot
mkdir -p /opt/chatbot/logs
mkdir -p /opt/chatbot/old_data
chown -R $SUDO_USER:$SUDO_USER /opt/chatbot 2>/dev/null || true

print_status "Application directory created at /opt/chatbot"

# ===========================================
# 9. Configure System Limits
# ===========================================
echo ""
echo "⚡ Step 9: Optimizing system limits..."

# Increase file descriptors
cat >> /etc/security/limits.conf <<EOF
* soft nofile 65535
* hard nofile 65535
EOF

# Optimize sysctl for networking
cat >> /etc/sysctl.conf <<EOF

# Network optimizations for chatbot
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
EOF

sysctl -p

print_status "System limits optimized"

# ===========================================
# 10. Create Swap (for 2GB RAM)
# ===========================================
echo ""
echo "💾 Step 10: Creating swap space..."

if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    print_status "2GB swap created"
else
    print_warning "Swap already exists, skipping"
fi

# ===========================================
# Summary
# ===========================================
echo ""
echo "=========================================="
echo "✅ VPS Setup Complete!"
echo "=========================================="
echo ""
echo "📋 Summary:"
echo "   • Node.js: $(node -v)"
echo "   • npm: $(npm -v)"
echo "   • PM2: $(pm2 -v)"
echo "   • PostgreSQL: $(psql --version | head -1)"
echo "   • Redis: $(redis-server --version | cut -d' ' -f3)"
echo ""
echo "📁 Application directory: /opt/chatbot"
echo ""
echo "🔐 Database credentials:"
echo "   • Host: localhost"
echo "   • Port: 5432"
echo "   • Database: chatbot_production"
echo "   • User: postgres"
echo "   • Password: ${DB_PASSWORD}"
echo ""
echo "📝 Connection string for .env:"
echo "   POSTGRES_URI=postgresql://postgres:${DB_PASSWORD}@localhost:5432/chatbot_production"
echo "   REDIS_URL=redis://localhost:6379"
echo ""
echo "🔥 Next steps:"
echo "   1. Upload your code to /opt/chatbot"
echo "   2. Copy .env.production to .env and update settings"
echo "   3. Run: npm install --production"
echo "   4. Run: node scripts/init-postgres-schema.js"
echo "   5. Run: pm2 start ecosystem.config.js"
echo ""
print_warning "Save the database password above!"
echo "=========================================="
