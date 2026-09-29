#!/bin/sh
set -eu

if [ "${PERSON_A_DISPOSABLE_DB:-}" != "1" ]; then
  echo "Set PERSON_A_DISPOSABLE_DB=1 only for an isolated disposable test database." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ] || [ -z "${TEST_DATABASE_URL:-}" ] || [ "$DATABASE_URL" != "$TEST_DATABASE_URL" ]; then
  echo "DATABASE_URL and TEST_DATABASE_URL must both point to the same isolated test database." >&2
  exit 1
fi

export A2_DATABASE_INTEGRATION=1
export DATABASE_INTEGRATION=1

# Each file gets a new process. Their afterAll hooks close the shared module-level
# pool, so a single Bun process would make later DB suites fail spuriously.
for test_file in \
  src/features/audit/audit.integration.test.ts \
  src/features/branch/branch.write.test.ts \
  src/features/department/department.repository.integration.test.ts \
  src/features/department/department.write.test.ts \
  src/features/position/position.read.test.ts \
  src/features/position/position.write.test.ts \
  src/features/shop/shop.write.integration.test.ts \
  src/features/organization/organization.history.test.ts \
  src/test/a5-identity-hr-journey.test.ts
do
  bun test "$test_file"
done
