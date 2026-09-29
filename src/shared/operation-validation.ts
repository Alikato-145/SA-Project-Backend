import { t } from "elysia";
import { ApplicationError } from "../core/errors/application.error";
export const operationId = t.String({ pattern: "^[1-9][0-9]*$", maxLength: 16 });
export const operationDate = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
export const operationMoney = t.String({ pattern: "^\\d{1,10}(?:\\.\\d{1,2})?$" });
export const databaseId = (value: string | number) => {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new ApplicationError("VALIDATION_ERROR");
  return Number(value);
};
export const realDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10) !== value) throw new ApplicationError("VALIDATION_ERROR");
  return value;
};
export const bangkokToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const bangkokBusinessDate=(instant:Date) => {
 if(Number.isNaN(instant.valueOf()))throw new ApplicationError("VALIDATION_ERROR");
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(instant);
 const field=(name:string)=>parts.find(part=>part.type===name)!.value;
 return `${field("year")}-${field("month")}-${field("day")}`;
};
