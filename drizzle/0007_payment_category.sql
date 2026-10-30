ALTER TABLE "employees" ADD COLUMN "payment_category" varchar(20);--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD COLUMN "payment_category_snapshot" varchar(20);--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "chk_employee_payment_category" CHECK ("employees"."payment_category" is null or "employees"."payment_category" in ('cash', 'transfer', 'social_security'));--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "chk_payment_category_snapshot" CHECK ("payroll_payments"."payment_category_snapshot" is null or "payroll_payments"."payment_category_snapshot" in ('cash', 'transfer', 'social_security'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_payroll_payment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r payroll_records%ROWTYPE; b bigint; p payroll_period_status;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payroll payment history cannot be deleted'; END IF;
 IF TG_OP = 'UPDATE' THEN
   IF (to_jsonb(NEW) - ARRAY['status','paid_by_user_account_id','paid_at','reference_no','cancelled_by_user_account_id','cancelled_at','cancellation_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','paid_by_user_account_id','paid_at','reference_no','cancelled_by_user_account_id','cancelled_at','cancellation_reason','updated_at']) THEN RAISE EXCEPTION 'Payment snapshots are immutable'; END IF;
   IF OLD.status <> 'prepared' OR NEW.status NOT IN ('paid','cancelled') THEN RAISE EXCEPTION 'Invalid payment lifecycle transition'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO r FROM payroll_records WHERE id=NEW.payroll_record_id;
 SELECT status INTO p FROM payroll_periods WHERE id=r.payroll_period_id;
 SELECT branch_id INTO b FROM employment_assignments WHERE id=r.employment_assignment_id;
 IF r.status <> 'locked' OR p <> 'locked' OR NEW.amount <> r.net_pay OR NEW.branch_id_snapshot <> b OR NEW.status <> 'prepared' THEN RAISE EXCEPTION 'Payment requires full locked payroll snapshot'; END IF;
 IF NEW.payment_category_snapshot IS NULL THEN
   IF NEW.payment_method = 'transfer' AND ((r.is_social_security_member_snapshot AND NEW.employee_bank_account_id IS NULL) OR (NOT r.is_social_security_member_snapshot AND NEW.promptpay_phone_snapshot IS NULL)) THEN RAISE EXCEPTION 'Missing required payment destination'; END IF;
 ELSIF (NEW.payment_category_snapshot = 'cash' AND NEW.payment_method <> 'cash') OR
       (NEW.payment_category_snapshot = 'transfer' AND (NEW.payment_method <> 'transfer' OR NEW.promptpay_phone_snapshot IS NULL)) OR
       (NEW.payment_category_snapshot = 'social_security' AND (NEW.payment_method <> 'transfer' OR NEW.employee_bank_account_id IS NULL)) THEN
   RAISE EXCEPTION 'Missing required payment destination';
 END IF;
 RETURN NEW;
END $$;
