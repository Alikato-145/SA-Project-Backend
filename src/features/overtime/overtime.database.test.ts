import { expect, test } from "bun:test";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
const employeeId = Number(process.env.B2_TEST_EMPLOYEE_ID);
const accountId = Number(process.env.B2_TEST_ACCOUNT_ID);
const databaseTest = url && [employeeId, accountId].every(
  (value) => Number.isSafeInteger(value) && value > 0,
) ? test : test.skip;

databaseTest("overtime rejects duplicate dates and invalid type amounts", async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("BEGIN");
  try {
    const insert = `insert into overtime_records
      (employee_id, overtime_date, overtime_type, hours, day_units, requested_by_user_account_id)
      values ($1, '2099-12-25', $2, $3, $4, $5)`;
    await client.query(insert, [employeeId, "hourly", "2", null, accountId]);
    await client.query("SAVEPOINT duplicate_ot");
    await expect(client.query(insert, [employeeId, "rest_day", null, "1", accountId])).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT duplicate_ot");
    await client.query("SAVEPOINT invalid_ot");
    await expect(client.query(
      `insert into overtime_records
       (employee_id, overtime_date, overtime_type, hours, day_units, requested_by_user_account_id)
       values ($1, '2099-12-26', 'rest_day', '2', null, $2)`,
      [employeeId, accountId],
    )).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT invalid_ot");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
