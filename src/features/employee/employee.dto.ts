import { ApplicationError } from "../../core/errors/application.error";
import { parseEmployeeId } from "./employee.validation";

export type EmployeeStatus = "active" | "inactive" | "suspended" | "terminated";
export interface EmployeeListQueryDto {
  page?: string;
  page_size?: string;
  search?: string;
  status?: string;
  branch_id?: string;
  department_id?: string;
}

export interface EmployeeListFilters {
  page: number;
  pageSize: number;
  search: string | null;
  status: EmployeeStatus | null;
  branchId: string | null;
  departmentId: string | null;
}

export interface EmployeeTeamDto {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  branch_id: string | null;
  department_id: string | null;
  position_id: string | null;
  status: EmployeeStatus;
}

export interface EmployeeOwnDto extends EmployeeTeamDto {
  phone: string | null;
  personal_email: string | null;
  address: string | null;
  hire_date: string;
  terminated_at: string | null;
}

export interface EmployeeHrDto extends EmployeeOwnDto {
  national_id_masked: string | null;
  passport_id_masked: string | null;
}

export type EmployeeResponseDto = EmployeeTeamDto | EmployeeOwnDto | EmployeeHrDto;

const invalid = (field: string): never => {
  throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: ["Invalid value."] } });
};
const positiveInteger = (value: string | undefined, field: string, fallback: number, max: number): number => {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return invalid(field);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) return invalid(field);
  return parsed;
};

export const parseEmployeeListFilters = (query: EmployeeListQueryDto): EmployeeListFilters => {
  const status = query.status === undefined ? null : query.status;
  if (status !== null && !["active", "inactive", "suspended", "terminated"].includes(status)) invalid("status");
  const search = query.search?.trim() ?? "";
  if (search.length > 150) invalid("search");
  return {
    page: positiveInteger(query.page, "page", 1, Number.MAX_SAFE_INTEGER),
    pageSize: positiveInteger(query.page_size, "page_size", 20, 100),
    search: search || null,
    status: status as EmployeeStatus | null,
    branchId: query.branch_id === undefined ? null : String(parseEmployeeId(query.branch_id, "branch_id")),
    departmentId: query.department_id === undefined ? null : String(parseEmployeeId(query.department_id, "department_id")),
  };
};
