import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./client";
import type { DatabaseTransaction } from "./transaction";

const context = new AsyncLocalStorage<DatabaseTransaction>();
export const operationExecutor = () => context.getStore() ?? db;
export const operationTransaction = <T>(work: (executor: DatabaseTransaction) => Promise<T>): Promise<T> => {
  const active = context.getStore();
  return active ? work(active) : db.transaction((executor) => context.run(executor, () => work(executor)));
};
