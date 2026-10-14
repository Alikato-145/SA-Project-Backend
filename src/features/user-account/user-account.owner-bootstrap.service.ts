import { db } from "../../core/db/client";
import type { TransactionRunner } from "../../core/db/transaction";
import { hashPassword } from "../../core/auth/password";
import { ApplicationError } from "../../core/errors/application.error";
import { ensureSystemRoles } from "../role/role.bootstrap";
import { ownerBootstrapRepository } from "./user-account.owner-bootstrap.repository";

export const bootstrapInitialOwner=async(command:{username:string;password:string},dependencies:{runner?:TransactionRunner;repository?:typeof ownerBootstrapRepository;hash?:typeof hashPassword}={})=>{
  if(!/^[A-Za-z0-9_.-]{3,100}$/.test(command.username)||command.password.length<8||command.password.length>1024)throw new ApplicationError("VALIDATION_ERROR");
  const repository=dependencies.repository ?? ownerBootstrapRepository;
  const passwordHash=await (dependencies.hash ?? hashPassword)(command.password);
  return (dependencies.runner ?? db).transaction(async executor=>{
    await repository.lock(executor);
    if(await repository.hasAccounts(executor))throw new ApplicationError("STATE_CONFLICT",{publicMessage:"Initial owner setup is allowed only on a database without accounts"});
    await ensureSystemRoles({ensureRole:role=>repository.ensureRole(executor,role)});
    const account=await repository.insertOwner(executor,command.username,passwordHash);
    await repository.audit(executor,account.id,command.username);
    return {id:String(account.id),username:command.username};
  });
};
