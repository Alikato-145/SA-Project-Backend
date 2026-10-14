import { pool, closeDatabase } from "../src/core/db/client";
import { createDocumentStorage } from "../src/core/storage/document-storage";
import { bankKeyringFromEnv, createBankAccountCipher } from "../src/features/employee-bank-account/employee-bank-account.crypto";

try {
  const storage=createDocumentStorage();
  const files=await pool.query<{file_storage_key:string;file_sha256:string}>("select file_storage_key,file_sha256 from payslips union all select storage_key as file_storage_key,file_sha256 from attachments");
  let verified=0,legacy=0;
  for(const file of files.rows) {
    if(file.file_storage_key.endsWith(".json")){legacy++;continue;}
    await storage.read(file.file_storage_key,file.file_sha256);verified++;
  }
  const accounts=await pool.query<{account_number_ciphertext:string}>("select account_number_ciphertext from employee_bank_accounts");
  const cipher=createBankAccountCipher(bankKeyringFromEnv());
  for(const account of accounts.rows)await cipher.decrypt(account.account_number_ciphertext);
  const counts:Record<string,string>={};
  for(const table of ["employees","employment_assignments","work_day_records","leave_requests","leave_approval_actions","overtime_approval_actions","debt_transactions","loan_installments","payroll_records","payroll_items","payroll_adjustments","payslips","attachments","email_delivery_logs","audit_logs"]) {
    counts[table]=(await pool.query<{count:string}>(`select count(*)::text as count from ${table}`)).rows[0]!.count;
  }
  console.info(JSON.stringify({documents_verified:verified,legacy_metadata_payslips:legacy,bank_accounts_decrypted:accounts.rowCount,counts},null,2));
} finally {await closeDatabase();}
