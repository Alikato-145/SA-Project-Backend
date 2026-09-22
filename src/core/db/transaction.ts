import { db } from "./client";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TransactionExecutor = {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
};

export const withTransaction = <T>(
  work: (tx: Transaction) => Promise<T>,
  executor: TransactionExecutor = db,
) => executor.transaction(work);
