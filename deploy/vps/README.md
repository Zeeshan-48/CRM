# Bn Orbit - VPS Production Deployment Guide

This folder contains the complete, hardened production deployment setup for running **Bn Orbit** on an Ubuntu VPS (Ubuntu 22.04 / 24.04 LTS) with Docker, Edge Nginx (auto ACME bootstrap -> TLS 1.2/1.3), authenticated Redis, read-only API filesystem, and automated PostgreSQL + media backups.

---

## 1. Directory Structure

```text
deploy/vps/
├── docker-compose.prod.yml                 # Production compose stack
├── nginx/
│   ├── nginx.conf                          # SSL configuration reference
│   ├── render-and-run.sh                   # Chooses bootstrap vs SSL config safely
│   └── templates/
│       ├── nginx.bootstrap.conf.template   # First-boot HTTP ACME validation config
│       └── nginx.ssl.conf.template         # Full HTTPS, HSTS, security headers & rate limits
├── scripts/
│   ├── init-ssl.sh                         # First-boot stack deploy + Let's Encrypt issuance
│   ├── renew-ssl.sh                        # Auto-renew certs + zero-downtime Nginx reload
│   └── backup.sh                           # Daily Postgres dump + recordings/files backup
├── .env.prod.example                       # Production environment template
└── README.md                               # This deployment guide
```

---

## 2. Deployment Steps on VPS

### Step 1: Install Docker & Configure Firewall
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Only expose SSH, HTTP (for ACME & HTTPS redirect), and HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### Step 2: Clone Repository & Create Protected `.env.prod`
```bash
git clone https://github.com/Zeeshan-48/CRM.git
cd CRM
cp deploy/vps/.env.prod.example deploy/vps/.env.prod
chmod 600 deploy/vps/.env.prod
nano deploy/vps/.env.prod
```
Generate strong secrets before editing `.env.prod`:
```bash
openssl rand -hex 32   # Use once for JWT_SECRET
openssl rand -hex 32   # Use once for CREDENTIALS_ENCRYPTION_KEY
openssl rand -hex 24   # Use once for PG_DATABASE_PASSWORD
openssl rand -hex 24   # Use once for REDIS_PASSWORD
```

### Step 3: Point DNS & Run One-Command Deploy + SSL Bootstrap
Make sure A records for `CRM_DOMAIN` and `CONSOLE_DOMAIN` point to your VPS IP, then run:
```bash
chmod +x deploy/vps/scripts/*.sh deploy/vps/nginx/render-and-run.sh
./deploy/vps/scripts/init-ssl.sh
```
This starts all services safely (HTTP bootstrap first so `edge-nginx` never crashes waiting for missing certs), issues Let's Encrypt certificates for both domains, and automatically flips `edge-nginx` into HTTPS mode.

### Step 4: Enable Automated Backups & TLS Renewals
```bash
(crontab -l 2>/dev/null; \
  echo "0 3 * * * $(pwd)/deploy/vps/scripts/backup.sh >> /var/log/bn-orbit-backup.log 2>&1"; \
  echo "0 4,16 * * * $(pwd)/deploy/vps/scripts/renew-ssl.sh >> /var/log/bn-orbit-ssl.log 2>&1") | crontab -
```

### Step 5: Updating Later Without Stale Nginx Upstream IPs
When deploying updates (`git pull && docker compose ... up -d --build`), reload `edge-nginx` so it picks up recreated container IPs:
```bash
docker compose -f deploy/vps/docker-compose.prod.yml --env-file deploy/vps/.env.prod up -d --build
docker compose -f deploy/vps/docker-compose.prod.yml --env-file deploy/vps/.env.prod exec -T edge-nginx sh -c 'nginx -t && nginx -s reload'
```
