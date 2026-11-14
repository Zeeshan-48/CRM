# Bn Orbit - VPS Production Deployment Guide

This folder contains the complete, self-contained production deployment setup for running **Bn Orbit** on an Ubuntu VPS (Ubuntu 22.04 / 24.04 LTS) with Docker, Nginx, and automated backups.

---

## 1. Directory Structure

```text
deploy/vps/
├── docker-compose.prod.yml   # Production compose stack (Postgres, Redis, API, Web, Console, Nginx)
├── nginx/
│   └── nginx.conf            # Edge Nginx reverse proxy with SSL termination & 50MB uploads
├── scripts/
│   └── backup.sh             # Automated daily pg_dump backup with 14-day auto-purge
├── .env.prod.example         # Production environment template
└── README.md                 # This deployment guide
```

---

## 2. Quickstart Deployment Steps on VPS

### Step 1: Install Docker on Ubuntu VPS
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

### Step 2: Clone Repository & Create Production `.env.prod`
```bash
git clone https://github.com/Zeeshan-48/CRM.git
cd CRM
cp deploy/vps/.env.prod.example deploy/vps/.env.prod
nano deploy/vps/.env.prod
```
*Fill in your real domain, strong database password, random 64-char secrets, and Google App Password (SMTP).*

### Step 3: Run the Stack
```bash
docker compose -f deploy/vps/docker-compose.prod.yml --env-file deploy/vps/.env.prod up -d --build
```

### Step 4: Setup SSL Certificates with Certbot
```bash
sudo apt update && sudo apt install certbot -y
sudo certbot certonly --webroot -w /var/lib/docker/volumes/bn-orbit-prod_certbot_www/_data -d crm.yourdomain.com -d console.yourdomain.com
```

### Step 5: Enable Automated Daily Database Backups
```bash
chmod +x deploy/vps/scripts/backup.sh
# Add to cron:
(crontab -l 2>/dev/null; echo "0 3 * * * $(pwd)/deploy/vps/scripts/backup.sh >> /var/log/bn-orbit-backup.log 2>&1") | crontab -
```

