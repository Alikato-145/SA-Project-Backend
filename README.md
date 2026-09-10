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

Create the local environment file and change the connection string to match your
MySQL instance:

```bash
cp .env.example .env
```

Generate and apply Drizzle migrations:

```bash
bun run db:up
bun run db:generate
bun run db:migrate
```

`db:generate` only reads the schema. `db:migrate` connects to MySQL and
therefore requires a non-empty `DATABASE_URL` in `.env`.

The backend-local `docker-compose.yaml` starts MySQL 8.4 on port `3306` with
the development credentials in `.env.example`. Data is kept in the named
`mysql_data` Docker volume. Stop the Compose stack with `bun run db:down`.
