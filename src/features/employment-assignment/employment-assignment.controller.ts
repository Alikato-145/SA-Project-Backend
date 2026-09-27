import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AssignmentBodyDto } from "./employment-assignment.dto";
import { parseAssignmentBody } from "./employment-assignment.dto";
import { toAssignmentDto } from "./employment-assignment.mapper";
import type { EmploymentAssignmentService } from "./employment-assignment.service";
export const createEmploymentAssignmentController=(service:EmploymentAssignmentService)=>({async list(input:{actor:AuthenticatedActor;requestId:string;employeeId:string}){const rows=await service.listAssignments(input);return{data:rows.map(toAssignmentDto),request_id:input.requestId}},async create(input:{actor:AuthenticatedActor;requestId:string;employeeId:string;body:AssignmentBodyDto}){const result=await service.createAssignment({actor:input.actor,requestId:input.requestId,employeeId:input.employeeId,...parseAssignmentBody(input.body)});return{data:{created:toAssignmentDto(result.created),closed:result.closed?toAssignmentDto(result.closed):null},request_id:input.requestId}}});
