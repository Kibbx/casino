#!/usr/bin/env bash
set -e

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo -e "${RED}╔══════════════════════════════════════╗${NC}"
echo -e "${RED}║     Back Alley Bets — Installer      ║${NC}"
echo -e "${RED}╚══════════════════════════════════════╝${NC}"
echo ""

# ─── Require root ─────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run this script as root: sudo bash install.sh"

# ─── Collect configuration ────────────────────────────────────────────────────
read -rp "$(echo -e "${CYAN}Your server IP or domain name:${NC} ")" SERVER_HOST </dev/tty
[[ -z "$SERVER_HOST" ]] && die "Server host is required."

read -rsp "$(echo -e "${CYAN}Banker admin password (hidden):${NC} ")" BANKER_PASS </dev/tty
echo ""
[[ -z "$BANKER_PASS" ]] && die "Banker password is required."

read -rsp "$(echo -e "${CYAN}PostgreSQL password for casino user (hidden):${NC} ")" DB_PASS </dev/tty
echo ""
[[ -z "$DB_PASS" ]] && die "Database password is required."

APP_DIR="/opt/backalleybets"

echo ""
info "Installing to: $APP_DIR"
info "Server host:   $SERVER_HOST"
echo ""

# ─── 1. System packages ───────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get install -y -qq curl git nginx postgresql postgresql-contrib

# ─── 2. Node.js 20 ───────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt 20 ]]; then
  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
else
  info "Node.js $(node --version) already installed."
fi

# ─── 3. pnpm ─────────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install -g pnpm --quiet
else
  info "pnpm $(pnpm --version) already installed."
fi

# ─── 4. PM2 ──────────────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  npm install -g pm2 --quiet
else
  info "PM2 already installed."
fi

# ─── 5. PostgreSQL setup ─────────────────────────────────────────────────────
info "Configuring PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='casino_user'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER casino_user WITH PASSWORD '$DB_PASS';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='casino'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE casino OWNER casino_user;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE casino TO casino_user;" >/dev/null
success "PostgreSQL ready."

# ─── 6. Clone / update repo ──────────────────────────────────────────────────
if [[ -d "$APP_DIR/.git" ]]; then
  info "Updating existing repo..."
  git -C "$APP_DIR" pull --ff-only
else
  info "Cloning repository..."
  git clone https://github.com/rhatttv/backalleybets.git "$APP_DIR"
fi
success "Code ready at $APP_DIR"

# ─── 7. Write .env ───────────────────────────────────────────────────────────
info "Writing environment config..."
cat > "$APP_DIR/.env" <<EOF
DATABASE_URL=postgresql://casino_user:${DB_PASS}@localhost:5432/casino
BANKER_ADMIN_PASSWORD=${BANKER_PASS}
NODE_ENV=production
PORT=8080
EOF
chmod 600 "$APP_DIR/.env"
success ".env written."

# ─── 8. Install dependencies ─────────────────────────────────────────────────
info "Installing Node packages (this takes a minute)..."
cd "$APP_DIR"
pnpm install --frozen-lockfile --silent
success "Packages installed."

# ─── 9. Run database migrations ──────────────────────────────────────────────
info "Running database migrations..."
set -a; source "$APP_DIR/.env"; set +a
pnpm --filter @workspace/db run push 2>&1 | tail -5
success "Database migrated."

# ─── 10. Build apps ──────────────────────────────────────────────────────────
info "Building frontend..."
cd "$APP_DIR"
BASE_PATH=/ pnpm --filter @workspace/casino run build 2>&1 | tail -3
success "Frontend built."

info "Building API server..."
pnpm --filter @workspace/api-server run build 2>&1 | tail -3
success "API server built."

# ─── 11. PM2 ─────────────────────────────────────────────────────────────────
info "Starting app with PM2..."
cd "$APP_DIR"

# Load .env into PM2 ecosystem
cat > "$APP_DIR/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [{
    name: 'casino-api',
    script: './artifacts/api-server/dist/index.cjs',
    cwd: '${APP_DIR}',
    env: {
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: 'postgresql://casino_user:${DB_PASS}@localhost:5432/casino',
      BANKER_ADMIN_PASSWORD: '${BANKER_PASS}',
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
  }]
};
EOF

pm2 delete casino-api 2>/dev/null || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save

# Enable PM2 on boot
env PATH="$PATH:/usr/bin" pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || true
success "PM2 running."

# ─── 12. Nginx ───────────────────────────────────────────────────────────────
info "Configuring Nginx..."

# Strip www. prefix to get bare domain
BARE_HOST="${SERVER_HOST#www.}"

cat > /etc/nginx/sites-available/casino <<EOF
# Redirect www → bare domain
server {
    listen 80;
    server_name www.${BARE_HOST};
    return 301 http://${BARE_HOST}\$request_uri;
}

server {
    listen 80;
    server_name ${BARE_HOST};

    client_max_body_size 10M;

    # Proxy everything to Node.js (it serves both API and static frontend)
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # WebSocket support (live poker/lobby updates)
    location /api/ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/casino /etc/nginx/sites-enabled/casino
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx
success "Nginx configured."

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Installation complete!          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Site:    ${CYAN}http://${SERVER_HOST}${NC}"
echo -e "  Banker:  ${CYAN}http://${SERVER_HOST}/banker${NC}"
echo ""
echo -e "  Check status:  ${YELLOW}pm2 status${NC}"
echo -e "  View logs:     ${YELLOW}pm2 logs casino-api${NC}"
echo ""
echo -e "${YELLOW}TIP: To add HTTPS run:${NC}"
echo -e "  apt-get install -y certbot python3-certbot-nginx"
echo -e "  certbot --nginx -d ${BARE_HOST} -d www.${BARE_HOST}"
echo ""
