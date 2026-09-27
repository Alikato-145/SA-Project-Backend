import { db } from "./client";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TransactionExecutor = {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
};

export const withTransaction = <T>(
  work: (tx: Transaction) => Promise<T>,
  executor: TransactionExecutor = db,
) => executor.transaction(work);
export type DatabaseClient = typeof db;
export type DatabaseTransaction = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

/** Common persistence surface accepted by repositories inside or outside a transaction. */
export type DatabaseExecutor = Pick<
  DatabaseClient,
  "select" | "insert" | "update" | "delete" | "execute" | "query"
>;

export type TransactionWork<T> = (
  executor: DatabaseTransaction,
) => Promise<T>;

export interface TransactionRunner {
  transaction<T>(work: TransactionWork<T>): Promise<T>;
}

export const withTransaction = <T>(
  work: TransactionWork<T>,
  runner: TransactionRunner = db,
): Promise<T> => runner.transaction(work);
