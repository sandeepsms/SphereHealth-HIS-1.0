# syntax=docker/dockerfile:1
#
# SphereHealth / BIMS — Backend (Express + Mongoose) image.
# Generic + fully env-driven: the SAME image serves every hospital; all
# per-tenant config (MONGO_URI, JWT_SECRET, CORS_ORIGINS, …) comes from the
# environment at run time. See deploy/DEPLOY.md.

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# ── Dependencies (cached layer) ────────────────────────────────
# Copy only the manifests first so `docker build` re-uses the npm layer
# whenever source changes but dependencies don't.
COPY package*.json ./
# Strict `npm ci` — package-lock.json is committed, so every hospital's image
# gets the exact same dependency tree (no npm-install drift / supply-chain
# surprises between builds).
RUN npm ci --omit=dev

# ── App source ─────────────────────────────────────────────────
COPY . .

# Uploads land on a mounted volume at run time (see compose). Create the dir
# + a non-root user and hand ownership over so writes work as USER app.
RUN mkdir -p uploads backups \
    && addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

EXPOSE 5050

# Hit the built-in load-balancer probe. Node 20 has global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5050)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
