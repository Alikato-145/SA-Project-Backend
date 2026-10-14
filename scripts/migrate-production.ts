import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, db } from "../src/core/db/client";

// Apply the existing reviewed SQL and migration journal; no generation or db:push.
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.info("Reviewed database migrations are current.");
} finally {
  await closeDatabase();
}
