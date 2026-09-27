import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { EmployeeCreateBodyDto, EmployeeListQueryDto, EmployeeStatusBodyDto, EmployeeUpdateBodyDto } from "./employee.dto";
import { parseEmployeeCreate, parseEmployeeListFilters, parseEmployeeStatus, parseEmployeeUpdate } from "./employee.dto";
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
  async create(input: { actor: AuthenticatedActor; requestId: string; body: EmployeeCreateBodyDto }) {
    const result = await service.createEmployee({ actor: input.actor, requestId: input.requestId, ...parseEmployeeCreate(input.body) });
    return { data: toEmployeeResponseDto(result), request_id: input.requestId };
  },
  async update(input: { actor: AuthenticatedActor; requestId: string; employeeId: string; body: EmployeeUpdateBodyDto }) {
    const result = await service.updateEmployee({ actor: input.actor, requestId: input.requestId, employeeId: input.employeeId, ...parseEmployeeUpdate(input.body) });
    return { data: toEmployeeResponseDto(result), request_id: input.requestId };
  },
  async changeStatus(input: { actor: AuthenticatedActor; requestId: string; employeeId: string; body: EmployeeStatusBodyDto }) {
    const result = await service.changeEmployeeStatus({ actor: input.actor, requestId: input.requestId, employeeId: input.employeeId, ...parseEmployeeStatus(input.body) });
    return { data: toEmployeeResponseDto(result), request_id: input.requestId };
  },
  async detail(input: { actor: AuthenticatedActor; requestId: string; employeeId: string }) {
    parseEmployeeId(input.employeeId, "employee_id");
    const record = await service.getEmployee(input);
    return { data: toEmployeeResponseDto(record), request_id: input.requestId };
  },
});
export type EmployeeController = ReturnType<typeof createEmployeeController>;
