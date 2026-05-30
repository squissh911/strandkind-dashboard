#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${OPENCLAW_DASHBOARD_DIR:-/root/.openclaw/workspace/dashboard}"
TOOLS_DIR="${OPENCLAW_TOOLS_DIR:-/root/.openclaw/workspace/tools}"

mkdir -p "$APP_DIR"
cp -R . "$APP_DIR"
cd "$APP_DIR"

python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

cat > .env.example.local <<EOF
OPENCLAW_TOOLS_DIR=$TOOLS_DIR
OPENCLAW_GROWTH_CONFIG=$TOOLS_DIR/growth_config.json
HISTORICAL_DAY_COMMAND='python3 check_sk_live.py {date} --json'
PORT=8080

# Chat direct API, falls vorhanden:
# OPENCLAW_MESSAGE_API=http://localhost:PORT/message

# Oder Telegram:
# TELEGRAM_BOT_TOKEN=123:abc
# TELEGRAM_CHAT_ID=123456789
EOF

echo "Installation fertig: $APP_DIR"
echo "Start:"
echo "  cd $APP_DIR"
echo "  . .venv/bin/activate"
echo "  python app.py"
