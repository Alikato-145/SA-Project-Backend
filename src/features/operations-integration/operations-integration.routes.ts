import Elysia from "elysia";
import { requestIdPlugin } from "../../core/audit/request-id.plugin";
import type { AuthenticatedActor } from "../../core/auth/auth.types";
import { validateCookieMutationRequest } from "../../core/auth/csrf-origin";
import { ApplicationError, isApplicationError } from "../../core/errors/application.error";
import { toPublicErrorResult } from "../../core/errors/error-boundary";
import { createAdvanceRoutes } from "../advance/advance.routes";
import { AdvanceController } from "../advance/advance.controller";
import { DrizzleAdvanceRepository } from "../advance/advance.repository";
import { AdvanceService } from "../advance/advance.service";
import { AttendanceController } from "../attendance/attendance.controller";
import { DrizzleAttendanceLeaveEffectRepository } from "../attendance/attendance-leave-effect.repository";
import { AttendanceLeaveEffect } from "../attendance/attendance-leave-effect.service";
import { DrizzleAttendanceRepository } from "../attendance/attendance.repository";
import { createAttendanceRoutes } from "../attendance/attendance.routes";
import { AttendanceService } from "../attendance/attendance.service";
import { BranchScheduleController } from "../branch-schedule/branch-schedule.controller";
import { DrizzleBranchScheduleRepository } from "../branch-schedule/branch-schedule.repository";
import { createBranchScheduleRoutes } from "../branch-schedule/branch-schedule.routes";
import { BranchScheduleService } from "../branch-schedule/branch-schedule.service";
import { DebtController } from "../debt/debt.controller";
import { DrizzleDebtRepository } from "../debt/debt.repository";
import { createDebtRoutes } from "../debt/debt.routes";
import { DebtService } from "../debt/debt.service";
import { HolidayCalendarController } from "../holiday-calendar/holiday-calendar.controller";
import { DrizzleHolidayCalendarRepository } from "../holiday-calendar/holiday-calendar.repository";
import { createHolidayCalendarRoutes } from "../holiday-calendar/holiday-calendar.routes";
import { HolidayCalendarService } from "../holiday-calendar/holiday-calendar.service";
import { LeaveController } from "../leave/leave.controller";
import { DrizzleLeaveRepository } from "../leave/leave.repository";
import { createLeaveRoutes } from "../leave/leave.routes";
import { LeaveService } from "../leave/leave.service";
import { LoanController } from "../loan/loan.controller";
import { DrizzleLoanRepository } from "../loan/loan.repository";
import { createLoanRoutes } from "../loan/loan.routes";
import { LoanService } from "../loan/loan.service";
import { OvertimeController } from "../overtime/overtime.controller";
import { DrizzleOvertimeRepository } from "../overtime/overtime.repository";
import { createOvertimeRoutes } from "../overtime/overtime.routes";
import { OvertimeService } from "../overtime/overtime.service";
import { DrizzleOperationsScopeRepository } from "./operations-integration.repository";
import { OperationsIntegrationService } from "./operations-integration.service";

const mappedError = (error: unknown) => {
  if (isApplicationError(error)) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code) : "";
  if (code === "OUT_OF_SCOPE") return new ApplicationError("FORBIDDEN_SCOPE");
  if (code.includes("NOT_FOUND")) return new ApplicationError("RESOURCE_NOT_FOUND");
  if (code.includes("LOCKED")) return new ApplicationError("PAYROLL_PERIOD_LOCKED");
  if (code.includes("ALREADY") || code.includes("OVERLAP") || code.includes("CONFLICT") || code.includes("PENDING")) return new ApplicationError("STATE_CONFLICT");
  return new ApplicationError("VALIDATION_ERROR", { cause: error });
};

export interface OperationsRoutesOptions {
  authenticate(request: Request): Promise<AuthenticatedActor>;
  allowedOrigins: readonly string[];
}

export const createOperationsRoutes = (options: OperationsRoutesOptions) => {
  const integration = new OperationsIntegrationService(new DrizzleOperationsScopeRepository());
  const auth = (context: unknown) => options.authenticate((context as { request: Request }).request);
  const actor = async (context: unknown) => integration.featureActor(await auth(context));
  const employee = async (value: unknown) => {
    const authenticated = (value as { authenticated?: AuthenticatedActor }).authenticated;
    return authenticated ?? auth(value);
  };
  const access = {
    assertCanManageWorkDay: async (value: unknown, command: { employeeId: number; workDate: string }) => integration.assertEmployee(await employee(value), command.employeeId, undefined, command.workDate),
    assertEmployeeAssignedToBranch: async (employeeId: number, branchId: number, date: string) => {
      if ((await integration.branchAtDate(employeeId, date)) !== branchId) throw new ApplicationError("FORBIDDEN_SCOPE");
    },
    assertCanReadWorkDays: async (value: unknown, filter: { employeeId?: number; from?: string }) => {
      if (filter.employeeId) await integration.assertEmployee(await employee(value), filter.employeeId, undefined, filter.from);
    },
  };
  const attendance = new AttendanceService(new DrizzleAttendanceRepository(), access, { assertWorkDayCanBeCorrected: (record) => integration.assertDateUnlocked(undefined, record.employeeId, record.workDate) });
  const leaveAccess = {
    assertCanSubmit: async (value: unknown, employeeId: number, dates: string[]) => integration.assertEmployee(await employee(value), employeeId, undefined, dates[0]),
    assertCanDecide: async (value: unknown, employeeId: number, dates: string[]) => integration.assertEmployee(await employee(value), employeeId, undefined, dates[0]),
    assertCanRead: async (value: unknown, employeeId: number) => integration.assertEmployee(await employee(value), employeeId),
  };
  const leave = new LeaveService(new DrizzleLeaveRepository(), leaveAccess,
    new AttendanceLeaveEffect(new DrizzleAttendanceLeaveEffectRepository(), { branchAtDate: (employeeId, date) => integration.branchAtDate(employeeId, date) }),
    { assertDatesUnlocked: (transaction, employeeId, dates) => integration.assertDatesUnlocked(transaction, employeeId, dates) });
  const overtime = new OvertimeService(new DrizzleOvertimeRepository(), {
    assertCanSubmit: async (value, employeeId, date) => integration.assertEmployee(await employee(value), employeeId, undefined, date),
    assertCanDecide: async (value, employeeId, date) => integration.assertEmployee(await employee(value), employeeId, undefined, date),
    assertCanRead: async (value, employeeId) => integration.assertEmployee(await employee(value), employeeId),
  }, { assertEligible: (command) => integration.assertOvertimeEligible(command) }, { assertDateUnlocked: (transaction, employeeId, date) => integration.assertDateUnlocked(transaction, employeeId, date) });
  const financeAccess = {
    assertCanRequest: async (value: unknown, employeeId: number) => integration.assertEmployee(await employee(value), employeeId),
    assertCanDecide: async (value: unknown, employeeId: number) => {
      const authenticated = await employee(value); integration.assertFinanceAdmin(authenticated);
      await integration.assertEmployee(authenticated, employeeId);
    },
    assertCanCreate: async (value: unknown, employeeId: number) => {
      const authenticated = await employee(value); integration.assertFinanceAdmin(authenticated);
      await integration.assertEmployee(authenticated, employeeId);
    },
    assertCanRecord: async (value: unknown, employeeId: number) => {
      const authenticated = await employee(value); integration.assertFinanceAdmin(authenticated);
      await integration.assertEmployee(authenticated, employeeId);
    },
    assertCanRead: async (value: unknown, employeeId: number) => integration.assertEmployee(await employee(value), employeeId),
  };
  const advance = new AdvanceService(new DrizzleAdvanceRepository(), financeAccess, integration, integration);
  const loan = new LoanService(new DrizzleLoanRepository(), financeAccess, {
    assertPayrollLocked: (transaction, _payrollRecordId, employeeId, duePeriodStart) =>
      integration.assertDateUnlocked(transaction, employeeId, duePeriodStart),
  });
  const debt = new DebtService(new DrizzleDebtRepository(), financeAccess, () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()));
  const schedules = new BranchScheduleService(new DrizzleBranchScheduleRepository(), { assertCanManageBranch: async (value, branchId) => integration.assertManageBranch(await employee(value), branchId) });
  const holidays = new HolidayCalendarService(new DrizzleHolidayCalendarRepository(), { assertCanManageShop: async (value, shopId) => integration.assertManageShop(await employee(value), shopId) });

  return new Elysia({ name: "operations-integration", prefix: "/api/v1/operations" })
    .use(requestIdPlugin)
    .onBeforeHandle(({ request }) => {
      const result = validateCookieMutationRequest(request, options.allowedOrigins);
      if (!result.allowed && result.rejection) throw new ApplicationError(result.rejection);
    })
    .onAfterHandle(({ response, requestId }) => ({ data: response, request_id: requestId }))
    .onError(({ code, error, requestId, set }) => {
      const result = toPublicErrorResult(code === "VALIDATION" ? new ApplicationError("VALIDATION_ERROR") : mappedError(error), requestId);
      set.status = result.status;
      return result.body;
    })
    .use(createAttendanceRoutes({ controller: new AttendanceController(attendance), actorFromContext: (context) => actor(context) }))
    .use(createBranchScheduleRoutes({ controller: new BranchScheduleController(schedules), actorFromContext: (context) => actor(context) }))
    .use(createHolidayCalendarRoutes({ controller: new HolidayCalendarController(holidays), actorFromContext: (context) => actor(context) }))
    .use(createLeaveRoutes(new LeaveController(leave), (context) => actor(context)))
    .use(createOvertimeRoutes(new OvertimeController(overtime), (context) => actor(context)))
    .use(createAdvanceRoutes(new AdvanceController(advance), (context) => actor(context)))
    .use(createLoanRoutes(new LoanController(loan), (context) => actor(context)))
    .use(createDebtRoutes(new DebtController(debt), (context) => actor(context)));
};
