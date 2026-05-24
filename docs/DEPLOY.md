# SphereHealth HIS — Production Deployment Guide

> R7bx-1. End-to-end runbook for taking the HIS from a fresh Ubuntu
> 22.04 LTS box (or RHEL 9 equivalent) to a TLS-terminated, monitored,
> backed-up production deployment.

## Table of Contents

1. [Production architecture](#1-production-architecture)
2. [Host preparation](#2-host-preparation)
3. [MongoDB install + hardening](#3-mongodb-install--hardening)
4. [Node backend deployment](#4-node-backend-deployment)
5. [Frontend build + serve](#5-frontend-build--serve)
6. [nginx reverse proxy + TLS](#6-nginx-reverse-proxy--tls)
7. [Lets Encrypt certbot](#7-lets-encrypt-certbot)
8. [Systemd service (option A)](#8-systemd-service-option-a)
9. [PM2 (option B)](#9-pm2-option-b)
10. [Firewall + network policy](#10-firewall--network-policy)
11. [CORS configuration](#11-cors-configuration)
12. [MongoDB backup + restore](#12-mongodb-backup--restore)
13. [Off-site backup (rsync / S3 / NAS)](#13-off-site-backup-rsync--s3--nas)
14. [Error logging + Sentry](#14-error-logging--sentry)
15. [Load testing + expected baseline](#15-load-testing--expected-baseline)
16. [Go-live checklist](#16-go-live-checklist)

---

## 1. Production architecture

```
                   ┌───────────────────────────────────────────────┐
   internet ──443──▶│ nginx (TLS termination, HSTS, gzip, caching)  │
        :80 ───────▶│   • /            → React SPA (static)         │
                   │   • /api/*       → proxy_pass to Node :5050   │
                   └────────────────┬──────────────────────────────┘
                                    │
                                    ▼ (loopback only)
                   ┌───────────────────────────────────────────────┐
                   │ Node Express 5 — Backend/index.js :5050       │
                   │   • helmet + rate-limit + JWT auth            │
                   │   • IST-anchored crons (mongo backup, gst, …) │
                   │   • structured error logger → /var/log/sphere │
                   └────────────────┬──────────────────────────────┘
                                    │
                                    ▼ (loopback only)
                   ┌───────────────────────────────────────────────┐
                   │ MongoDB 7.x — 127.0.0.1:27017                 │
                   │   • auth required, role-scoped DB users       │
                   │   • TLS on if multi-host (single-host=local)  │
                   └───────────────────────────────────────────────┘
```

Key invariants:

- nginx is the **only** process listening on 80/443.
- Node listens on `127.0.0.1:5050` — `app.listen(PORT, "0.0.0.0", …)` in
  `index.js` is overridden by firewall (see section 10).
- Mongo binds to `127.0.0.1` only. Replica sets are out of scope for the
  single-node launch but the URI format supports it (see
  `.env.production.example`).
- All long-lived state lives in three directories: `/var/lib/mongodb`
  (data), `/var/backups/sphere` (dumps), `/var/log/spherehealth` (logs).

---

## 2. Host preparation

```bash
# fresh Ubuntu 22.04 LTS
sudo apt update && sudo apt -y upgrade
sudo apt -y install build-essential git curl ufw fail2ban

# Node 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs

# dedicated unprivileged user for the Node process
sudo adduser --system --group --home /opt/spherehealth spherehealth

# create runtime directories
sudo mkdir -p /opt/spherehealth /var/backups/sphere /var/log/spherehealth
sudo chown -R spherehealth:spherehealth /opt/spherehealth /var/backups/sphere /var/log/spherehealth
sudo chmod 0750 /opt/spherehealth /var/backups/sphere /var/log/spherehealth
```

Clone the repo into `/opt/spherehealth`:

```bash
sudo -u spherehealth git clone https://github.com/<your-org>/spherehealth.git /opt/spherehealth/app
```

---

## 3. MongoDB install + hardening

```bash
# MongoDB 7.0 — official repo (Ubuntu jammy)
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt -y install mongodb-org mongodb-database-tools
sudo systemctl enable --now mongod
```

Edit `/etc/mongod.conf` — bind to loopback only and require auth:

```yaml
net:
  port: 27017
  bindIp: 127.0.0.1            # <-- never 0.0.0.0 on a single-host deploy
security:
  authorization: enabled
```

```bash
sudo systemctl restart mongod
```

Create the dedicated DB user:

```bash
mongosh
> use admin
> db.createUser({
    user: "sphere_app",
    pwd:  passwordPrompt(),
    roles: [ { role: "readWrite", db: "spherehealth" } ]
  })
```

Update `MONGO_URI` in `/etc/spherehealth/.env` accordingly (see
[section 11](#11-cors-configuration)).

---

## 4. Node backend deployment

```bash
sudo -u spherehealth bash -lc '
  cd /opt/spherehealth/app/Backend
  npm ci --omit=dev
'

# /etc/spherehealth/.env (chmod 0600, owned by spherehealth)
sudo install -d -m 0750 -o spherehealth -g spherehealth /etc/spherehealth
sudo install -m 0600 -o spherehealth -g spherehealth \
    /opt/spherehealth/app/Backend/.env.production.example /etc/spherehealth/.env
sudo -u spherehealth ${EDITOR:-vi} /etc/spherehealth/.env
```

Fill in the real values (especially `JWT_SECRET`, `MONGO_URI` with the
DB password, and `CORS_ORIGINS`). The systemd unit in
[section 8](#8-systemd-service-option-a) reads `EnvironmentFile=` from
this exact path.

---

## 5. Frontend build + serve

The React SPA builds to a static bundle and is served straight from
nginx — Node never touches it.

```bash
cd /opt/spherehealth/app/Frontend
sudo -u spherehealth npm ci
sudo -u spherehealth VITE_API_BASE=https://app.spherehealth.example.com/api \
    npm run build
sudo install -d -o www-data -g www-data /var/www/spherehealth
sudo rsync -a --delete dist/ /var/www/spherehealth/
```

Set the `VITE_API_BASE` to the public HTTPS URL so the SPA points at
the right origin — the local-dev `http://localhost:5050` value will
not work in production.

---

## 6. nginx reverse proxy + TLS

Save the following to `/etc/nginx/sites-available/spherehealth.conf`:

```nginx
# /etc/nginx/sites-available/spherehealth.conf
# SphereHealth HIS — production proxy + TLS termination

# ── HTTP → HTTPS redirect ────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name app.spherehealth.example.com;

    # Allow the ACME http-01 challenge to land while still forcing
    # everything else onto HTTPS.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

# ── Main TLS site ────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name app.spherehealth.example.com;

    # Certbot fills these in on first run.
    ssl_certificate     /etc/letsencrypt/live/app.spherehealth.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.spherehealth.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    ssl_stapling        on;
    ssl_stapling_verify on;

    # Security headers — Node's helmet middleware adds more on the API
    # path; these blanket the SPA + every static asset too.
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "geolocation=(), camera=(), microphone=()" always;

    # Body-size cap. Node also has its own 5 MB JSON limit; we set
    # nginx generously high enough for radiology uploads but low
    # enough to stop a DoS from saturating the upstream socket.
    client_max_body_size 25M;

    # gzip the SPA bundle + JSON API responses.
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # ── API: proxy to Node on loopback ────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:5050;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";
        # SSE / long-poll: increase timeouts and disable buffering on
        # the audit-stream / live-update prefixes.
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        # SSE responses must not be buffered.
        proxy_buffering    off;
    }

    # ── Health probe (open, no auth — used by load-balancer / uptime) ─
    location = /health {
        proxy_pass         http://127.0.0.1:5050/health;
        access_log         off;
    }

    # ── Static SPA ────────────────────────────────────────────────────
    root /var/www/spherehealth;
    index index.html;

    # Cache the hashed Vite bundles aggressively. index.html is NEVER
    # cached so a deploy ships immediately.
    location ~* \.(?:js|css|woff2?|svg|png|jpg|jpeg|gif|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location = /index.html {
        add_header Cache-Control "no-store" always;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable + reload:

```bash
sudo ln -s /etc/nginx/sites-available/spherehealth.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. Let's Encrypt certbot

```bash
sudo apt -y install certbot python3-certbot-nginx
sudo install -d -o www-data -g www-data /var/www/certbot

sudo certbot certonly --webroot \
    -w /var/www/certbot \
    -d app.spherehealth.example.com \
    --email ops@spherehealth.example.com \
    --agree-tos --non-interactive
```

certbot drops a systemd timer (`certbot.timer`) that handles the
twice-daily renewal automatically. Verify with:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

After the first successful issue, reload nginx so it picks up the
fullchain:

```bash
sudo systemctl reload nginx
```

---

## 8. Systemd service (option A)

Save the following to `/etc/systemd/system/spherehealth.service`:

```ini
[Unit]
Description=SphereHealth HIS — Node backend
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
User=spherehealth
Group=spherehealth
WorkingDirectory=/opt/spherehealth/app/Backend
EnvironmentFile=/etc/spherehealth/.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20

# Logging — journald captures stdout/stderr; the structured error
# middleware also writes to /var/log/spherehealth/errors-YYYY-MM-DD.log
StandardOutput=journal
StandardError=journal
SyslogIdentifier=spherehealth

# Hardening
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/log/spherehealth /var/backups/sphere
ProtectHome=yes
PrivateTmp=yes
LockPersonality=yes
RestrictRealtime=yes
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spherehealth
sudo journalctl -u spherehealth -n 50 -f
```

---

## 9. PM2 (option B)

If the operator prefers PM2 over systemd:

```bash
sudo npm install -g pm2
sudo -u spherehealth pm2 startup systemd -u spherehealth --hp /opt/spherehealth
# (paste the command pm2 prints — it generates a systemd unit)

sudo -u spherehealth bash -lc '
  cd /opt/spherehealth/app/Backend
  pm2 start index.js \
      --name sphere-api \
      --time \
      --max-memory-restart 1024M \
      --kill-timeout 20000 \
      --env production
  pm2 save
'
```

`pm2 logs sphere-api` tails stdout/stderr. The structured error log
still lands in `/var/log/spherehealth/` (or wherever `LOG_DIR` points).

---

## 10. Firewall + network policy

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp           # SSH (consider restricting by source)
sudo ufw allow 80/tcp           # ACME http-01 + redirect
sudo ufw allow 443/tcp          # HTTPS
sudo ufw enable
sudo ufw status verbose
```

Important — MongoDB MUST NOT be exposed to the internet. Confirm:

```bash
sudo ss -lntp | grep 27017
# Expected: 127.0.0.1:27017 only (NOT 0.0.0.0:27017 nor :::27017)
```

Same check for Node — though nginx fronts it, the port should still
be loopback-only for defense in depth:

```bash
sudo ss -lntp | grep 5050
# If you see 0.0.0.0:5050 you can either:
#   a) tighten ufw to block 5050 from public NICs, or
#   b) set the listen address in index.js
# Most deployments rely on (a) via ufw default-deny.
```

---

## 11. CORS configuration

Production `CORS_ORIGINS` lives in `/etc/spherehealth/.env`. The
allowlist must include every external-reachable frontend host.
Wildcards are NOT supported by the Express `cors` middleware
configured in `index.js`.

Example for a single-tenant deploy:

```
CORS_ORIGINS=https://app.spherehealth.example.com
```

Multi-tenant / multi-portal:

```
CORS_ORIGINS=https://app.spherehealth.example.com,https://admin.spherehealth.example.com
```

After every change, restart the service:

```bash
sudo systemctl restart spherehealth
```

---

## 12. MongoDB backup + restore

### Nightly backup (automatic)

`Backend/index.js` arms a `scheduleDaily("nightly-mongo-backup", 2, 30, …)`
cron at boot. Every night at 02:30 IST the Node process spawns
`mongodump` via `Backend/scripts/backupMongoDB.js`, writes a gzipped
archive to `MONGO_BACKUP_PATH` (default `/var/backups/sphere`) using
naming `sphere_YYYYMMDD_HHmm.gz`, and prunes archives older than
`MONGO_BACKUP_RETAIN_DAYS` (default 30 days).

The Mongo distributed lock (`cron:nightly-mongo-backup`) ensures that
multi-replica deployments only run one dump per cluster per night.

### Manual backup

```bash
sudo -u spherehealth bash -lc '
  cd /opt/spherehealth/app/Backend
  node scripts/backupMongoDB.js
'
```

Sample output:

```
[backup-mongo] 2026-05-24T02:30:00.001Z starting -> /var/backups/sphere/sphere_20260524_0230.gz
2026-05-24T02:30:00.123+0530 writing admin.system.version to archive '/var/backups/sphere/...'
…
2026-05-24T02:30:14.998+0530 done dumping spherehealth.patientbills (1234 documents)
[backup-mongo] OK size=82345112B pruned=0 elapsed=14997ms
[backup-mongo] done {"archive":"/var/backups/sphere/sphere_20260524_0230.gz","sizeBytes":82345112,"prunedCount":0,"durationMs":14997}
```

### Restore

```bash
# Merge-restore (default — no collections dropped)
sudo -u spherehealth bash -lc '
  cd /opt/spherehealth/app/Backend
  node scripts/restoreMongoDB.js \
      --file=/var/backups/sphere/sphere_20260524_0230.gz \
      --confirm
'

# COLD recovery (drops every existing collection first — make sure
# you took a fresh dump before running this!)
sudo -u spherehealth bash -lc '
  cd /opt/spherehealth/app/Backend
  node scripts/restoreMongoDB.js \
      --file=/var/backups/sphere/sphere_20260524_0230.gz \
      --confirm \
      --drop
'
```

The script REFUSES to proceed without both `--file=` and `--confirm`.

---

## 13. Off-site backup (rsync / S3 / NAS)

The on-host archive is not enough — a hardware failure or
ransomware event can take both the live DB and the dumps. Layer a
nightly off-site copy AFTER the in-process backup completes.

### Option A — rsync to a NAS / remote server

Add to `/etc/cron.daily/sphere-offsite-rsync` (chmod 0755):

```bash
#!/usr/bin/env bash
set -euo pipefail
LATEST=$(ls -1t /var/backups/sphere/sphere_*.gz | head -n 1)
[ -n "$LATEST" ] || { echo "no backups to ship"; exit 1; }
rsync -avz --delete-after \
    "$LATEST" \
    backup-user@nas.example.local:/srv/sphere-offsite/
```

Use an SSH key (no password) and restrict the key on the NAS side
to `rrsync /srv/sphere-offsite` via `~/.ssh/authorized_keys` command=.

### Option B — S3 / S3-compatible (Backblaze B2, Wasabi, MinIO)

```bash
sudo apt -y install awscli
sudo -u spherehealth aws configure   # IAM key with PutObject only

# /etc/cron.daily/sphere-offsite-s3 (chmod 0755)
cat <<'EOF' | sudo tee /etc/cron.daily/sphere-offsite-s3
#!/usr/bin/env bash
set -euo pipefail
LATEST=$(ls -1t /var/backups/sphere/sphere_*.gz | head -n 1)
[ -n "$LATEST" ] || { echo "no backups to ship"; exit 1; }
aws s3 cp "$LATEST" "s3://sphere-backups/mongo/" --sse AES256
EOF
sudo chmod +x /etc/cron.daily/sphere-offsite-s3
```

Verify with `sudo run-parts --test /etc/cron.daily`.

### Drill cadence

Run a **restore drill** at minimum once a quarter into a staging
environment so you discover broken backups before you need them.
Document the drill outcome in the operations log.

---

## 14. Error logging + Sentry

The structured error logger is wired in `index.js` after all routes:

```js
app.use(require("./middleware/errorLogger"));
```

Every error that bubbles to the central handler is written as a
single JSON line to `${LOG_DIR}/errors-YYYY-MM-DD.log` (rotated by
date) and mirrored to stderr.

Sample line (pretty-printed for readability — actual file contains
one JSON object per line):

```json
{
  "timestamp": "2026-05-24T17:02:33.412Z",
  "errorLogId": "err_lwjxnzt_a8f3qr",
  "level": "error",
  "route": "/api/doctor-orders",
  "method": "POST",
  "statusCode": 500,
  "userId": "65f1c3e0a4b9f2a1b3c7d9e0",
  "userRole": "Doctor",
  "employeeId": "DOC-12",
  "errorName": "ValidationError",
  "errorMessage": "DoctorOrder validation failed: medication: Path `medication` is required.",
  "errorStack": "ValidationError: DoctorOrder validation failed…\n    at model.Document.invalidate…",
  "requestBody": {
    "orderType": "Medication",
    "medication": "[REDACTED]",
    "UHID": "[REDACTED]"
  },
  "requestQuery": {},
  "requestParams": {}
}
```

PHI keys (name, UHID, phone, diagnosis, address, etc.) are redacted
before serialisation. The full key list is in
`middleware/errorLogger.js#PHI_KEYS`.

### Enabling Sentry

The middleware ships with a commented-out Sentry hook. To enable:

```bash
cd /opt/spherehealth/app/Backend
sudo -u spherehealth npm install @sentry/node
```

Then edit `/etc/spherehealth/.env` and add:

```
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
SENTRY_ENVIRONMENT=production
```

Finally, uncomment the `if (process.env.SENTRY_DSN) { … }` block in
`Backend/middleware/errorLogger.js` and restart the service.

---

## 15. Load testing + expected baseline

The bundled `Backend/scripts/loadTest.js` spawns N virtual users (each
in a dedicated `worker_thread`) and hammers a weighted cocktail of the
most-touched endpoints:

| Endpoint                          | Weight |
| --------------------------------- | -----: |
| GET  /api/admissions/active       |    30% |
| GET  /api/doctor-orders?UHID=…    |    25% |
| GET  /api/patient-history/:uhid/file | 20% |
| POST /api/doctor-orders           |    13% |
| PATCH /api/doctor-orders/:id/…    |    12% |

### Setup

Drop a CSV at `Backend/scripts/loadTest.creds.csv` (the script refuses
to run without it — we deliberately do NOT ship default credentials):

```
email,password,role
dr1@sphere.local,Password1!,Doctor
dr2@sphere.local,Password1!,Doctor
nurse1@sphere.local,Password1!,Nurse
…
```

### Invocation

```bash
# Default — 50 virtual users, 30 minutes, hits local backend.
node Backend/scripts/loadTest.js

# Custom run against staging.
BASE_URL=https://staging.spherehealth.example.com \
  node Backend/scripts/loadTest.js --users=100 --duration=600
```

### Expected output (every 30s + final summary)

```
[load-test] @t=600s
endpoint                                       | calls |  err |      p50 |      p95 |      p99
GET /api/admissions/active                     |  5234 |    2 |    120ms |    380ms |    520ms
GET /api/doctor-orders                         |  4318 |    0 |    180ms |    520ms |    690ms
GET /api/patient-history/:uhid/file            |  3502 |    1 |    240ms |    640ms |    790ms
POST /api/doctor-orders                        |  2273 |    4 |    310ms |    700ms |    910ms
PATCH /api/doctor-orders/:id/status            |  2104 |    3 |    160ms |    430ms |    540ms

[load-test] DONE  totalCalls=17431 errors=10 (0.06%) p50=190ms p95=580ms p99=750ms
[load-test] archive: /opt/spherehealth/app/Backend/scripts/loadTest.1716566400000.json
```

### Baseline targets (single-node, 16 GiB RAM, Mongo local)

- **p95 latency < 800 ms** across every endpoint
- **error rate < 0.5 %**
- node RSS stable below 1 GB

Anything above those numbers warrants investigation BEFORE go-live —
check the slow query log, index hits, and consider raising
`UV_THREADPOOL_SIZE` if I/O-bound.

---

## 16. Go-live checklist

- [ ] DNS A record for `app.spherehealth.example.com` points at the
      production IP
- [ ] `certbot certonly` succeeded; `/etc/letsencrypt/live/…` exists
- [ ] nginx config syntax-clean (`sudo nginx -t`)
- [ ] `/etc/spherehealth/.env` has real `JWT_SECRET` (>= 32 chars),
      `MONGO_URI` with the DB password, `CORS_ORIGINS` with the
      public origin, `NODE_ENV=production`
- [ ] systemd unit `spherehealth.service` is `enabled` AND `active`
- [ ] `mongod` is bound to `127.0.0.1` only (`ss -lntp | grep 27017`)
- [ ] ufw allows 22/80/443 only (`ufw status verbose`)
- [ ] curl smoke test: `curl -fsS https://app.spherehealth.example.com/health`
      returns `{"status":"ok"}`
- [ ] nightly backup cron logs after 02:30 IST show
      `[cron:nightly-mongo-backup]` success
- [ ] error log path exists and is writable
      (`ls -la /var/log/spherehealth/`)
- [ ] off-site backup script (rsync or S3) installed in
      `/etc/cron.daily/`
- [ ] load test passes the baseline targets in section 15
- [ ] runbook for emergency restore is printed and pinned to the
      on-call wall
