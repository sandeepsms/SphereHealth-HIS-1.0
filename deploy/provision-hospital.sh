#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# provision-hospital.sh — stand up a brand-new, isolated hospital deployment.
#
#   ./deploy/provision-hospital.sh <slug> <public_url> [host_port]
#   e.g. ./deploy/provision-hospital.sh apollo https://apollo.bims.example.com 8080
#
# What it does:
#   1. Generates deploy/<slug>.env with strong random JWT + Mongo secrets
#   2. Builds + starts the stack as its own compose project (-p <slug>)
#   3. Waits for the backend /api/health probe
#   4. Seeds default users + the building/bed structure
#   5. Prints the URL + next steps
#
# Re-running is safe: an existing <slug>.env is reused (secrets NOT regenerated)
# and the seeds are idempotent (find-or-create).
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SLUG="${1:-}"
PUBLIC_URL="${2:-}"
PORT="${3:-8080}"

if [[ -z "$SLUG" || -z "$PUBLIC_URL" ]]; then
  echo "Usage: $0 <slug> <public_url> [host_port]"
  echo "  e.g. $0 apollo https://apollo.bims.example.com 8080"
  exit 1
fi
if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "❌ slug must be lowercase letters/digits/hyphens (got '$SLUG')"; exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$ROOT/docker-compose.yml"
ENV_FILE="$ROOT/deploy/${SLUG}.env"

# 40-char alnum secret from the kernel CSPRNG.
gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-40}"; }

if [[ -f "$ENV_FILE" ]]; then
  echo "⚠️  $ENV_FILE already exists — reusing it (secrets NOT regenerated)."
else
  echo "🔐 Generating secrets for '$SLUG'…"
  umask 077
  cat > "$ENV_FILE" <<EOF
HOSPITAL_SLUG=$SLUG
PUBLIC_URL=$PUBLIC_URL
PUBLIC_HTTP_PORT=$PORT
HOSPITAL_TZ=Asia/Kolkata
JWT_SECRET=$(gen 48)
MONGO_USER=${SLUG}_admin
MONGO_PASSWORD=$(gen 32)
EOF
  echo "✅ Wrote $ENV_FILE (chmod 600)"
fi

echo "🐳 Building + starting the '$SLUG' stack…"
docker compose --env-file "$ENV_FILE" -p "$SLUG" -f "$COMPOSE" up -d --build

echo "⏳ Waiting for backend health…"
ok=0
for i in $(seq 1 40); do
  if docker compose -p "$SLUG" exec -T backend \
       node -e "fetch('http://127.0.0.1:5050/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=1; echo "✅ Backend healthy"; break
  fi
  sleep 3
done
[[ "$ok" -eq 1 ]] || { echo "❌ Backend did not become healthy — check: docker compose -p $SLUG logs backend"; exit 1; }

echo "🌱 Seeding default users + building/bed structure…"
docker compose -p "$SLUG" exec -T backend node scripts/seedUsers.js || echo "  (seedUsers skipped/failed — run manually if needed)"
docker compose -p "$SLUG" exec -T backend node scripts/seedBIMS.js  || echo "  (seedBIMS skipped/failed — run manually if needed)"

cat <<EOF

🎉 '$SLUG' is up!
   URL        : $PUBLIC_URL   (host port $PORT)
   Env file   : $ENV_FILE
   Project    : docker compose -p $SLUG ps

   ⚠️  Log in as the seeded admin and CHANGE THE PASSWORD immediately.
   ⚠️  Put a TLS reverse proxy (Caddy/Traefik/nginx) in front for HTTPS.
   ⚠️  Back up this hospital regularly:
        docker compose -p $SLUG exec backend node scripts/backup/runBackup.js
EOF
