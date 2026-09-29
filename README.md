# Haris Payroll backend

Bun, Elysia, Drizzle, and PostgreSQL 16. Start with the root repository's
`docs/sprint-readiness.md` and `docs/two-week-three-person-plan.md`.

Run commands from this package:

```bash
bun install --frozen-lockfile
test -f .env || cp .env.example .env
bun run db:up
bun run db:migrate
bun run dev
```

Match `DATABASE_URL` in `.env` to root Compose credentials and the host database
port. Container development starts from the root with `docker compose up --build
-d --wait`; containers apply migrations before starting the API.

```bash
bun run typecheck
bun test
# Disposable migrated database only; adjust the port to your test stack.
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/haris_payroll bun test
```

Without `TEST_DATABASE_URL`, live database tests are skipped. Test fixtures roll
back, but identity sequences can advance. Never point tests at production.

`src/app.ts` composes Elysia and can be tested without opening a listening socket.
`src/index.ts` starts the process. Features follow
route → controller → service → repository → database; controllers invoke mappers.

The sprint schema is frozen. `bun run db:generate` checks for drift; coordinate
schema/migration changes with Person C. Do not use `db:push` to bypass migration
review. The canonical migration directory is `drizzle/`.

`bun run db:up` starts the root Compose PostgreSQL service and reads the root
`.env` file. `bun run db:down` stops that development database and preserves its
volume; neither command reads, converts, resets, or deletes legacy MySQL data.

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
