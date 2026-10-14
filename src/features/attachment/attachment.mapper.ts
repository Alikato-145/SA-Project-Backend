import type { AttachmentRecord } from "./attachment.repository";
export const toAttachmentDto = (record: AttachmentRecord) => ({ id: String(record.id), file_name: record.fileName,
  mime_type: record.mimeType, file_size_bytes: record.fileSizeBytes, uploaded_at: record.uploadedAt.toISOString() });
