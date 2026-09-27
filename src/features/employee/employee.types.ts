import { allowAuditFields } from "../../core/audit/audit-redaction";

/** These fields are safe to persist in an employee action audit fact. */
export const EMPLOYEE_AUDIT_FIELDS = [
  "id",
  "employee_code",
  "status",
  "hire_date",
  "terminated_at",
] as const;

export const ASSIGNMENT_AUDIT_FIELDS = [
  "id",
  "employee_id",
  "branch_id",
  "department_id",
  "position_id",
  "employment_type",
  "base_salary",
  "welfare_amount",
  "effective_from",
  "effective_to",
] as const;

export const WEEKLY_HOLIDAY_AUDIT_FIELDS = [
  "id",
  "employee_id",
  "weekday",
  "effective_from",
  "effective_to",
] as const;

export const employeeAuditSnapshot = (source: Record<string, unknown>) =>
  allowAuditFields(source, EMPLOYEE_AUDIT_FIELDS);

export const assignmentAuditSnapshot = (source: Record<string, unknown>) =>
  allowAuditFields(source, ASSIGNMENT_AUDIT_FIELDS);

export const weeklyHolidayAuditSnapshot = (source: Record<string, unknown>) =>
  allowAuditFields(source, WEEKLY_HOLIDAY_AUDIT_FIELDS);
