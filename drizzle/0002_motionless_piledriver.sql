ALTER TABLE "payroll_adjustments" ALTER COLUMN "original_payroll_record_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD COLUMN "employee_id" bigint;--> statement-breakpoint
UPDATE "payroll_adjustments" AS adjustment SET "employee_id" = record."employee_id" FROM "payroll_records" AS record WHERE adjustment."original_payroll_record_id" = record."id";--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ALTER COLUMN "employee_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adj_employee_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "payroll_adjustments_target_employee_status_idx" ON "payroll_adjustments" USING btree ("applied_payroll_period_id","employee_id","status");--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "chk_adjustment_origin_or_target" CHECK ("payroll_adjustments"."original_payroll_record_id" IS NOT NULL OR "payroll_adjustments"."applied_payroll_period_id" IS NOT NULL);