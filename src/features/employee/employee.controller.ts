import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { EmployeeListQueryDto } from "./employee.dto";
import { parseEmployeeListFilters } from "./employee.dto";
import { toEmployeeResponseDto } from "./employee.mapper";
import type { EmployeeService } from "./employee.service";
import { parseEmployeeId } from "./employee.validation";

export const createEmployeeController = (service: EmployeeService) => ({
  async list(input: { actor: AuthenticatedActor; requestId: string; query: EmployeeListQueryDto }) {
    const page = await service.listEmployees({
      actor: input.actor, requestId: input.requestId, ...parseEmployeeListFilters(input.query),
    });
    return {
      data: page.items.map(toEmployeeResponseDto), page: page.page,
      page_size: page.pageSize, total: page.total, request_id: input.requestId,
    };
  },
  async detail(input: { actor: AuthenticatedActor; requestId: string; employeeId: string }) {
    parseEmployeeId(input.employeeId, "employee_id");
    const record = await service.getEmployee(input);
    return { data: toEmployeeResponseDto(record), request_id: input.requestId };
  },
});
export type EmployeeController = ReturnType<typeof createEmployeeController>;
