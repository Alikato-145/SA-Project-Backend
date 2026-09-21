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
