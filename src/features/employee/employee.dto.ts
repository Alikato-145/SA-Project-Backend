import { ApplicationError } from "../../core/errors/application.error";
import { parseBusinessDate, parseEmployeeId } from "./employee.validation";
import { parseAssignmentBody, type AssignmentBodyDto } from "../employment-assignment/employment-assignment.dto";
import { parseBankCreate, type BankCreateBody } from "../employee-bank-account/employee-bank-account.dto";
import { parseHolidayCreate } from "../employee-weekly-holiday/employee-weekly-holiday.dto";

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

export interface EmployeeCreateBodyDto { employee_code: unknown; national_id?: unknown; passport_id?: unknown; first_name: unknown; last_name: unknown; phone?: unknown; personal_email?: unknown; address?: unknown; hire_date: unknown }
export interface EmployeeUpdateBodyDto { national_id?: unknown; passport_id?: unknown; first_name?: unknown; last_name?: unknown; phone?: unknown; personal_email?: unknown; address?: unknown }
export interface EmployeeStatusBodyDto { status: unknown; terminated_at?: unknown; reason: unknown }
export interface EmployeeCreateCommand { employeeCode: string; nationalId: string | null; passportId: string | null; firstName: string; lastName: string; phone: string | null; personalEmail: string | null; address: string | null; hireDate: string }
export type EmployeeUpdateCommand = Partial<Omit<EmployeeCreateCommand, "employeeCode" | "hireDate">>;
export interface EmployeeStatusCommand { status: EmployeeStatus; terminatedAt: string | null; reason: string }

const invalid = (field: string): never => {
  throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: ["Invalid value."] } });
};
const text = (value: unknown, field: string, max: number): string => {
  if (typeof value !== "string") return invalid(field);
  const result = value.trim();
  if (!result || Array.from(result).length > max) return invalid(field);
  return result;
};
const nullableText = (value: unknown, field: string, max: number): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return invalid(field);
  const result = value.trim();
  if (!result) return null;
  if (Array.from(result).length > max) return invalid(field);
  return result;
};
const email = (value: unknown): string | null => {
  const result = nullableText(value, "personal_email", 255);
  if (result !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) return invalid("personal_email");
  return result;
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

export const parseEmployeeCreate = (body: EmployeeCreateBodyDto): EmployeeCreateCommand => {
  const result = {
    employeeCode: text(body.employee_code, "employee_code", 30), nationalId: nullableText(body.national_id, "national_id", 20),
    passportId: nullableText(body.passport_id, "passport_id", 30), firstName: text(body.first_name, "first_name", 100),
    lastName: text(body.last_name, "last_name", 100), phone: nullableText(body.phone, "phone", 30),
    personalEmail: email(body.personal_email), address: nullableText(body.address, "address", 2_000),
    hireDate: parseBusinessDate(body.hire_date, "hire_date"),
  };
  if (result.nationalId === null && result.passportId === null) invalid("national_id");
  return result;
};

export const parseEmployeeUpdate = (body: EmployeeUpdateBodyDto): EmployeeUpdateCommand => {
  const result: EmployeeUpdateCommand = {};
  if (body.national_id !== undefined) result.nationalId = nullableText(body.national_id, "national_id", 20);
  if (body.passport_id !== undefined) result.passportId = nullableText(body.passport_id, "passport_id", 30);
  if (body.first_name !== undefined) result.firstName = text(body.first_name, "first_name", 100);
  if (body.last_name !== undefined) result.lastName = text(body.last_name, "last_name", 100);
  if (body.phone !== undefined) result.phone = nullableText(body.phone, "phone", 30);
  if (body.personal_email !== undefined) result.personalEmail = email(body.personal_email);
  if (body.address !== undefined) result.address = nullableText(body.address, "address", 2_000);
  if (Object.keys(result).length === 0) invalid("body");
  return result;
};

export const parseEmployeeStatus = (body: EmployeeStatusBodyDto): EmployeeStatusCommand => {
  if (typeof body.status !== "string" || !["active", "inactive", "suspended", "terminated"].includes(body.status)) invalid("status");
  const status = body.status as EmployeeStatus;
  const terminatedAt = body.terminated_at === undefined || body.terminated_at === null ? null : parseBusinessDate(body.terminated_at, "terminated_at");
  if (status === "terminated" && terminatedAt === null) invalid("terminated_at");
  if (status !== "terminated" && terminatedAt !== null) invalid("terminated_at");
  return { status, terminatedAt, reason: text(body.reason, "reason", 500) };
};

export interface EmployeeOnboardingBodyDto { employee: EmployeeCreateBodyDto; assignment: AssignmentBodyDto; bank_account?: BankCreateBody; weekly_holidays?: { weekday: unknown; effective_from: unknown; effective_to?: unknown }[]; account?: { username: unknown } }
export interface EmployeeOnboardingResponseDto {
  employee: EmployeeResponseDto;
  assignment_id: string;
  bank_account_id: string | null;
  weekly_holiday_ids: string[];
  account_id: string | null;
  temporary_password?: string;
}
export const parseEmployeeOnboarding = (body: EmployeeOnboardingBodyDto) => {
  if (!body || typeof body !== "object") invalid("body");
  let account: { username: string } | undefined;
  if (body.account !== undefined) { const username = text(body.account.username, "username", 100); if (!/^[A-Za-z0-9._-]{3,100}$/.test(username)) invalid("username"); account = { username }; }
  return { employee: parseEmployeeCreate(body.employee), assignment: parseAssignmentBody(body.assignment), bankAccount: body.bank_account === undefined ? undefined : parseBankCreate(body.bank_account), weeklyHolidays: (body.weekly_holidays ?? []).map(parseHolidayCreate), account };
};
