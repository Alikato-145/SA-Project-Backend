FROM oven/bun:1.3.11-alpine AS dependencies
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.11-alpine AS runtime
RUN apk upgrade --no-cache
WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json bun.lock drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /var/lib/haris/documents && chown -R bun:bun /var/lib/haris
USER bun

EXPOSE 3000

CMD ["sh", "-c", "bun run db:migrate:production && exec bun run src/index.ts"]
