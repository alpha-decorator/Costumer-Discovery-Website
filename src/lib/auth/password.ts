import { randomBytes, scrypt, timingSafeEqual, type BinaryLike, type ScryptOptions } from "node:crypto";

// scrypt (memory-hard) with parameters taken from OWASP's password storage guidance. They are stored inside each
// hash, so they can be raised later without invalidating existing passwords.
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 3;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC") as BinaryLike, salt, length, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

const memoryLimit = (cost: number, blockSize: number, parallelism: number) => 128 * cost * blockSize * parallelism + 16 * 1024 * 1024;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: memoryLimit(COST, BLOCK_SIZE, PARALLELISM) });
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [cost, blockSize, parallelism] = parts.slice(1, 4).map(Number);
  if (![cost, blockSize, parallelism].every((value) => Number.isInteger(value) && value > 0) || cost > 2 ** 17 || blockSize > 16 || parallelism > 16) return false;
  const expected = Buffer.from(parts[5], "base64");
  if (!expected.length) return false;
  const key = await derive(password, Buffer.from(parts[4], "base64"), expected.length, { N: cost, r: blockSize, p: parallelism, maxmem: memoryLimit(cost, blockSize, parallelism) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummyHash: Promise<string> | undefined;

/** Spend the same time as a real check when the email is unknown, so response time does not reveal which emails exist. */
export async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
  return false;
}
