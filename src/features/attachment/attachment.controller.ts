import type { AuthenticatedActor } from "../../core/auth/auth.types";
import type { AttachmentOwner } from "./attachment.repository";
import type { AttachmentService } from "./attachment.service";
import { toAttachmentDto } from "./attachment.mapper";
export const createAttachmentController = (service: AttachmentService) => ({
  async list(actor: AuthenticatedActor, owner: AttachmentOwner, requestId: string) { return { data: (await service.list(actor, owner, requestId)).map(toAttachmentDto), request_id: requestId }; },
  async upload(actor: AuthenticatedActor, owner: AttachmentOwner, file: File, requestId: string) {
    const record = await service.upload(actor, owner, { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, requestId);
    return { data: toAttachmentDto(record), request_id: requestId };
  },
  async download(actor: AuthenticatedActor, id: string, requestId: string) {
    const file = await service.download(actor, id, requestId);
    return new Response(Uint8Array.from(file.bytes).buffer, { headers: { "content-type": file.mime,
      "content-disposition": `attachment; filename="attachment-${id}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  },
});
