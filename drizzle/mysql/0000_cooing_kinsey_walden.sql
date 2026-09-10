CREATE TABLE `advance_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`request_month` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` enum('pending','approved','rejected','deducted','cancelled') NOT NULL DEFAULT 'pending',
	`requested_by_user_account_id` bigint unsigned NOT NULL,
	`requested_at` timestamp(3) NOT NULL DEFAULT (now()),
	`decided_by_user_account_id` bigint unsigned,
	`decided_at` timestamp(3),
	`decision_note` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `advance_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `advance_requests_employee_month_uidx` UNIQUE(`employee_id`,`request_month`),
	CONSTRAINT `chk_advance_amount_positive` CHECK(`advance_requests`.`amount` > 0),
	CONSTRAINT `chk_advance_request_month` CHECK(dayofmonth(`advance_requests`.`request_month`) = 1)
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned,
	`leave_request_id` bigint unsigned,
	`file_name` varchar(255) NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`file_size_bytes` bigint unsigned NOT NULL,
	`file_sha256` varchar(64) NOT NULL,
	`uploaded_by_user_account_id` bigint unsigned NOT NULL,
	`uploaded_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_attachment_single_owner` CHECK((`attachments`.`employee_id` is not null and `attachments`.`leave_request_id` is null) or (`attachments`.`employee_id` is null and `attachments`.`leave_request_id` is not null)),
	CONSTRAINT `chk_attachment_size_positive` CHECK(`attachments`.`file_size_bytes` > 0)
);
--> statement-breakpoint
CREATE TABLE `work_day_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned NOT NULL,
	`work_date` date NOT NULL,
	`clock_in_at` timestamp(3),
	`clock_out_at` timestamp(3),
	`status` enum('present','late','absent','leave','weekly_holiday','public_holiday') NOT NULL,
	`late_minutes` int NOT NULL DEFAULT 0,
	`is_deductible` boolean NOT NULL DEFAULT false,
	`entry_source` enum('manual','import','biometric') NOT NULL DEFAULT 'manual',
	`created_by_user_account_id` bigint unsigned,
	`note` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `work_day_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_day_records_employee_date_uidx` UNIQUE(`employee_id`,`work_date`),
	CONSTRAINT `chk_clock_order` CHECK(`work_day_records`.`clock_out_at` is null or `work_day_records`.`clock_in_at` is null or `work_day_records`.`clock_out_at` >= `work_day_records`.`clock_in_at`),
	CONSTRAINT `chk_late_minutes_nonnegative` CHECK(`work_day_records`.`late_minutes` >= 0)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor_user_account_id` bigint unsigned,
	`action` varchar(80) NOT NULL,
	`table_name` varchar(100) NOT NULL,
	`record_id` varchar(100) NOT NULL,
	`old_data` json,
	`new_data` json,
	`reason` text,
	`occurred_at` timestamp(3) NOT NULL DEFAULT (now()),
	`request_id` varchar(100),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(150) NOT NULL,
	`address` text,
	`timezone` varchar(50) NOT NULL DEFAULT 'Asia/Bangkok',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_shop_code_uidx` UNIQUE(`shop_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `branch_schedule_overrides` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`branch_id` bigint unsigned NOT NULL,
	`schedule_date` date NOT NULL,
	`work_start_time` time,
	`close_time` time,
	`is_closed` boolean NOT NULL DEFAULT false,
	`reason` varchar(255),
	`created_by_user_account_id` bigint unsigned,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `branch_schedule_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_schedule_overrides_branch_date_uidx` UNIQUE(`branch_id`,`schedule_date`)
);
--> statement-breakpoint
CREATE TABLE `branch_schedules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`branch_id` bigint unsigned NOT NULL,
	`work_start_time` time NOT NULL,
	`standard_close_time` time NOT NULL DEFAULT '21:00:00',
	`late_grace_minutes` smallint NOT NULL DEFAULT 0,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `branch_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `branch_schedules_branch_from_uidx` UNIQUE(`branch_id`,`effective_from`),
	CONSTRAINT `chk_late_grace_nonnegative` CHECK(`branch_schedules`.`late_grace_minutes` >= 0),
	CONSTRAINT `chk_branch_schedule_period` CHECK(`branch_schedules`.`effective_to` is null or `branch_schedules`.`effective_to` >= `branch_schedules`.`effective_from`)
);
--> statement-breakpoint
CREATE TABLE `debt_transactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`debt_type_id` smallint unsigned NOT NULL,
	`transaction_kind` enum('charge','adjustment','reversal') NOT NULL DEFAULT 'charge',
	`transaction_date` date NOT NULL,
	`description` text NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`original_transaction_id` bigint unsigned,
	`recorded_by_user_account_id` bigint unsigned NOT NULL,
	`settled_in_payroll_record_id` bigint unsigned,
	`settled_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `debt_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_debt_amount_positive` CHECK(`debt_transactions`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `debt_types` (
	`id` smallint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(30) NOT NULL,
	`name_th` varchar(100) NOT NULL,
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `debt_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `debt_types_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`branch_id` bigint unsigned NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(100) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `departments_branch_code_uidx` UNIQUE(`branch_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_code` varchar(30) NOT NULL,
	`national_id` varchar(20),
	`passport_id` varchar(30),
	`first_name` varchar(100) NOT NULL,
	`last_name` varchar(100) NOT NULL,
	`phone` varchar(30),
	`personal_email` varchar(255),
	`address` text,
	`hire_date` date NOT NULL,
	`status` enum('active','inactive','suspended','terminated') NOT NULL DEFAULT 'active',
	`terminated_at` date,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `employees_id` PRIMARY KEY(`id`),
	CONSTRAINT `employees_employee_code_unique` UNIQUE(`employee_code`),
	CONSTRAINT `employees_national_id_unique` UNIQUE(`national_id`),
	CONSTRAINT `employees_passport_id_unique` UNIQUE(`passport_id`),
	CONSTRAINT `chk_employee_identity` CHECK(`employees`.`national_id` is not null or `employees`.`passport_id` is not null),
	CONSTRAINT `chk_employee_dates` CHECK(`employees`.`terminated_at` is null or `employees`.`terminated_at` >= `employees`.`hire_date`)
);
--> statement-breakpoint
CREATE TABLE `employee_bank_accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`bank_code` varchar(20) NOT NULL,
	`bank_name` varchar(100) NOT NULL,
	`account_holder_name` varchar(200) NOT NULL,
	`account_number_ciphertext` text NOT NULL,
	`account_number_last4` varchar(4) NOT NULL,
	`is_primary` boolean NOT NULL DEFAULT true,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_bank_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_weekly_holidays` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`weekday` smallint NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `employee_weekly_holidays_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_weekly_holidays_uidx` UNIQUE(`employee_id`,`weekday`,`effective_from`),
	CONSTRAINT `chk_weekday_range` CHECK(`employee_weekly_holidays`.`weekday` between 0 and 6),
	CONSTRAINT `chk_weekly_holiday_period` CHECK(`employee_weekly_holidays`.`effective_to` is null or `employee_weekly_holidays`.`effective_to` >= `employee_weekly_holidays`.`effective_from`)
);
--> statement-breakpoint
CREATE TABLE `employment_assignments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned NOT NULL,
	`department_id` bigint unsigned NOT NULL,
	`position_id` bigint unsigned NOT NULL,
	`employment_type` enum('full_time','part_time','temporary') NOT NULL DEFAULT 'full_time',
	`base_salary` decimal(12,2) NOT NULL,
	`welfare_amount` decimal(12,2) NOT NULL DEFAULT 0,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`is_primary` boolean NOT NULL DEFAULT true,
	`created_by_user_account_id` bigint unsigned,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `employment_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `employment_assignments_employee_from_uidx` UNIQUE(`employee_id`,`effective_from`),
	CONSTRAINT `chk_assignment_salary_nonnegative` CHECK(`employment_assignments`.`base_salary` >= 0),
	CONSTRAINT `chk_assignment_welfare_nonnegative` CHECK(`employment_assignments`.`welfare_amount` >= 0),
	CONSTRAINT `chk_assignment_period` CHECK(`employment_assignments`.`effective_to` is null or `employment_assignments`.`effective_to` >= `employment_assignments`.`effective_from`)
);
--> statement-breakpoint
CREATE TABLE `holiday_calendars` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`holiday_date` date NOT NULL,
	`name` varchar(150) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by_user_account_id` bigint unsigned,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `holiday_calendars_id` PRIMARY KEY(`id`),
	CONSTRAINT `holiday_calendars_shop_date_uidx` UNIQUE(`shop_id`,`holiday_date`)
);
--> statement-breakpoint
CREATE TABLE `leave_approval_actions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`leave_request_id` bigint unsigned NOT NULL,
	`actor_user_account_id` bigint unsigned NOT NULL,
	`action` enum('submitted','forwarded','approved','rejected','overridden','type_changed','cancelled') NOT NULL,
	`from_leave_type_id` smallint unsigned,
	`to_leave_type_id` smallint unsigned,
	`remark` text,
	`acted_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_approval_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leave_quotas` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`leave_type_id` smallint unsigned NOT NULL,
	`quota_year` smallint unsigned NOT NULL,
	`entitled_days` decimal(6,2) NOT NULL,
	`used_days` decimal(6,2) NOT NULL DEFAULT 0,
	`last_recalculated_at` timestamp(3),
	`frozen_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_quotas_id` PRIMARY KEY(`id`),
	CONSTRAINT `leave_quotas_employee_type_year_uidx` UNIQUE(`employee_id`,`leave_type_id`,`quota_year`),
	CONSTRAINT `chk_entitled_days_nonnegative` CHECK(`leave_quotas`.`entitled_days` >= 0),
	CONSTRAINT `chk_used_days_nonnegative` CHECK(`leave_quotas`.`used_days` >= 0)
);
--> statement-breakpoint
CREATE TABLE `leave_request_days` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`leave_request_id` bigint unsigned NOT NULL,
	`work_day_record_id` bigint unsigned,
	`leave_type_id` smallint unsigned NOT NULL,
	`leave_date` date NOT NULL,
	`day_amount` decimal(4,2) NOT NULL DEFAULT 1,
	`is_paid` boolean NOT NULL,
	`is_deductible` boolean NOT NULL,
	`quota_consumed` decimal(4,2) NOT NULL DEFAULT 0,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_request_days_id` PRIMARY KEY(`id`),
	CONSTRAINT `leave_request_days_work_day_record_id_unique` UNIQUE(`work_day_record_id`),
	CONSTRAINT `leave_request_days_request_date_uidx` UNIQUE(`leave_request_id`,`leave_date`),
	CONSTRAINT `chk_leave_day_amount` CHECK(`leave_request_days`.`day_amount` > 0 and `leave_request_days`.`day_amount` <= 1),
	CONSTRAINT `chk_quota_consumed` CHECK(`leave_request_days`.`quota_consumed` >= 0 and `leave_request_days`.`quota_consumed` <= `leave_request_days`.`day_amount`)
);
--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`original_leave_type_id` smallint unsigned NOT NULL,
	`final_leave_type_id` smallint unsigned,
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`requested_days` decimal(6,2) NOT NULL,
	`reason` text,
	`status` enum('draft','pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`is_retroactive` boolean NOT NULL DEFAULT false,
	`submitted_by_user_account_id` bigint unsigned NOT NULL,
	`submitted_at` timestamp(3) NOT NULL DEFAULT (now()),
	`decided_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_leave_request_period` CHECK(`leave_requests`.`end_date` >= `leave_requests`.`start_date`),
	CONSTRAINT `chk_requested_days_positive` CHECK(`leave_requests`.`requested_days` > 0)
);
--> statement-breakpoint
CREATE TABLE `leave_types` (
	`id` smallint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(30) NOT NULL,
	`name_th` varchar(100) NOT NULL,
	`quota_type` enum('fixed','by_seniority','none') NOT NULL,
	`quota_days` decimal(6,2),
	`is_deductible` boolean NOT NULL,
	`requires_document` boolean NOT NULL DEFAULT false,
	`allow_exceed` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `leave_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `leave_types_code_unique` UNIQUE(`code`),
	CONSTRAINT `chk_leave_type_quota_nonnegative` CHECK(`leave_types`.`quota_days` is null or `leave_types`.`quota_days` >= 0)
);
--> statement-breakpoint
CREATE TABLE `loan_installments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`loan_id` bigint unsigned NOT NULL,
	`installment_no` smallint NOT NULL,
	`due_period_start` date NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`status` enum('scheduled','deducted','waived','cancelled') NOT NULL DEFAULT 'scheduled',
	`deducted_at` timestamp(3),
	`payroll_record_id` bigint unsigned,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `loan_installments_id` PRIMARY KEY(`id`),
	CONSTRAINT `loan_installments_loan_no_uidx` UNIQUE(`loan_id`,`installment_no`),
	CONSTRAINT `chk_installment_no_positive` CHECK(`loan_installments`.`installment_no` > 0),
	CONSTRAINT `chk_installment_amount_positive` CHECK(`loan_installments`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `loans` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`principal_amount` decimal(12,2) NOT NULL,
	`reason` text NOT NULL,
	`installment_count` smallint NOT NULL,
	`status` enum('active','closed','cancelled') NOT NULL DEFAULT 'active',
	`approved_by_user_account_id` bigint unsigned NOT NULL,
	`approved_at` timestamp(3) NOT NULL,
	`closed_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `loans_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_loan_principal_positive` CHECK(`loans`.`principal_amount` > 0),
	CONSTRAINT `chk_loan_installment_count` CHECK(`loans`.`installment_count` between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE `overtime_approval_actions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`overtime_record_id` bigint unsigned NOT NULL,
	`actor_user_account_id` bigint unsigned NOT NULL,
	`action` enum('submitted','forwarded','approved','rejected','overridden','type_changed','cancelled') NOT NULL,
	`remark` text,
	`acted_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `overtime_approval_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `overtime_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`work_day_record_id` bigint unsigned,
	`overtime_date` date NOT NULL,
	`overtime_type` enum('rest_day','hourly','public_holiday') NOT NULL,
	`hours` decimal(6,2),
	`day_units` decimal(4,2),
	`reason` text,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`requested_by_user_account_id` bigint unsigned NOT NULL,
	`submitted_at` timestamp(3) NOT NULL DEFAULT (now()),
	`decided_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `overtime_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `overtime_records_employee_date_uidx` UNIQUE(`employee_id`,`overtime_date`),
	CONSTRAINT `chk_overtime_value_by_type` CHECK((`overtime_records`.`overtime_type` = 'hourly' and `overtime_records`.`hours` > 0 and `overtime_records`.`day_units` is null) or (`overtime_records`.`overtime_type` in ('rest_day', 'public_holiday') and `overtime_records`.`day_units` > 0 and `overtime_records`.`day_units` <= 1 and `overtime_records`.`hours` is null))
);
--> statement-breakpoint
CREATE TABLE `payroll_adjustments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`original_payroll_record_id` bigint unsigned NOT NULL,
	`applied_payroll_period_id` bigint unsigned,
	`direction` enum('earning','deduction') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`reason` text NOT NULL,
	`status` enum('pending','approved','rejected','applied') NOT NULL DEFAULT 'pending',
	`requested_by_user_account_id` bigint unsigned NOT NULL,
	`requested_at` timestamp(3) NOT NULL DEFAULT (now()),
	`approved_by_user_account_id` bigint unsigned,
	`approved_at` timestamp(3),
	`applied_payroll_item_id` bigint unsigned,
	CONSTRAINT `payroll_adjustments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_adjustments_applied_payroll_item_id_unique` UNIQUE(`applied_payroll_item_id`),
	CONSTRAINT `chk_adjustment_amount_positive` CHECK(`payroll_adjustments`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `payroll_configurations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`branch_id` bigint unsigned,
	`config_key` varchar(50) NOT NULL,
	`numeric_value` decimal(14,4) NOT NULL,
	`unit` varchar(30) NOT NULL,
	`effective_from` date NOT NULL,
	`effective_to` date,
	`created_by_user_account_id` bigint unsigned NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payroll_configurations_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_configurations_scope_key_from_uidx` UNIQUE(`shop_id`,`branch_id`,`config_key`,`effective_from`),
	CONSTRAINT `chk_config_value_nonnegative` CHECK(`payroll_configurations`.`numeric_value` >= 0),
	CONSTRAINT `chk_payroll_config_period` CHECK(`payroll_configurations`.`effective_to` is null or `payroll_configurations`.`effective_to` >= `payroll_configurations`.`effective_from`)
);
--> statement-breakpoint
CREATE TABLE `payroll_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`payroll_record_id` bigint unsigned NOT NULL,
	`item_type` enum('base_salary','welfare','overtime_rest_day','overtime_hourly','overtime_public_holiday','absence','lateness','sick_unpaid','social_security','advance','loan_installment','debt','adjustment','other') NOT NULL,
	`direction` enum('earning','deduction') NOT NULL,
	`description` varchar(255) NOT NULL,
	`quantity` decimal(10,2),
	`rate` decimal(14,4),
	`amount` decimal(12,2) NOT NULL,
	`payroll_configuration_id` bigint unsigned,
	`source_table` varchar(80),
	`source_id` bigint unsigned,
	`occurred_on` date,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payroll_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_payroll_item_amount` CHECK(`payroll_items`.`amount` >= 0),
	CONSTRAINT `chk_payroll_item_quantity` CHECK(`payroll_items`.`quantity` is null or `payroll_items`.`quantity` >= 0),
	CONSTRAINT `chk_payroll_item_rate` CHECK(`payroll_items`.`rate` is null or `payroll_items`.`rate` >= 0),
	CONSTRAINT `chk_payroll_item_source_pair` CHECK((`payroll_items`.`source_table` is null) = (`payroll_items`.`source_id` is null))
);
--> statement-breakpoint
CREATE TABLE `payroll_periods` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`period_year` smallint NOT NULL,
	`period_month` smallint NOT NULL,
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`status` enum('draft','previewed','locked') NOT NULL DEFAULT 'draft',
	`created_by_user_account_id` bigint unsigned NOT NULL,
	`previewed_at` timestamp(3),
	`locked_by_user_account_id` bigint unsigned,
	`locked_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payroll_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_periods_shop_year_month_uidx` UNIQUE(`shop_id`,`period_year`,`period_month`),
	CONSTRAINT `chk_payroll_month` CHECK(`payroll_periods`.`period_month` between 1 and 12),
	CONSTRAINT `chk_payroll_period_dates` CHECK(`payroll_periods`.`end_date` >= `payroll_periods`.`start_date`)
);
--> statement-breakpoint
CREATE TABLE `payroll_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`payroll_period_id` bigint unsigned NOT NULL,
	`employee_id` bigint unsigned NOT NULL,
	`employment_assignment_id` bigint unsigned NOT NULL,
	`status` enum('draft','calculated','locked') NOT NULL DEFAULT 'draft',
	`base_salary_snapshot` decimal(12,2) NOT NULL,
	`welfare_snapshot` decimal(12,2) NOT NULL DEFAULT 0,
	`total_earnings` decimal(12,2) NOT NULL DEFAULT 0,
	`total_deductions` decimal(12,2) NOT NULL DEFAULT 0,
	`net_pay` decimal(12,2) NOT NULL DEFAULT 0,
	`calculated_at` timestamp(3),
	`calculated_by_user_account_id` bigint unsigned,
	`locked_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payroll_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_records_period_employee_uidx` UNIQUE(`payroll_period_id`,`employee_id`),
	CONSTRAINT `chk_payroll_base_salary` CHECK(`payroll_records`.`base_salary_snapshot` >= 0),
	CONSTRAINT `chk_payroll_welfare` CHECK(`payroll_records`.`welfare_snapshot` >= 0),
	CONSTRAINT `chk_total_earnings` CHECK(`payroll_records`.`total_earnings` >= 0),
	CONSTRAINT `chk_total_deductions` CHECK(`payroll_records`.`total_deductions` >= 0),
	CONSTRAINT `chk_net_pay_nonnegative` CHECK(`payroll_records`.`net_pay` >= 0),
	CONSTRAINT `chk_payroll_totals` CHECK(`payroll_records`.`net_pay` = `payroll_records`.`total_earnings` - `payroll_records`.`total_deductions`)
);
--> statement-breakpoint
CREATE TABLE `email_delivery_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`payslip_id` bigint unsigned NOT NULL,
	`recipient_email` varchar(255) NOT NULL,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`provider_message_id` varchar(255),
	`attempted_at` timestamp(3) NOT NULL DEFAULT (now()),
	`sent_at` timestamp(3),
	`error_message` text,
	CONSTRAINT `email_delivery_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`payroll_record_id` bigint unsigned NOT NULL,
	`file_storage_key` text NOT NULL,
	`file_sha256` varchar(64) NOT NULL,
	`status` enum('generated','voided') NOT NULL DEFAULT 'generated',
	`generated_at` timestamp(3) NOT NULL DEFAULT (now()),
	`generated_by_user_account_id` bigint unsigned,
	`voided_at` timestamp(3),
	`voided_by_user_account_id` bigint unsigned,
	CONSTRAINT `payslips_id` PRIMARY KEY(`id`),
	CONSTRAINT `payslips_payroll_record_id_unique` UNIQUE(`payroll_record_id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`shop_id` bigint unsigned NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(100) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `positions_shop_code_uidx` UNIQUE(`shop_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` smallint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(100) NOT NULL,
	`scope` enum('self','department','branch','all') NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(150) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `shops_id` PRIMARY KEY(`id`),
	CONSTRAINT `shops_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `user_account_roles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_account_id` bigint unsigned NOT NULL,
	`role_id` smallint unsigned NOT NULL,
	`branch_id` bigint unsigned,
	`department_id` bigint unsigned,
	`granted_by_user_account_id` bigint unsigned,
	`granted_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `user_account_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_account_roles_scope_uidx` UNIQUE(`user_account_id`,`role_id`,`branch_id`,`department_id`)
);
--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`employee_id` bigint unsigned,
	`username` varchar(100) NOT NULL,
	`password_hash` text NOT NULL,
	`status` enum('active','locked','disabled') NOT NULL DEFAULT 'active',
	`failed_login_attempts` smallint NOT NULL DEFAULT 0,
	`locked_until` timestamp(3),
	`last_login_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `user_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_accounts_employee_id_unique` UNIQUE(`employee_id`),
	CONSTRAINT `user_accounts_username_unique` UNIQUE(`username`),
	CONSTRAINT `chk_login_attempts_nonnegative` CHECK(`user_accounts`.`failed_login_attempts` >= 0)
);
--> statement-breakpoint
ALTER TABLE `advance_requests` ADD CONSTRAINT `advance_requests_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `advance_requests` ADD CONSTRAINT `advance_requests_decided_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`decided_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `advance_requests` ADD CONSTRAINT `advance_req_requested_by_fk` FOREIGN KEY (`requested_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_leave_request_id_leave_requests_id_fk` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_uploaded_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`uploaded_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `work_day_records` ADD CONSTRAINT `work_day_records_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `work_day_records` ADD CONSTRAINT `work_day_records_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `work_day_records` ADD CONSTRAINT `work_day_records_created_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`created_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_account_id_user_accounts_id_fk` FOREIGN KEY (`actor_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `branch_schedule_overrides` ADD CONSTRAINT `branch_schedule_overrides_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `branch_schedule_overrides` ADD CONSTRAINT `branch_sched_override_created_by_fk` FOREIGN KEY (`created_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `branch_schedules` ADD CONSTRAINT `branch_schedules_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `debt_transactions` ADD CONSTRAINT `debt_transactions_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `debt_transactions` ADD CONSTRAINT `debt_transactions_debt_type_id_debt_types_id_fk` FOREIGN KEY (`debt_type_id`) REFERENCES `debt_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `debt_transactions` ADD CONSTRAINT `debt_tx_original_fk` FOREIGN KEY (`original_transaction_id`) REFERENCES `debt_transactions`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `debt_transactions` ADD CONSTRAINT `debt_tx_recorded_by_fk` FOREIGN KEY (`recorded_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `debt_transactions` ADD CONSTRAINT `debt_tx_settled_payroll_fk` FOREIGN KEY (`settled_in_payroll_record_id`) REFERENCES `payroll_records`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `departments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employee_bank_accounts` ADD CONSTRAINT `employee_bank_accounts_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employee_weekly_holidays` ADD CONSTRAINT `employee_weekly_holidays_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employment_assignments` ADD CONSTRAINT `employment_assignments_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employment_assignments` ADD CONSTRAINT `employment_assignments_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employment_assignments` ADD CONSTRAINT `employment_assignments_department_id_departments_id_fk` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employment_assignments` ADD CONSTRAINT `employment_assignments_position_id_positions_id_fk` FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `employment_assignments` ADD CONSTRAINT `employment_assignment_created_by_fk` FOREIGN KEY (`created_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `holiday_calendars` ADD CONSTRAINT `holiday_calendars_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `holiday_calendars` ADD CONSTRAINT `holiday_calendars_created_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`created_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_approval_actions` ADD CONSTRAINT `leave_approval_actions_leave_request_id_leave_requests_id_fk` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_approval_actions` ADD CONSTRAINT `leave_approval_actions_actor_user_account_id_user_accounts_id_fk` FOREIGN KEY (`actor_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_approval_actions` ADD CONSTRAINT `leave_approval_actions_from_leave_type_id_leave_types_id_fk` FOREIGN KEY (`from_leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_approval_actions` ADD CONSTRAINT `leave_approval_actions_to_leave_type_id_leave_types_id_fk` FOREIGN KEY (`to_leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_quotas` ADD CONSTRAINT `leave_quotas_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_quotas` ADD CONSTRAINT `leave_quotas_leave_type_id_leave_types_id_fk` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_request_days` ADD CONSTRAINT `leave_request_days_leave_request_id_leave_requests_id_fk` FOREIGN KEY (`leave_request_id`) REFERENCES `leave_requests`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_request_days` ADD CONSTRAINT `leave_request_days_work_day_record_id_work_day_records_id_fk` FOREIGN KEY (`work_day_record_id`) REFERENCES `work_day_records`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_request_days` ADD CONSTRAINT `leave_request_days_leave_type_id_leave_types_id_fk` FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_original_leave_type_id_leave_types_id_fk` FOREIGN KEY (`original_leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_final_leave_type_id_leave_types_id_fk` FOREIGN KEY (`final_leave_type_id`) REFERENCES `leave_types`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_submitted_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`submitted_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `loan_installments` ADD CONSTRAINT `loan_installments_loan_id_loans_id_fk` FOREIGN KEY (`loan_id`) REFERENCES `loans`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `loan_installments` ADD CONSTRAINT `loan_installments_payroll_record_id_payroll_records_id_fk` FOREIGN KEY (`payroll_record_id`) REFERENCES `payroll_records`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `loans` ADD CONSTRAINT `loans_approved_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`approved_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_approval_actions` ADD CONSTRAINT `ot_action_record_fk` FOREIGN KEY (`overtime_record_id`) REFERENCES `overtime_records`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_approval_actions` ADD CONSTRAINT `ot_action_actor_fk` FOREIGN KEY (`actor_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_records` ADD CONSTRAINT `overtime_records_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_records` ADD CONSTRAINT `overtime_records_work_day_record_id_work_day_records_id_fk` FOREIGN KEY (`work_day_record_id`) REFERENCES `work_day_records`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `overtime_records` ADD CONSTRAINT `ot_record_requested_by_fk` FOREIGN KEY (`requested_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adjustments_applied_payroll_item_id_payroll_items_id_fk` FOREIGN KEY (`applied_payroll_item_id`) REFERENCES `payroll_items`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adj_original_record_fk` FOREIGN KEY (`original_payroll_record_id`) REFERENCES `payroll_records`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adj_applied_period_fk` FOREIGN KEY (`applied_payroll_period_id`) REFERENCES `payroll_periods`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adj_requested_by_fk` FOREIGN KEY (`requested_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_adjustments` ADD CONSTRAINT `payroll_adj_approved_by_fk` FOREIGN KEY (`approved_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_configurations` ADD CONSTRAINT `payroll_configurations_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_configurations` ADD CONSTRAINT `payroll_configurations_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_configurations` ADD CONSTRAINT `payroll_config_created_by_fk` FOREIGN KEY (`created_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_payroll_record_id_payroll_records_id_fk` FOREIGN KEY (`payroll_record_id`) REFERENCES `payroll_records`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_item_config_fk` FOREIGN KEY (`payroll_configuration_id`) REFERENCES `payroll_configurations`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_periods` ADD CONSTRAINT `payroll_periods_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_periods` ADD CONSTRAINT `payroll_periods_created_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`created_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_periods` ADD CONSTRAINT `payroll_periods_locked_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`locked_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_records` ADD CONSTRAINT `payroll_records_payroll_period_id_payroll_periods_id_fk` FOREIGN KEY (`payroll_period_id`) REFERENCES `payroll_periods`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_records` ADD CONSTRAINT `payroll_records_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_records` ADD CONSTRAINT `payroll_record_assignment_fk` FOREIGN KEY (`employment_assignment_id`) REFERENCES `employment_assignments`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payroll_records` ADD CONSTRAINT `payroll_record_calculated_by_fk` FOREIGN KEY (`calculated_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `email_delivery_logs` ADD CONSTRAINT `email_delivery_logs_payslip_id_payslips_id_fk` FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_payroll_record_id_payroll_records_id_fk` FOREIGN KEY (`payroll_record_id`) REFERENCES `payroll_records`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_generated_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`generated_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_voided_by_user_account_id_user_accounts_id_fk` FOREIGN KEY (`voided_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `positions` ADD CONSTRAINT `positions_shop_id_shops_id_fk` FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_account_roles` ADD CONSTRAINT `user_account_roles_user_account_id_user_accounts_id_fk` FOREIGN KEY (`user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_account_roles` ADD CONSTRAINT `user_account_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_account_roles` ADD CONSTRAINT `user_account_roles_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_account_roles` ADD CONSTRAINT `user_account_roles_department_id_departments_id_fk` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_account_roles` ADD CONSTRAINT `account_role_granted_by_fk` FOREIGN KEY (`granted_by_user_account_id`) REFERENCES `user_accounts`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD CONSTRAINT `user_accounts_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `advance_requests_status_idx` ON `advance_requests` (`status`);--> statement-breakpoint
CREATE INDEX `attachments_employee_idx` ON `attachments` (`employee_id`);--> statement-breakpoint
CREATE INDEX `attachments_leave_request_idx` ON `attachments` (`leave_request_id`);--> statement-breakpoint
CREATE INDEX `work_day_records_branch_date_idx` ON `work_day_records` (`branch_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `work_day_records_status_idx` ON `work_day_records` (`status`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_occurred_idx` ON `audit_logs` (`table_name`,`record_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_occurred_idx` ON `audit_logs` (`actor_user_account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `branches_shop_idx` ON `branches` (`shop_id`);--> statement-breakpoint
CREATE INDEX `debt_transactions_employee_date_idx` ON `debt_transactions` (`employee_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `debt_transactions_employee_settled_idx` ON `debt_transactions` (`employee_id`,`settled_at`);--> statement-breakpoint
CREATE INDEX `debt_transactions_type_idx` ON `debt_transactions` (`debt_type_id`);--> statement-breakpoint
CREATE INDEX `departments_branch_idx` ON `departments` (`branch_id`);--> statement-breakpoint
CREATE INDEX `employee_bank_accounts_employee_idx` ON `employee_bank_accounts` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employment_assignments_branch_department_idx` ON `employment_assignments` (`branch_id`,`department_id`);--> statement-breakpoint
CREATE INDEX `employment_assignments_position_idx` ON `employment_assignments` (`position_id`);--> statement-breakpoint
CREATE INDEX `leave_approval_actions_request_acted_idx` ON `leave_approval_actions` (`leave_request_id`,`acted_at`);--> statement-breakpoint
CREATE INDEX `leave_approval_actions_actor_idx` ON `leave_approval_actions` (`actor_user_account_id`);--> statement-breakpoint
CREATE INDEX `leave_request_days_date_type_idx` ON `leave_request_days` (`leave_date`,`leave_type_id`);--> statement-breakpoint
CREATE INDEX `leave_requests_employee_period_idx` ON `leave_requests` (`employee_id`,`start_date`,`end_date`);--> statement-breakpoint
CREATE INDEX `leave_requests_status_idx` ON `leave_requests` (`status`);--> statement-breakpoint
CREATE INDEX `loan_installments_due_status_idx` ON `loan_installments` (`due_period_start`,`status`);--> statement-breakpoint
CREATE INDEX `loans_employee_status_idx` ON `loans` (`employee_id`,`status`);--> statement-breakpoint
CREATE INDEX `overtime_approval_actions_record_acted_idx` ON `overtime_approval_actions` (`overtime_record_id`,`acted_at`);--> statement-breakpoint
CREATE INDEX `overtime_records_status_idx` ON `overtime_records` (`status`);--> statement-breakpoint
CREATE INDEX `payroll_adjustments_original_status_idx` ON `payroll_adjustments` (`original_payroll_record_id`,`status`);--> statement-breakpoint
CREATE INDEX `payroll_configurations_key_from_idx` ON `payroll_configurations` (`config_key`,`effective_from`);--> statement-breakpoint
CREATE INDEX `payroll_items_record_direction_idx` ON `payroll_items` (`payroll_record_id`,`direction`);--> statement-breakpoint
CREATE INDEX `payroll_items_source_idx` ON `payroll_items` (`source_table`,`source_id`);--> statement-breakpoint
CREATE INDEX `payroll_periods_status_idx` ON `payroll_periods` (`status`);--> statement-breakpoint
CREATE INDEX `payroll_records_employee_idx` ON `payroll_records` (`employee_id`);--> statement-breakpoint
CREATE INDEX `email_delivery_logs_payslip_attempted_idx` ON `email_delivery_logs` (`payslip_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `email_delivery_logs_status_idx` ON `email_delivery_logs` (`status`);--> statement-breakpoint
CREATE INDEX `user_account_roles_user_idx` ON `user_account_roles` (`user_account_id`);--> statement-breakpoint
CREATE INDEX `user_account_roles_role_idx` ON `user_account_roles` (`role_id`);