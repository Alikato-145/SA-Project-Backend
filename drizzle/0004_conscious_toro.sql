CREATE TYPE "public"."payment_method" AS ENUM('cash', 'transfer');--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "payment_method" "payment_method" DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "promptpay_phone" varchar(10);--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD COLUMN "is_social_security_member" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "is_social_security_member_snapshot" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "social_security_base_snapshot" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "chk_employee_promptpay_phone" CHECK ("employees"."promptpay_phone" is null or "employees"."promptpay_phone" ~ '^0[689][0-9]{8}$');--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "chk_payroll_social_security_base" CHECK ("payroll_records"."social_security_base_snapshot" is null or "payroll_records"."social_security_base_snapshot" >= 0);
--> statement-breakpoint
-- Preserve legacy locked payroll and its immutable trigger. Earned-base snapshot remains NULL.
-- Existing active primary bank destinations retain transfer; future employees default cash.
UPDATE "employees" e SET "payment_method" = 'transfer' WHERE EXISTS (SELECT 1 FROM "employee_bank_accounts" b WHERE b.employee_id = e.id AND b.is_active AND b.is_primary);
