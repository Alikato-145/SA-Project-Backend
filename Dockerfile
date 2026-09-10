FROM oven/bun:1.3.11-alpine AS dependencies
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.11-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json bun.lock drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src

EXPOSE 3000

CMD ["sh", "-c", "bunx drizzle-kit migrate && exec bun run src/index.ts"]
