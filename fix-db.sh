#!/usr/bin/env bash
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo -e "${RED}╔═════════════════════════════════════════════╗${NC}"
echo -e "${RED}║  Back Alley Bets — Switch to local database ║${NC}"
echo -e "${RED}╚═════════════════════════════════════════════╝${NC}"
echo ""

[[ $EUID -ne 0 ]] && die "Run as root: sudo bash fix-db.sh"

APP_DIR="/opt/backalleybets"
[[ ! -d "$APP_DIR" ]] && die "App not found at $APP_DIR"

# ─── Collect passwords ────────────────────────────────────────────────────────
read -rsp "$(echo -e "${CYAN}Choose a PostgreSQL password for casino_user (new or existing):${NC} ")" DB_PASS </dev/tty
echo ""
[[ -z "$DB_PASS" ]] && die "Password required."

# Try to read existing BANKER_ADMIN_PASSWORD from the current ecosystem config
EXISTING_ECOSYSTEM="$APP_DIR/ecosystem.config.cjs"
BANKER_PASS=""
if [[ -f "$EXISTING_ECOSYSTEM" ]]; then
  BANKER_PASS=$(grep -oP "BANKER_ADMIN_PASSWORD:\s*'\K[^']+" "$EXISTING_ECOSYSTEM" 2>/dev/null || true)
fi

if [[ -z "$BANKER_PASS" ]]; then
  read -rsp "$(echo -e "${CYAN}Banker admin password:${NC} ")" BANKER_PASS </dev/tty
  echo ""
  [[ -z "$BANKER_PASS" ]] && die "Banker password required."
else
  info "Found existing banker password in ecosystem config — reusing it."
fi

SESSION_SECRET=$(grep -oP "SESSION_SECRET:\s*'\K[^']+" "$EXISTING_ECOSYSTEM" 2>/dev/null || true)
if [[ -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  info "Generated new SESSION_SECRET."
fi

# ─── 1. Ensure PostgreSQL is running ─────────────────────────────────────────
info "Starting PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

# ─── 2. Create database and user ─────────────────────────────────────────────
info "Configuring local database..."

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='casino_user'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER casino_user WITH PASSWORD '$DB_PASS';"

sudo -u postgres psql -c "ALTER USER casino_user WITH PASSWORD '$DB_PASS';" >/dev/null

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='casino'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE casino OWNER casino_user;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE casino TO casino_user;" >/dev/null
success "Local database ready: postgresql://casino_user@localhost:5432/casino"

# ─── 3. Write .env for migration ─────────────────────────────────────────────
LOCAL_DB_URL="postgresql://casino_user:${DB_PASS}@localhost:5432/casino"

cat > "$APP_DIR/.env" <<EOF
DATABASE_URL=${LOCAL_DB_URL}
BANKER_ADMIN_PASSWORD=${BANKER_PASS}
SESSION_SECRET=${SESSION_SECRET}
NODE_ENV=production
PORT=8080
EOF
chmod 600 "$APP_DIR/.env"
success ".env written."

# ─── 4. Run Drizzle migrations ───────────────────────────────────────────────
info "Running database migrations on local database..."
cd "$APP_DIR"
set -a; source "$APP_DIR/.env"; set +a
pnpm --filter @workspace/db run push 2>&1 | tail -10
success "Schema migrated."

# ─── 5. Write PM2 ecosystem config ───────────────────────────────────────────
info "Writing ecosystem.config.cjs..."
cat > "$APP_DIR/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [{
    name: 'casino-api',
    script: './artifacts/api-server/dist/index.cjs',
    cwd: '${APP_DIR}',
    env: {
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: '${LOCAL_DB_URL}',
      BANKER_ADMIN_PASSWORD: '${BANKER_PASS}',
      SESSION_SECRET: '${SESSION_SECRET}',
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
  }]
};
EOF
success "ecosystem.config.cjs updated."

# ─── 6. Restart PM2 ──────────────────────────────────────────────────────────
info "Restarting PM2..."
pm2 delete casino-api 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save
success "PM2 restarted with local database."

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     Done!                            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  The live server now uses its ${CYAN}own local PostgreSQL${NC} database."
echo -e "  Replit has its own separate database — data is now isolated."
echo ""
echo -e "  ${YELLOW}NOTE:${NC} The live database starts empty. Use the banker panel"
echo -e "  to create players and set starting balances."
echo ""
echo -e "  Check status:  ${YELLOW}pm2 status${NC}"
echo -e "  View logs:     ${YELLOW}pm2 logs casino-api${NC}"
echo ""
