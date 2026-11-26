# Bn Orbit - VPS Production Deployment Guide

This folder runs **Bn Orbit** on an Ubuntu VPS (Ubuntu 22.04 / 24.04 LTS) with Docker, Edge Nginx on loopback port **`7008`**, authenticated Redis, read-only API container filesystem, and daily Postgres + media backups.

---

## 1. Directory Structure

```text
deploy/vps/
├── docker-compose.prod.yml                 # Production compose stack (127.0.0.1:7008 -> Edge Nginx)
├── nginx/
│   ├── nginx.conf                          # Reference SSL config
│   ├── host-reverse-proxy.conf.example     # Host Nginx site forwarding HTTPS -> 127.0.0.1:7008
│   ├── render-and-run.sh                   # Renders proxy vs SSL Nginx config at startup
│   └── templates/
│       ├── nginx.proxy.conf.template       # Default host-proxy mode (127.0.0.1:7008)
│       ├── nginx.bootstrap.conf.template   # First-boot HTTP ACME validation config (ssl mode)
│       └── nginx.ssl.conf.template         # Direct HTTPS config (if Docker owns 80/443)
├── scripts/
│   ├── init-ssl.sh                         # Optional standalone SSL bootstrap (if EDGE_MODE=ssl)
│   ├── renew-ssl.sh                        # Certbot container renewal + reload (if EDGE_MODE=ssl)
│   └── backup.sh                           # Daily Postgres dump + recordings/files backup
├── .env.prod.example                       # Production environment template
└── README.md                               # This deployment guide
```

---

## 2. Deployment Behind Host Nginx / Reverse Proxy (Port `7008`)

### Step 1: Clone & Protect `.env.prod`
```bash
git clone https://github.com/Zeeshan-48/CRM.git
cd CRM
cp deploy/vps/.env.prod.example deploy/vps/.env.prod
chmod 600 deploy/vps/.env.prod
nano deploy/vps/.env.prod
```
Generate strong secrets before editing `.env.prod`:
```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # CREDENTIALS_ENCRYPTION_KEY
openssl rand -hex 24   # PG_DATABASE_PASSWORD
openssl rand -hex 24   # REDIS_PASSWORD
```

### Step 2: Start Docker Stack (`127.0.0.1:7008`)
```bash
chmod +x deploy/vps/scripts/*.sh deploy/vps/nginx/render-and-run.sh
docker compose -f deploy/vps/docker-compose.prod.yml --env-file deploy/vps/.env.prod up -d --build
```
Port `7008` is bound strictly to `127.0.0.1` so direct external plain-HTTP hits are blocked by design.

### Step 3: Host Nginx HTTPS Proxy (`80/443` -> `127.0.0.1:7008`)
Use [host-reverse-proxy.conf.example](nginx/host-reverse-proxy.conf.example) for your real domains and run `certbot --nginx` on the host so both your CRM domain and Console domain terminate TLS over HTTPS cleanly.

### Step 4: Enable Daily Backups
```bash
(crontab -l 2>/dev/null; echo "0 3 * * * $(pwd)/deploy/vps/scripts/backup.sh >> /var/log/bn-orbit-backup.log 2>&1") | crontab -
```

### Updating Later
```bash
git pull origin main
docker compose -f deploy/vps/docker-compose.prod.yml --env-file deploy/vps/.env.prod up -d --build
docker compose -f deploy/vps/docker-compose.prod.yml --env-file deploy/vps/.env.prod exec -T edge-nginx sh -c 'nginx -t && nginx -s reload'
```
