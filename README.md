# Elysia with Bun runtime

## Getting Started
To get started with this template, simply paste this command into your terminal:
```bash
bun create elysia ./elysia-example
```

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.

## Database

Create the local environment file and change the connection string to match the
root PostgreSQL service:

```bash
cp .env.example .env
```

Generate and apply Drizzle migrations:

```bash
bun run db:up
bun run db:generate
bun run db:migrate
```

`db:generate` only reads the schema. `db:migrate` connects to PostgreSQL and
therefore requires a non-empty `DATABASE_URL` in `.env`.

`bun run db:up` starts the root Compose PostgreSQL service and reads the root
`.env` file. Stop only that database service with `bun run db:down`; neither
command reads, converts, resets, or deletes legacy MySQL data.

## A1 authentication configuration

Authentication requires `AUTH_JWT_SECRET` (at least 32 characters),
`AUTH_ALLOWED_ORIGINS` (comma-separated exact origins), and `NODE_ENV`. The
session TTL defaults to eight hours, lockout defaults to five consecutive
failures for 15 minutes, and all values can be overridden with the variables in
`.env.example`.

Run the idempotent fixed-role bootstrap during deployment, then provision the
first Owner through the controlled deployment setup. Ordinary HR administration
cannot grant Owner. The application composer registers the request-ID plugin,
auth plugin, feature routes, and shared error boundary; feature packages do not
edit `src/app.ts` themselves.

Sessions are stateless JWT cookies. Logout removes the browser cookie but cannot
revoke an already copied token. Password reset has the same limitation; disable
the account when immediate invalidation is required. Protected requests reload
account status and active grants, so disablement and role revocation take effect
on the next request.
