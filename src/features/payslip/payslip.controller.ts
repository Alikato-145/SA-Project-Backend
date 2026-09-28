import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { PayslipService } from "./payslip.service";
export const createPayslipController = (service: PayslipService) => ({
  generate: ({ actor, recordId, requestId }: { actor: AuthenticatedActor; recordId: string; requestId: string }) => service.generate(actor, recordId, requestId).then((data) => ({ data, request_id: requestId })),
  mine: ({ actor, requestId }: { actor: AuthenticatedActor; requestId: string }) => service.mine(actor, requestId).then((data) => ({ data, request_id: requestId })),
  get: ({ actor, payslipId, requestId }: { actor: AuthenticatedActor; payslipId: string; requestId: string }) => service.get(actor, payslipId, requestId).then((data) => ({ data, request_id: requestId })),
  deliver: ({ actor, payslipId, email, requestId }: { actor: AuthenticatedActor; payslipId: string; email: string; requestId: string }) => service.deliver(actor, payslipId, email, requestId).then((data) => ({ data, request_id: requestId })),
  deliveries: ({ actor, payslipId, requestId }: { actor: AuthenticatedActor; payslipId: string; requestId: string }) => service.deliveries(actor, payslipId, requestId).then((data) => ({ data, request_id: requestId })),
  void: ({ actor, payslipId, requestId }: { actor: AuthenticatedActor; payslipId: string; requestId: string }) => service.void(actor, payslipId, requestId).then((data) => ({ data, request_id: requestId })),
});
