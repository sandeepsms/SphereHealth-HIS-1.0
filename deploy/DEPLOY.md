# BIMS / SphereHealth — Multi-Hospital Deployment (Option A)

**Option A = one isolated deployment per hospital.** Each hospital gets its own
frontend + backend containers, its own MongoDB, and its own volumes. Strongest
isolation (one hospital's data/load can never touch another's) and **zero code
changes** — the app is already fully env-driven.

> This is the safe starting point. When manual deploys become too many to manage,
> Option B (one shared app, DB-per-hospital) is a natural next step — and because
> each hospital's data already lives in its own DB, **moving A → B is not a data
> migration**, only an app-layer consolidation.

---

## Architecture (per hospital)

```
                 https://apollo.bims.example.com
                              │
                   (your TLS reverse proxy)
                              │  :8080
        ┌─────────────────────────────────────────────┐
        │  compose project: "apollo"                   │
        │                                              │
        │   frontend (nginx)  ─/─►  React static       │
        │        │           ─/api/─►  backend:5050    │
        │        │           ─/uploads/─► backend      │
        │        ▼                                      │
        │   backend (node)  ──►  mongo:27017 / apollo  │
        │     volumes: uploads, backups                │
        │   mongo            volume: mongo-data        │
        └─────────────────────────────────────────────┘
```

- **Same-origin**: the frontend calls `/api/...`; nginx proxies it to the backend.
  One frontend image works for **every** hospital — no per-tenant rebuild, no CORS.
- **Isolation**: a separate compose project + separate named volumes per hospital.

---

## Prerequisites (on the host)

- Docker Engine + Docker Compose v2 (`docker compose version`)
- The repo checked out on the host (it builds the images locally)
- A TLS reverse proxy for production (Caddy / Traefik / nginx) — optional for a LAN/on-prem box

---

## Quickstart — provision one hospital

```bash
# from the repo root
chmod +x deploy/provision-hospital.sh         # first time only
./deploy/provision-hospital.sh apollo https://apollo.bims.example.com 8080
```

That single command generates secrets, builds + starts the stack, waits for
health, seeds the role users + building/bed structure, and prints the URL
**plus a one-time generated password** for the seeded logins
(`admin@spherehealth.com` + role accounts). The password is random per
hospital, shown once, never stored — and every account is forced to change
it at first login (`mustChangePassword`).

**Add another hospital** — just pick a new slug + a free host port:

```bash
./deploy/provision-hospital.sh city https://city.bims.example.com 8081
```

The two stacks are completely independent (separate containers, DBs, volumes).

---

## Managing a hospital

All commands take `-p <slug>` (the compose project name):

```bash
docker compose -p apollo ps                       # status
docker compose -p apollo logs -f backend          # tail backend logs
docker compose -p apollo exec backend node scripts/backup/runBackup.js   # backup DB
docker compose -p apollo down                      # stop (keeps volumes/data)
docker compose -p apollo down -v                   # stop + DELETE data (careful!)
```

**Update an existing hospital to a new code version:**

```bash
git pull
docker compose --env-file deploy/apollo.env -p apollo up -d --build
```

> Note: with Option A this rebuild/redeploy is **per hospital** — that linear ops
> cost is the trade-off vs Option B. See the main scalability discussion.

---

## Production checklist

- [ ] **TLS**: terminate HTTPS in a reverse proxy in front of `PUBLIC_HTTP_PORT`
      — without it, logins (JWTs) and patient data cross the network in
      plaintext. Have the proxy add `Strict-Transport-Security` (HSTS).
      When the proxy runs on the same host, set `BIND_ADDR=127.0.0.1` so the
      plain-HTTP port never leaves the box.
- [ ] **Note the one-time seeded password** printed by the provisioner and log
      in once as admin — first login forces a rotation for every account.
- [ ] **Secrets**: `deploy/<slug>.env` is git-ignored and `chmod 600`. Back it up
      somewhere safe — losing `JWT_SECRET`/Mongo creds means re-issuing logins.
- [ ] **Backups**: schedule `scripts/backup/runBackup.js` (cron on the host) and
      copy the `backend-backups` volume off-box.
- [ ] **Uploads** (PHI) live on the `backend-uploads` volume — include it in backups.
- [ ] **External MongoDB (optional)**: to use Atlas / a managed DB instead of the
      bundled `mongo` service, delete the `mongo` service + `depends_on` in
      `docker-compose.yml` and set `MONGO_URI` directly in the hospital's `.env`.
- [ ] **Monitoring**: forward container logs to your log stack; add error tracking
      (see the P1 "observability" item in the scalability plan).
- [ ] **Resources**: set per-service CPU/memory limits if co-hosting many hospitals
      on one box.

---

## Files

| File | Purpose |
|------|---------|
| `Backend/Dockerfile` | Generic env-driven backend image (non-root, healthcheck) |
| `Frontend/Dockerfile` | Vite build → nginx serve (same-origin `/api`) |
| `Frontend/nginx.conf` | SPA fallback + reverse-proxy `/api` + `/uploads` → backend |
| `docker-compose.yml` | Per-hospital stack template (frontend + backend + mongo) |
| `deploy/.env.example` | Template for a hospital's config + secrets |
| `deploy/provision-hospital.sh` | One-command provisioning of a new hospital |

---

## Notes / TODO (future hardening)

- Parameterize the building/bed seed (currently `seedBIMS.js` is BIMS-specific) so
  each hospital seeds its own structure — or let admins build it in-app.
- Optional: runtime API-URL injection so even the same-origin assumption is
  configurable without a rebuild (not needed with the nginx proxy approach).
