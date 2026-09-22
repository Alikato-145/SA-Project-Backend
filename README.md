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

`bun run db:down` stops root development PostgreSQL and preserves its volume.
Legacy MySQL data is never read, converted, reset, or removed by these commands.
