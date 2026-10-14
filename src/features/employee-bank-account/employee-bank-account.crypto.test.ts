import {describe,expect,test} from "bun:test";import {createBankAccountCipher} from "./employee-bank-account.crypto";
const key=crypto.getRandomValues(new Uint8Array(32));const cipher=createBankAccountCipher({activeVersion:"v1",keys:{v1:key}});
test("key rotation reads historical envelopes and re-encrypts before the old key is retired",async()=>{
  const historical=await cipher.encrypt("1234567890");
  const nextKey=crypto.getRandomValues(new Uint8Array(32));
  const rotating=createBankAccountCipher({activeVersion:"v2",keys:{v1:key,v2:nextKey}});
  expect(await rotating.decrypt(historical)).toBe("1234567890");
  const migrated=await rotating.encrypt(await rotating.decrypt(historical));
  expect(migrated.startsWith("a256gcm.v2.")).toBe(true);
  const retired=createBankAccountCipher({activeVersion:"v2",keys:{v2:nextKey}});
  expect(await retired.decrypt(migrated)).toBe("1234567890");
  await expect(retired.decrypt(historical)).rejects.toThrow("Unknown bank encryption key version");
});
describe("bank encryption",()=>{test("round trips with a random authenticated versioned envelope",async()=>{const a=await cipher.encrypt("1234567890"),b=await cipher.encrypt("1234567890");expect(a).not.toBe(b);expect(a.startsWith("a256gcm.v1.")).toBe(true);expect(await cipher.decrypt(a)).toBe("1234567890")});test("fails closed for tampering and unknown key version",async()=>{const value=await cipher.encrypt("1234567890");await expect(cipher.decrypt(value.slice(0,-2)+"aa")).rejects.toThrow();await expect(cipher.decrypt(value.replace(".v1.",".old."))).rejects.toThrow("Unknown bank encryption key version")});test("rejects non-32-byte keys",()=>{expect(()=>createBankAccountCipher({activeVersion:"v1",keys:{v1:new Uint8Array(31)}})).toThrow()})});
