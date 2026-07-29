# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS development-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NODE_ENV=production
ENV SKIP_SYSTEM_SETTINGS_DB_DURING_BUILD=true
COPY --from=development-dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV LOCAL_STORAGE_ROOT=/app/.local-storage
ENV DB_BACKUP_DIR=/app/.backups

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates default-mysql-client \
	&& rm -rf /var/lib/apt/lists/* \
	&& groupadd --system --gid 1001 nodejs \
	&& useradd --system --uid 1001 --gid nodejs nextjs \
	&& mkdir -p /app/.local-storage /app/.backups /app/.generated/bullhorn-exports \
	&& chown -R nextjs:nodejs /app

COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/docs ./docs
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs ./next.config.mjs
COPY --chown=nextjs:nodejs --chmod=755 docker/entrypoint.sh /usr/local/bin/hire-gnome-entrypoint

USER nextjs
EXPOSE 3000

ENTRYPOINT ["hire-gnome-entrypoint"]
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0"]
