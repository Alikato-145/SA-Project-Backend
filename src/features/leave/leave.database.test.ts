import { expect, test } from "bun:test";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
const employeeId = Number(process.env.B2_TEST_EMPLOYEE_ID);
const accountId = Number(process.env.B2_TEST_ACCOUNT_ID);
const typeId = Number(process.env.B2_TEST_LEAVE_TYPE_ID);
const databaseTest = url && [employeeId, accountId, typeId].every(
  (value) => Number.isSafeInteger(value) && value > 0,
) ? test : test.skip;

databaseTest("approved leave overlap and append-only history are enforced", async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("BEGIN");
  try {
    const insert = `insert into leave_requests
      (employee_id, original_leave_type_id, start_date, end_date, requested_days,
       submitted_by_user_account_id, status)
      values ($1, $2, $3, $4, '1', $5, 'approved') returning id`;
    const first = await client.query<{ id: string }>(insert, [
      employeeId, typeId, "2099-12-25", "2099-12-25", accountId,
    ]);
    const requestId = first.rows[0]!.id;
    await client.query("SAVEPOINT overlapping_leave");
    await expect(client.query(insert, [
      employeeId, typeId, "2099-12-25", "2099-12-26", accountId,
    ])).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT overlapping_leave");
    const action = await client.query<{ id: string }>(
      `insert into leave_approval_actions
       (leave_request_id, actor_user_account_id, action)
       values ($1, $2, 'approved') returning id`,
      [requestId, accountId],
    );
    await client.query("SAVEPOINT rewritten_action");
    await expect(client.query(
      "update leave_approval_actions set action = 'rejected' where id = $1",
      [action.rows[0]!.id],
    )).rejects.toThrow();
    await client.query("ROLLBACK TO SAVEPOINT rewritten_action");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
