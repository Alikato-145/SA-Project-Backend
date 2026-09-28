import { databaseId } from "./operation-validation";
/** Pure public DTO conversion; used only at controller/mapper boundaries. */
export const operationResponse = (value: unknown): any => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(operationResponse);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item]) => {
    const publicKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    return [publicKey, (key === "id" || key.endsWith("Id")) && item !== null ? String(databaseId(item as string|number)) : operationResponse(item)];
  }));
  return value;
};
export const operationSuccess = (value: unknown, requestId: string = "") => ({ data: operationResponse(value), request_id: requestId });

/** Request shape conversion belongs at the controller boundary. */
export const operationCommand = (value: Record<string,any>): any => Object.fromEntries(Object.entries(value).map(([key,item]) => {
 const field=key.replace(/_([a-z])/g,(_,letter)=>letter.toUpperCase());
 return [field, (field === "id" || field.endsWith("Id")) && item != null ? databaseId(item) : item];
}));

export const publicOperationData=(value:any):any => Array.isArray(value) ? value.map(publicOperationData) : value && typeof value==="object" && !(value instanceof Date) ? Object.fromEntries(Object.entries(value).filter(([key])=> !["createdAt","updatedAt","decidedByUserAccountId","submittedAt","decidedAt","approvedAt","closedAt","createdByUserAccountId","submittedByUserAccountId","requestedByUserAccountId","requestedAt","approvedByUserAccountId","recordedByUserAccountId"].includes(key)).map(([key,item])=>[key,publicOperationData(item)])) : value;
