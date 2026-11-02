import crypto from "crypto";
import config from "../config";

// AES-256-GCM encryption for tenant-supplied credentials at rest. The
// configured key string is hashed to a 32-byte key so any passphrase works.
// Format: base64(iv).base64(authTag).base64(ciphertext).
const key = crypto.createHash("sha256").update(config.CREDENTIALS_ENCRYPTION_KEY).digest();

export const encryptSecret = (plaintext: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
};

export const decryptSecret = (token: string): string => {
  const [ivB64, tagB64, dataB64] = String(token || "").split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

// Columns that predate encryption hold plaintext. Sealed values carry this
// prefix, so readers can tell the two apart and old rows keep working.
const SEALED = "enc:v1:";

/** Encrypts a value for a column that may also hold legacy plaintext. */
export const sealSecret = (plaintext: string): string => `${SEALED}${encryptSecret(plaintext)}`;

/** Decrypts a sealed value; returns legacy plaintext unchanged. */
export const openSecret = (stored: string): string =>
  stored.startsWith(SEALED) ? decryptSecret(stored.slice(SEALED.length)) : stored;

export const isSealed = (stored: string): boolean => stored.startsWith(SEALED);
