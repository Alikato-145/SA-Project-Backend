import { readFile,stat } from "node:fs/promises";
import { closeDatabase } from "../src/core/db/client";
import { bootstrapInitialOwner } from "../src/features/user-account/user-account.owner-bootstrap.service";
try {
  const path=process.env.INITIAL_OWNER_PASSWORD_FILE;
  if(!path||!process.env.INITIAL_OWNER_USERNAME)throw new Error("INITIAL_OWNER_USERNAME and INITIAL_OWNER_PASSWORD_FILE are required");
  const file=await stat(path);
  if(!file.isFile()||(file.mode&0o077)!==0||file.size>4096)throw new Error("Password file must be a private regular file (chmod 600)");
  const password=(await readFile(path,"utf8")).replace(/\r?\n$/,"");
  const account=await bootstrapInitialOwner({username:process.env.INITIAL_OWNER_USERNAME,password});
  console.info(JSON.stringify({initial_owner_created:account.id,username:account.username}));
} finally {await closeDatabase();}
