import { eq, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../core/db/transaction";
import { roles } from "../role/role.schema";
import type { SystemRole } from "../role/role.bootstrap";
import { userAccounts, userAccountRoles } from "./user-account.schema";
import { auditLogs } from "../audit/audit.schema";

export const ownerBootstrapRepository={
  async lock(executor:DatabaseExecutor) { await executor.execute(sql`select pg_advisory_xact_lock(hashtext('initial-owner-bootstrap'))`); },
  async hasAccounts(executor:DatabaseExecutor) { return Boolean(await executor.query.userAccounts.findFirst({columns:{id:true}})); },
  async ensureRole(executor:DatabaseExecutor,role:SystemRole) {
    const existing=await executor.query.roles.findFirst({where:eq(roles.code,role.code)});
    if(!existing){await executor.insert(roles).values(role);return;}
    if(existing.name!==role.name||existing.scope!==role.scope||!existing.isActive)throw new Error("System role catalog mismatch");
  },
  async insertOwner(executor:DatabaseExecutor,username:string,passwordHash:string) {
    const owner=await executor.query.roles.findFirst({where:eq(roles.code,"OWNER")});
    if(!owner)throw new Error("Owner role is missing");
    const [account]=await executor.insert(userAccounts).values({username,passwordHash,status:"active"}).returning({id:userAccounts.id});
    if(!account)throw new Error("Initial owner creation failed");
    await executor.insert(userAccountRoles).values({userAccountId:account.id,roleId:owner.id});
    return account;
  },
  async audit(executor:DatabaseExecutor,id:number,username:string) {
    await executor.insert(auditLogs).values({actorUserAccountId:id,action:"account.owner-bootstrap.create.succeeded",tableName:"user_accounts",recordId:String(id),newData:{username,role_code:"OWNER"},reason:"Controlled initial owner provisioning",requestId:crypto.randomUUID()});
  },
};
