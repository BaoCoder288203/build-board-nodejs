# BuildBoard API (Express + Prisma)

## Requirements

- Node.js **20.19.4** (`nvm use 20.19.4`)
- Docker (optional local Postgres / Redis / Mailpit)
- npm

## Setup

```bash
nvm use 20.19.4
npm install
```

Environment variables live in `.env` (already configured for Phase 0).

### Local Docker (optional)

```bash
docker compose up -d
```

Then point `DATABASE_URL` / `REDIS_URL` at localhost if you prefer local infra over Neon / Upstash.

Local email uses **Mailpit** (`SMTP_HOST=localhost`, port `1025`). Open the inbox at http://localhost:8025.

## Scripts

```bash
npm run dev              # API on http://localhost:4000
npm run lint             # typecheck
npm run prisma:generate
npm run prisma:push      # sync schema (dev)
npm run prisma:migrate   # create migrations
npm run prisma:seed      # seed demo data
```

## Seed login (Phase 1)

```text
email:    admin@buildboard.local
password: Password123!
```

## Health

```bash
curl http://localhost:4000/api/v1/health
```

> macOS thường chiếm port `5000` (AirPlay) — API mặc định dùng **4000**.
