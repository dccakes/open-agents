import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { getAuthConfig } from "@/lib/config/auth";
import {
  getLinearWorkspace,
  getLinearWorkspaceForOrganization,
} from "@/lib/db/linear-workspaces";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

function getEncryptionKey(): Buffer {
  const { secret } = getAuthConfig();
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return scryptSync(secret, "linear-token-salt", 32) as Buffer;
}

export function encryptLinearToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptLinearToken(encryptedToken: string): string {
  const key = getEncryptionKey();
  const parts = encryptedToken.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  const [ivB64, authTagB64, encryptedB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}

export async function getLinearWorkspaceToken(): Promise<string | null> {
  // Resolved by organization, falling back to the age-ordered lookup only
  // while the seeder has not yet claimed the existing row.
  const organizationId = await getSeededOrganizationId();
  const workspace = organizationId
    ? await getLinearWorkspaceForOrganization(organizationId)
    : await getLinearWorkspace();
  if (!workspace) return null;

  try {
    return decryptLinearToken(workspace.accessToken);
  } catch (error) {
    console.error("Failed to decrypt Linear workspace token:", error);
    return null;
  }
}
