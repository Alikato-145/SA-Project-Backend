import { sql } from "drizzle-orm";
import { bigint, smallint, timestamp } from "drizzle-orm/mysql-core";

export const id = (name = "id") =>
  bigint(name, { mode: "number", unsigned: true })
    .autoincrement()
    .primaryKey();

export const smallId = (name = "id") =>
  smallint(name, { unsigned: true }).autoincrement().primaryKey();

export const foreignId = (name: string) =>
  bigint(name, { mode: "number", unsigned: true });

export const foreignSmallId = (name: string) =>
  smallint(name, { unsigned: true });

export const instant = (name: string) =>
  timestamp(name, { mode: "date", fsp: 3 });

export const timestamps = {
  createdAt: instant("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: instant("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
};

export const restrict = {
  onDelete: "restrict",
  onUpdate: "cascade",
} as const;

export const setNull = {
  onDelete: "set null",
  onUpdate: "cascade",
} as const;
