import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";

// ponytail: one global lock serializes sprint input mutations; use shop-scoped locks if throughput requires it.
export const serializePayrollInputs = async (executor: Pick<DatabaseExecutor, "execute">) => {
  await executor.execute(sql`select pg_advisory_xact_lock(72419, 5)`);
};
