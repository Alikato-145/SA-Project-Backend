import type { AssignmentDto } from "./employment-assignment.dto";
import type { AssignmentRecord } from "./employment-assignment.repository";
export const toAssignmentDto=(r:AssignmentRecord):AssignmentDto=>({id:r.id,employee_id:r.employeeId,branch_id:r.branchId,department_id:r.departmentId,position_id:r.positionId,employment_type:r.employmentType,base_salary:r.baseSalary,welfare_amount:r.welfareAmount,effective_from:r.effectiveFrom,effective_to:r.effectiveTo,is_primary:r.isPrimary});
