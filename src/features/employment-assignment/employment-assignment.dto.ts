import { ApplicationError } from "../../core/errors/application.error";
import { parseBusinessDate, parseEmployeeId, parseMoney } from "../employee/employee.validation";
export type EmploymentType = "full_time" | "part_time" | "temporary";
export interface AssignmentBodyDto { branch_id: unknown; department_id: unknown; position_id: unknown; employment_type: unknown; base_salary: unknown; welfare_amount: unknown; effective_from: unknown; effective_to?: unknown; is_social_security_member?: unknown }
export interface AssignmentCommand { isSocialSecurityMember?: boolean; branchId: string; departmentId: string; positionId: string; employmentType: EmploymentType; baseSalary: string; welfareAmount: string; effectiveFrom: string; effectiveTo: string | null }
export interface AssignmentDto { is_social_security_member: boolean; id: string; employee_id: string; branch_id: string; department_id: string; position_id: string; employment_type: EmploymentType; base_salary: string; welfare_amount: string; effective_from: string; effective_to: string | null; is_primary: boolean }
const invalid = (field: string): never => { throw new ApplicationError("VALIDATION_ERROR", { fieldErrors: { [field]: ["Invalid value."] } }); };
export const parseAssignmentBody = (body: AssignmentBodyDto): AssignmentCommand => {
  if (body.is_social_security_member !== undefined && typeof body.is_social_security_member !== "boolean") invalid("is_social_security_member");
  const employmentType = body.employment_type; if (typeof employmentType !== "string" || !["full_time", "part_time", "temporary"].includes(employmentType)) invalid("employment_type");
  const effectiveFrom = parseBusinessDate(body.effective_from, "effective_from");
  const effectiveTo = body.effective_to === undefined || body.effective_to === null ? null : parseBusinessDate(body.effective_to, "effective_to");
  if (effectiveTo !== null && effectiveTo < effectiveFrom) invalid("effective_to");
  return { isSocialSecurityMember: body.is_social_security_member === undefined ? true : body.is_social_security_member as boolean, branchId: String(parseEmployeeId(body.branch_id, "branch_id")), departmentId: String(parseEmployeeId(body.department_id, "department_id")), positionId: String(parseEmployeeId(body.position_id, "position_id")), employmentType: employmentType as EmploymentType, baseSalary: parseMoney(body.base_salary, "base_salary"), welfareAmount: parseMoney(body.welfare_amount, "welfare_amount"), effectiveFrom, effectiveTo };
};
