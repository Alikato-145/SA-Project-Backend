// Shared PostgreSQL column helpers for feature-owned schemas.
import { bigint, timestamp } from "drizzle-orm/pg-core";

export const id = (name = "id") =>
  bigint(name, { mode: "number" }).generatedByDefaultAsIdentity().primaryKey();

export const foreignId = (name: string) =>
  bigint(name, { mode: "number" });

// Transitional aliases keep feature schemas import-compatible while they move
// from MySQL small IDs to the canonical PostgreSQL bigint IDs.
export const smallId = id;
export const foreignSmallId = foreignId;

export const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const timestamps = {
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
};

export const restrict = {
  onDelete: "restrict",
  onUpdate: "cascade",
} as const;

export const setNull = {
  onDelete: "set null",
  onUpdate: "cascade",
} as const;
