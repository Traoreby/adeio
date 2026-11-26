import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type EncryptedMemberToken = {
  tokenHash: string;
  encryptedToken: string;
  nonce: string;
  tag: string;
  keyVersion: string;
};

function encryptionKey(version: string) {
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(version)) throw new Error("Version de clé QR invalide.");
  const currentVersion = process.env.ADEIO_QR_ENCRYPTION_KEY_VERSION?.trim() || "1";
  const versionedName = `ADEIO_QR_ENCRYPTION_KEY_V${version}`;
  const encoded = process.env[versionedName]?.trim()
    || (version === currentVersion ? process.env.ADEIO_QR_ENCRYPTION_KEY?.trim() : undefined);
  if (!encoded) throw new Error(`La clé serveur ${versionedName} n’est pas configurée.`);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error(`${versionedName} doit être une clé Base64 standard de 32 octets.`);
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encoded) {
    throw new Error(`${versionedName} doit être une clé Base64 standard de 32 octets.`);
  }
  return key;
}

export function issueMemberToken() {
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(12);
  const keyVersion = process.env.ADEIO_QR_ENCRYPTION_KEY_VERSION?.trim() || "1";
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyVersion), nonce);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    tokenHash: createHash("sha256").update(token).digest("hex"),
    encryptedToken: encrypted.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  } satisfies EncryptedMemberToken;
}

export function decryptMemberToken(value: EncryptedMemberToken) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(value.keyVersion), Buffer.from(value.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  const token = Buffer.concat([
    decipher.update(Buffer.from(value.encryptedToken, "base64")),
    decipher.final(),
  ]).toString("utf8");
  if (!/^[a-f0-9]{64}$/.test(token) || createHash("sha256").update(token).digest("hex") !== value.tokenHash) {
    throw new Error("Le jeton QR ADEIO est illisible ou ne correspond pas à son empreinte.");
  }
  return token;
}
