import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";

// Reserve the same identity value for the legacy code column. Existing codes
// remain unchanged; skip numeric codes already assigned to older records.
export async function nextOrganizationId(
  executor: DatabaseExecutor,
  table: "shops" | "branches" | "departments" | "positions" | "employees",
): Promise<number> {
  const relation = sql.raw(`"${table}"`);
  for (;;) {
    const result = await executor.execute(sql`
      select nextval(pg_get_serial_sequence(${table}, 'id'))::text as id
    `);
    const id = Number(result.rows[0]?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new RangeError("Invalid organization identity");
    const column = sql.raw(table === "employees" ? "employee_code" : "code");
    const existing = await executor.execute(sql`
      select 1 from ${relation} where ${column} = ${String(id)} limit 1
    `);
    if (existing.rows.length === 0) return id;
  }
}
