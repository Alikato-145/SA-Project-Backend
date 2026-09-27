import { and, eq } from "drizzle-orm";
import { db } from "../../core/db/client";
import { debtTransactions, debtTypes } from "./debt.schema";
import type { DebtTransaction } from "./debt.dto";

export class DebtError extends Error {
  constructor(public readonly code:
    | "DEBT_INVALID_AMOUNT" | "DEBT_INVALID_ENTRY" | "DEBT_TYPE_UNAVAILABLE"
    | "DEBT_NOT_FOUND" | "DEBT_ALREADY_REVERSED" | "DEBT_ALREADY_SETTLED"
    | "OUT_OF_SCOPE") { super(code); this.name = "DebtError"; }
}
export type DebtInsert = Pick<DebtTransaction,
  "employeeId" | "debtTypeId" | "transactionKind" | "transactionDate" |
  "description" | "amount" | "originalTransactionId" | "recordedByUserAccountId">;
export type DebtSession = {
  findType(id: number): Promise<{ id: number; isActive: boolean } | undefined>;
  insert(input: DebtInsert): Promise<DebtTransaction>;
  findByIdForUpdate(id: number): Promise<DebtTransaction | undefined>;
  hasReversal(id: number): Promise<boolean>;
};
export type DebtRepository = {
  withTransaction<T>(work: (session: DebtSession) => Promise<T>): Promise<T>;
  listByEmployee(employeeId: number): Promise<DebtTransaction[]>;
};
export class DrizzleDebtRepository implements DebtRepository {
  withTransaction<T>(work: (session: DebtSession) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => work({
      async findType(id) {
        return tx.query.debtTypes.findFirst({ where: eq(debtTypes.id, id) });
      },
      async insert(input) {
        const [row] = await tx.insert(debtTransactions).values(input).returning();
        return row;
      },
      async findByIdForUpdate(id) {
        const [row] = await tx.select().from(debtTransactions)
          .where(eq(debtTransactions.id, id)).for("update");
        return row;
      },
      async hasReversal(id) {
        const [row] = await tx.select({ id: debtTransactions.id }).from(debtTransactions)
          .where(and(eq(debtTransactions.originalTransactionId, id),
            eq(debtTransactions.transactionKind, "reversal")));
        return !!row;
      },
    }));
  }
  listByEmployee(employeeId: number): Promise<DebtTransaction[]> {
    return db.query.debtTransactions.findMany({
      where: eq(debtTransactions.employeeId, employeeId),
      orderBy: [debtTransactions.transactionDate, debtTransactions.id],
    });
  }
}
