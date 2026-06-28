# syntax=docker/dockerfile:1
#
# SphereHealth / BIMS — Frontend (React + Vite) image.
# The app talks to the backend at the SAME ORIGIN under /api (see
# VITE_API_BASE_URL below); nginx serves the static build AND reverse-proxies
# /api + /uploads to the backend container. Result: ONE frontend image works
# for every hospital — no per-tenant rebuild, no CORS, no code change.

# ── Build stage ────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci 2>/dev/null || npm install
COPY . .
# Relative base → axios calls /api/... → nginx proxies to the backend.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# ── Serve stage ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
