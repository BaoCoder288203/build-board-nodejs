# syntax=docker/dockerfile:1

FROM node:20.19.4-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20.19.4-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build \
  && npm prune --omit=dev \
  && npm install prisma@6.19.3 --omit=dev --no-save

FROM node:20.19.4-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 buildboard \
  && useradd --system --uid 1001 --gid buildboard buildboard \
  && mkdir -p /app/uploads \
  && chown -R buildboard:buildboard /app

COPY --from=builder --chown=buildboard:buildboard /app/node_modules ./node_modules
COPY --from=builder --chown=buildboard:buildboard /app/dist ./dist
COPY --from=builder --chown=buildboard:buildboard /app/prisma ./prisma
COPY --from=builder --chown=buildboard:buildboard /app/package.json ./package.json
COPY --chown=buildboard:buildboard docker/entrypoint.sh ./docker/entrypoint.sh

RUN chmod +x ./docker/entrypoint.sh

USER buildboard
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-5000}${API_PREFIX:-/api/v1}/health" || exit 1

ENTRYPOINT ["./docker/entrypoint.sh"]
