/**
 * Semaphore identity and local-storage helpers.
 *
 * Keep this module independent from group/proof code so identity-only routes
 * do not pull the SNARK toolchain into their client bundle.
 */

import { Identity } from "@semaphore-protocol/identity";

const IDENTITY_STORAGE_KEY = "hometown-dao-identity";
const IDENTITY_BACKUP_KEY = "hometown-dao-identity-backup";

/**
 * Generate a new Semaphore identity.
 * The identity is generated locally and never sent to a server.
 */
export function generateIdentity(): Identity {
  return new Identity();
}

/** Get the public identity commitment. */
export function getCommitment(identity: Identity): string {
  return identity.commitment.toString();
}

/**
 * Save an identity to localStorage.
 * WARNING: The password encoding here is demo-only and is not encryption.
 */
export function saveIdentity(identity: Identity, password?: string): void {
  if (typeof window === "undefined") return;

  try {
    const identityString = identity.toString();

    if (password) {
      // In production, implement proper encryption here.
      const encoded = btoa(identityString + ":" + password);
      localStorage.setItem(IDENTITY_STORAGE_KEY, encoded);
    } else {
      localStorage.setItem(IDENTITY_STORAGE_KEY, identityString);
    }

    const timestamp = new Date().toISOString();
    localStorage.setItem(
      IDENTITY_BACKUP_KEY,
      JSON.stringify({ identity: identityString, timestamp }),
    );

    console.log("✅ Identity saved successfully");
  } catch (error) {
    console.error("❌ Failed to save identity:", error);
    throw new Error("Failed to save identity");
  }
}

/** Load an identity from localStorage. */
export function loadIdentity(password?: string): Identity | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (!stored) return null;

    let identityString = stored;
    if (password) {
      // In production, implement proper decryption here.
      const decoded = atob(stored);
      const [identity, storedPassword] = decoded.split(":");
      if (storedPassword !== password) throw new Error("Invalid password");
      identityString = identity;
    }

    return new Identity(identityString);
  } catch (error) {
    console.error("❌ Failed to load identity:", error);
    return null;
  }
}

/** Check whether an identity is present in localStorage. */
export function hasIdentity(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(IDENTITY_STORAGE_KEY) !== null;
}

/** Export an identity backup using the existing demo encoding. */
export function exportIdentity(identity: Identity, password: string): string {
  const identityString = identity.toString();
  const data = JSON.stringify({
    identity: identityString,
    commitment: identity.commitment.toString(),
    timestamp: new Date().toISOString(),
    version: "1.0",
  });

  // In production, use proper encryption here.
  return btoa(data + ":" + password);
}

/** Import an identity from an exported backup. */
export function importIdentity(
  encryptedData: string,
  password: string,
): Identity {
  try {
    const decoded = atob(encryptedData);
    const [data, storedPassword] = decoded.split(":");

    if (storedPassword !== password) throw new Error("Invalid password");

    const parsed = JSON.parse(data);
    return new Identity(parsed.identity);
  } catch (error) {
    console.error("❌ Failed to import identity:", error);
    throw new Error("Failed to import identity. Check your password.");
  }
}

/** Delete the locally stored identity and backup. */
export function deleteIdentity(): void {
  if (typeof window === "undefined") return;

  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  localStorage.removeItem(IDENTITY_BACKUP_KEY);
  console.log("🗑️ Identity deleted");
}

/** Format identity information for the identity page. */
export function formatIdentityInfo(identity: Identity) {
  return {
    commitment: identity.commitment.toString(),
    // Semaphore v4 uses EdDSA: the private key is the secret to back up.
    privateKey: identity.toString(),
  };
}

/** Generate a deterministic identity from a secret phrase. */
export function generateIdentityFromSecret(secret: string): Identity {
  return new Identity(secret);
}

/** Validate an identity commitment against the SNARK scalar field. */
export function isValidCommitment(commitment: string): boolean {
  try {
    const num = BigInt(commitment);
    const snarkFieldSize = BigInt(
      "21888242871839275222246405745257275088548364400416034343698204186575808495617",
    );
    return num > 0n && num < snarkFieldSize;
  } catch {
    return false;
  }
}

/** Get the age of the locally stored identity backup in milliseconds. */
export function getIdentityAge(): number | null {
  if (typeof window === "undefined") return null;

  const backup = localStorage.getItem(IDENTITY_BACKUP_KEY);
  if (!backup) return null;

  try {
    const { timestamp } = JSON.parse(backup);
    const created = new Date(timestamp);
    return new Date().getTime() - created.getTime();
  } catch {
    return null;
  }
}
