import { expect, test } from "bun:test";
import { parseEmployeeCreate } from "./employee.dto";

test("accepts a new employee without requiring a manually entered code", () => {
  expect(parseEmployeeCreate({ first_name: "Test", last_name: "Employee", passport_id: "P123", hire_date: "2026-10-01" })).toMatchObject({ firstName: "Test", lastName: "Employee" });
});

const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
databaseTest("generates unique employee codes equal to IDs while preserving existing numeric codes", async () => {
  const { db, closeDatabase } = await import("../../core/db/client");
  const { sql } = await import("drizzle-orm");
  const { employeeRepository } = await import("./employee.repository");
  const suffix = String(Date.now());
  const base = { nationalId: null, passportId: `P${suffix}`, firstName: "Test", lastName: "Employee", phone: null, personalEmail: null, address: null, hireDate: "2026-10-01" };
  try {
    const sequence = await db.execute(sql`select nextval(pg_get_serial_sequence('employees', 'id'))::text as id`);
    const legacyCode = String(Number(sequence.rows[0]?.id) + 2);
    const legacy = await employeeRepository.insert(db, { ...base, employeeCode: legacyCode });
    const created = await employeeRepository.insert(db, { ...base, passportId: `Q${suffix}` });
    expect(legacy.employeeCode).toBe(legacyCode);
    expect(created.employeeCode).toBe(created.id);
    expect(Number(created.id)).toBeGreaterThan(Number(legacyCode));
    const pair = await Promise.all([employeeRepository.insert(db, { ...base, passportId: `R${suffix}` }), employeeRepository.insert(db, { ...base, passportId: `S${suffix}` })]);
    expect(pair.map(row => row.employeeCode)).toEqual(pair.map(row => row.id));
    expect(pair[0]!.id).not.toBe(pair[1]!.id);
  } finally { await closeDatabase(); }
});
