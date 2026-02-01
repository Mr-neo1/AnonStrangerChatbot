#!/bin/bash
cd /opt/chatbot
echo "=== Exporting Users from PostgreSQL ==="
sudo -u postgres psql -d chatbot_db -c "SELECT COUNT(*) as total_users FROM \"User\";"
echo ""
echo "=== Exporting to JSON ==="
sudo -u postgres psql -d chatbot_db -t -A -c "SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM \"User\") t;" > /tmp/users_export.json
echo "Export saved to /tmp/users_export.json"
ls -la /tmp/users_export.json
