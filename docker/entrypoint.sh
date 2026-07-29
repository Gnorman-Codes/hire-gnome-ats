#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
	echo "[container] DATABASE_URL is required." >&2
	exit 1
fi

if [ -z "${AUTH_SESSION_SECRET:-}" ]; then
	echo "[container] AUTH_SESSION_SECRET is required." >&2
	exit 1
fi

if [ -z "${AUTH_APP_BASE_URL:-}" ]; then
	echo "[container] AUTH_APP_BASE_URL is required." >&2
	exit 1
fi

max_attempts="${DATABASE_STARTUP_MAX_ATTEMPTS:-30}"
attempt=1

while ! node -e 'const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient(); prisma.$queryRawUnsafe("SELECT 1").then(() => prisma.$disconnect()).catch(async () => { await prisma.$disconnect().catch(() => {}); process.exit(1); });' >/dev/null 2>&1; do
	if [ "$attempt" -ge "$max_attempts" ]; then
		echo "[container] Database was not ready after ${max_attempts} attempts." >&2
		exit 1
	fi
	echo "[container] Waiting for the database (${attempt}/${max_attempts})..."
	attempt=$((attempt + 1))
	sleep 2
done

echo "[container] Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

echo "[container] Initializing hosted tenant..."
node scripts/provision-default-admin.js

echo "[container] Starting Hire Gnome ATS..."
exec "$@"
