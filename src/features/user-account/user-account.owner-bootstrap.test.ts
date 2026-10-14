import { test,expect } from "bun:test";
import { bootstrapInitialOwner } from "./user-account.owner-bootstrap.service";
test("initial owner setup refuses an existing account database and audits only non-secret facts",async()=>{
  let existing=false;const calls:string[]=[];
  const dependencies={runner:{async transaction<T>(work:(executor:never)=>Promise<T>){return work({} as never);}},hash:async()=>"hashed",
    repository:{async lock(){},async hasAccounts(){return existing;},async ensureRole(){calls.push("role");},async insertOwner(){calls.push("account");return {id:1};},async audit(){calls.push("audit");}}};
  expect(await bootstrapInitialOwner({username:"owner",password:"test-password"},dependencies)).toEqual({id:"1",username:"owner"});
  expect(calls).toEqual(["role","role","role","role","role","account","audit"]);
  existing=true;calls.length=0;
  await expect(bootstrapInitialOwner({username:"owner",password:"test-password"},dependencies)).rejects.toMatchObject({code:"STATE_CONFLICT"});
  expect(calls).toEqual([]);
});
