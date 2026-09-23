import type { EmployeeHrDto, EmployeeOwnDto, EmployeeResponseDto, EmployeeTeamDto } from "./employee.dto";
import type { EmployeeReadRecord } from "./employee.repository";
import type { VisibleEmployee } from "./employee.service";

const mask = (value: string | null): string | null =>
  value === null ? null : value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
export const toEmployeeTeamDto = (record: EmployeeReadRecord): EmployeeTeamDto => ({
  id: record.id,
  employee_code: record.employeeCode,
  first_name: record.firstName,
  last_name: record.lastName,
  branch_id: record.currentAssignment?.branchId ?? null,
  department_id: record.currentAssignment?.departmentId ?? null,
  position_id: record.currentAssignment?.positionId ?? null,
  status: record.status,
});
export const toEmployeeOwnDto = (record: EmployeeReadRecord): EmployeeOwnDto => ({
  ...toEmployeeTeamDto(record),
  phone: record.phone,
  personal_email: record.personalEmail,
  address: record.address,
  hire_date: record.hireDate,
  terminated_at: record.terminatedAt,
});
export const toEmployeeHrDto = (record: EmployeeReadRecord): EmployeeHrDto => ({
  ...toEmployeeOwnDto(record),
  national_id_masked: mask(record.nationalId),
  passport_id_masked: mask(record.passportId),
});
export const toEmployeeResponseDto = ({ record, view }: VisibleEmployee): EmployeeResponseDto =>
  view === "hr" ? toEmployeeHrDto(record) : view === "own" ? toEmployeeOwnDto(record) : toEmployeeTeamDto(record);
