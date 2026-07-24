#!/bin/sh
set -eu

echo "[api] Running prisma migrate deploy..."
npx prisma migrate deploy

echo "[api] Starting BuildBoard API..."
exec node dist/server.js
