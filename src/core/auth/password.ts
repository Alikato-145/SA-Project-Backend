const ARGON2ID_OPTIONS = {
  algorithm: "argon2id",
  memoryCost: 65_536,
  timeCost: 3,
} as const;

// A random value prevents any submitted credential from accidentally matching.
// Its hash is initialized once per process and reused for every unknown account.
const dummyPasswordValue = crypto.randomUUID() + crypto.randomUUID();
const dummyPasswordHash = Bun.password.hash(
  dummyPasswordValue,
  ARGON2ID_OPTIONS,
);

export const hashPassword = (plainTextPassword: string): Promise<string> =>
  Bun.password.hash(plainTextPassword, ARGON2ID_OPTIONS);

export const verifyPassword = (
  plainTextPassword: string,
  passwordHash: string,
): Promise<boolean> =>
  Bun.password.verify(plainTextPassword, passwordHash, "argon2id");

/**
 * Performs the same expensive verification path used for a known account while
 * deliberately discarding the result. Submitted credentials are never retained.
 */
export const verifyPasswordForUnknownAccount = async (
  submittedPassword: string,
): Promise<false> => {
  await Bun.password.verify(
    submittedPassword,
    await dummyPasswordHash,
    "argon2id",
  );

  return false;
};

export const isArgon2idHash = (passwordHash: string): boolean =>
  passwordHash.startsWith("$argon2id$");
