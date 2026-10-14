import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { PayslipService } from "./payslip.service";
import { toDeliveryDto, toPayslipDto } from "./payslip.mapper";
export const createPayslipController = (service: PayslipService) => ({
  generate: ({ actor, recordId, requestId }: { actor: AuthenticatedActor; recordId: string; requestId: string }) => service.generate(actor, recordId, requestId).then((data) => ({ data: toPayslipDto(data), request_id: requestId })),
  mine: ({ actor, requestId }: { actor: AuthenticatedActor; requestId: string }) => service.mine(actor, requestId).then((data) => ({ data: data.map(toPayslipDto), request_id: requestId })),
  get: ({ actor, payslipId, requestId }: { actor: AuthenticatedActor; payslipId: string; requestId: string }) => service.get(actor, payslipId, requestId).then((data) => ({ data: toPayslipDto(data), request_id: requestId })),
  deliver: ({ actor, payslipId, email, requestId }: { actor: AuthenticatedActor; payslipId: string; email: string; requestId: string }) => service.deliver(actor, payslipId, email, requestId).then((data) => ({ data: toDeliveryDto(data), request_id: requestId })),
  resolve: (actor:AuthenticatedActor,payslipId:string,attemptId:string,body:{outcome:"sent"|"failed";reason:string;provider_reference?:string},requestId:string)=>service.resolveDelivery(actor,payslipId,attemptId,body.outcome,body.reason,body.provider_reference,requestId).then(data=>({data:toDeliveryDto(data),request_id:requestId})),
  deliveries: ({ actor, payslipId, requestId }: { actor: AuthenticatedActor; payslipId: string; requestId: string }) => service.deliveries(actor, payslipId, requestId).then((data) => ({ data: data.map(toDeliveryDto), request_id: requestId })),
  download: async ({ actor, payslipId, requestId }: { actor: AuthenticatedActor; payslipId: string; requestId: string }) => {
    const file = await service.download(actor, payslipId, requestId);
    return new Response(Uint8Array.from(file.bytes).buffer, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${file.filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  },
  void: ({ actor, payslipId, requestId }: { actor: AuthenticatedActor; payslipId: string; requestId: string }) => service.void(actor, payslipId, requestId).then((data) => ({ data, request_id: requestId })),
});
