/**
 * Client-Side Encryption for Evidence Data
 *
 * Privacy-preserving encryption using TweetNaCl (NaCl crypto library)
 * - Symmetric encryption with XSalsa20-Poly1305
 * - Deterministic key derivation using EIP-712 typed data signing
 * - Only evidence creator can decrypt (via thirdweb account abstraction)
 * - GDPR-compliant: personal data never stored plaintext
 */

import nacl from 'tweetnacl';
import {
  decodeUTF8,
  encodeUTF8,
  encodeBase64,
  decodeBase64,
} from 'tweetnacl-util';
import type { Account } from 'thirdweb/wallets';
import type {
  PersonalData,
  EncryptedBlob,
  PublicMetadata,
  EncryptedEvidence,
  KeyDerivationResult,
  SessionKeyResult,
} from './verification-types';

/**
 * EIP-712 Domain for HomeTown DAO Evidence Encryption.
 *
 * DO NOT "migrate" this chainId to Gnosis. It is a DERIVATION CONSTANT, not a
 * chain reference: the signature over this domain is hashed into the encryption
 * key, and nothing ever verifies it on-chain. Changing 8453 changes every key
 * derived from it, which would silently make all previously encrypted evidence
 * undecryptable — with no error at the point of change.
 *
 * It reads like leftover Base config during a Base -> Gnosis sweep. It is not.
 * The value is arbitrary; only its STABILITY matters.
 */
const ENCRYPTION_DOMAIN = {
  name: 'HomeTown DAO Evidence Encryption',
  version: '1',
  chainId: 8453, // frozen forever — see above, this is not a Base reference
};

/**
 * EIP-712 Types for key derivation
 */
const ENCRYPTION_KEY_TYPES = {
  KeyDerivation: [
    { name: 'purpose', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

/**
 * Derive encryption key from EIP-712 typed data signature
 *
 * Uses deterministic EIP-712 signing for consistent key derivation:
 * - Same wallet + same timestamp → same signature → same key
 * - Works across desktop/mobile with thirdweb account abstraction
 * - Human-readable signature request in wallet
 *
 * @param account - Thirdweb account instance
 * @param timestamp - Optional timestamp for decryption (use stored value)
 * @returns Key and timestamp for encryption/decryption
 */
export async function deriveEncryptionKey(
  account: Account,
  timestamp?: number
): Promise<KeyDerivationResult> {
  console.log('🔐 Deriving encryption key from EIP-712 typed data signature...');

  try {
    // Use provided timestamp or generate new one
    const encryptionTimestamp = timestamp || Date.now();

    // EIP-712 message
    const message = {
      purpose: 'Encrypt HomeTown DAO Evidence',
      timestamp: encryptionTimestamp,
    };

    // Sign typed data (deterministic based on timestamp)
    const signature = await account.signTypedData({
      domain: ENCRYPTION_DOMAIN,
      types: ENCRYPTION_KEY_TYPES,
      primaryType: 'KeyDerivation',
      message,
    });

    // Use signature as entropy for NaCl secret key (32 bytes)
    // Remove '0x' prefix and take first 64 hex chars (32 bytes)
    const signatureHex = signature.slice(2, 66);
    const keyBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    // Ensure exactly 32 bytes
    if (keyBytes.length !== 32) {
      throw new Error(`Invalid key length: ${keyBytes.length} bytes (expected 32)`);
    }

    console.log('✅ Encryption key derived successfully');

    return {
      key: keyBytes,
      timestamp: encryptionTimestamp,
    };
  } catch (error) {
    console.error('❌ Failed to derive encryption key:', error);
    throw new Error(`Key derivation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Encrypt personal data with TweetNaCl
 *
 * @param data - Personal data to encrypt
 * @param key - Encryption key (from deriveEncryptionKey)
 * @returns Encrypted blob with ciphertext and nonce
 */
export function encryptPersonalData(
  data: PersonalData,
  key: Uint8Array
): EncryptedBlob {
  console.log('🔒 Encrypting personal data...');

  try {
    // Serialize data to JSON
    const plaintext = JSON.stringify(data);
    const plaintextBytes = decodeUTF8(plaintext);

    // Generate random nonce (24 bytes for XSalsa20-Poly1305)
    const nonce = nacl.randomBytes(24);

    // Encrypt with NaCl secretbox
    const ciphertextBytes = nacl.secretbox(plaintextBytes, nonce, key);

    // Encode to Base64 for storage
    const encrypted: EncryptedBlob = {
      ciphertext: encodeBase64(ciphertextBytes),
      nonce: encodeBase64(nonce),
    };

    console.log('✅ Data encrypted successfully');
    return encrypted;
  } catch (error) {
    console.error('❌ Encryption failed:', error);
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Decrypt personal data with TweetNaCl
 *
 * @param encrypted - Encrypted blob
 * @param key - Encryption key (from deriveEncryptionKey)
 * @returns Decrypted personal data
 */
export function decryptPersonalData(
  encrypted: EncryptedBlob,
  key: Uint8Array
): PersonalData {
  console.log('🔓 Decrypting personal data...');

  try {
    // Decode from Base64
    const ciphertextBytes = decodeBase64(encrypted.ciphertext);
    const nonceBytes = decodeBase64(encrypted.nonce);

    // Decrypt with NaCl secretbox
    const plaintextBytes = nacl.secretbox.open(ciphertextBytes, nonceBytes, key);

    if (!plaintextBytes) {
      throw new Error('Decryption failed: Invalid key or corrupted data');
    }

    // Deserialize JSON
    const plaintext = encodeUTF8(plaintextBytes);
    const data = JSON.parse(plaintext) as PersonalData;

    console.log('✅ Data decrypted successfully');
    return data;
  } catch (error) {
    console.error('❌ Decryption failed:', error);
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create encrypted evidence bundle
 *
 * Combines encrypted personal data with public metadata
 *
 * @param personalData - Name and address to encrypt
 * @param reason - Public reason for request
 * @param type - 'citizen' or 'attester'
 * @param account - Thirdweb account instance
 * @returns Complete encrypted evidence
 */
export async function createEncryptedEvidence(
  personalData: PersonalData,
  reason: string,
  type: 'citizen' | 'attester',
  account: Account
): Promise<EncryptedEvidence> {
  console.log('📦 Creating encrypted evidence bundle...');

  try {
    // Derive encryption key
    const { key, timestamp } = await deriveEncryptionKey(account);

    // Encrypt personal data
    const encrypted = encryptPersonalData(personalData, key);

    // Create public metadata
    const metadata: PublicMetadata = {
      reason,
      timestamp: new Date().toISOString(),
      type,
      requester: account.address,
      encrypted: true,
      encryptionTimestamp: timestamp,
    };

    const evidence: EncryptedEvidence = {
      encrypted,
      metadata,
    };

    console.log('✅ Encrypted evidence bundle created');
    return evidence;
  } catch (error) {
    console.error('❌ Failed to create encrypted evidence:', error);
    throw error;
  }
}

/**
 * Decrypt evidence (only works for owner)
 *
 * @param evidence - Encrypted evidence
 * @param account - Thirdweb account instance (must be owner)
 * @returns Decrypted personal data
 */
export async function decryptEvidence(
  evidence: EncryptedEvidence,
  account: Account
): Promise<PersonalData> {
  console.log('🔓 Decrypting evidence...');

  try {
    // Check if requester matches
    if (evidence.metadata.requester.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Access denied: Only the requester can decrypt this evidence');
    }

    // Derive encryption key using stored timestamp
    const { key } = await deriveEncryptionKey(
      account,
      evidence.metadata.encryptionTimestamp
    );

    // Decrypt personal data
    const data = decryptPersonalData(evidence.encrypted, key);

    console.log('✅ Evidence decrypted successfully');
    return data;
  } catch (error) {
    console.error('❌ Failed to decrypt evidence:', error);
    throw error;
  }
}

/**
 * V2 ENCRYPTION - Wallet-Based Key Derivation (No Signature Required!)
 *
 * Derive session key for V2 encryption (deterministic from wallet address)
 *
 * V2 encryption solves the EIP-712 signature non-determinism problem:
 * 1. Generate random data key for encrypting data
 * 2. Derive session key from wallet address + chain ID (deterministic, no signature)
 * 3. Encrypt the data key with session key
 * 4. Store encrypted data key in metadata
 * 5. For decryption: Derive same session key from wallet → decrypt data key → decrypt data
 *
 * Benefits:
 * - No signature required (better UX)
 * - Fully deterministic (works every time)
 * - Wallet-specific (only owner can decrypt)
 *
 * @param account - Thirdweb account instance
 * @returns Session key and encrypted data key
 */
/**
 * @deprecated REVERSIBLE — the session key is derived from the PUBLIC wallet
 * address, so anyone who reads the stored row can recompute it. Do NOT use for
 * citizen/attester identity PII. Retained ONLY for revocation reasons, which are
 * intentionally human-readable by approvers. New identity flows use
 * lib/citizen-commitment.ts (on-device preimage, non-reversible commitment).
 */
export async function deriveSessionKey(
  account: Account
): Promise<SessionKeyResult> {
  console.log('🔐 V2: Deriving session key for encryption...');

  try {
    // Generate random 32-byte data key
    const dataKey = nacl.randomBytes(nacl.secretbox.keyLength);
    console.log('🎲 Generated random data key');

    // Derive session key from wallet address (deterministic, no signature needed)
    const walletAddress = account.address.toLowerCase();
    const chainId = ENCRYPTION_DOMAIN.chainId.toString();
    const seed = `${walletAddress}:${chainId}:evidence-encryption-v2`;

    console.log(`   Using wallet: ${walletAddress.substring(0, 10)}...`);

    // Hash the seed to get a 32-byte key using React Native compatible crypto
    const encoder = new TextEncoder();
    const seedBytes = encoder.encode(seed);

    // Use expo-crypto for React Native compatibility
    const { digest } = await import('expo-crypto');
    const keyHash = await digest('SHA-256', seedBytes);
    const sessionKey = new Uint8Array(keyHash);

    console.log('🔑 Session key derived from wallet address');

    // Encrypt data key with session key
    const keyNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const encryptedKey = nacl.secretbox(dataKey, keyNonce, sessionKey);

    if (!encryptedKey) {
      throw new Error('Failed to encrypt data key');
    }

    console.log('✅ Data key encrypted with session key');

    return {
      sessionKey,
      encryptedDataKey: encodeBase64(encryptedKey),
      keyNonce: encodeBase64(keyNonce),
      dataKey,
    };
  } catch (error) {
    console.error('❌ Failed to derive session key:', error);
    throw new Error(
      error instanceof Error
        ? `Session key derivation failed: ${error.message}`
        : 'Failed to derive session key'
    );
  }
}

/**
 * Decrypt data key using wallet-derived key (V2 decryption)
 *
 * Uses wallet address + chain ID as deterministic seed for key derivation.
 * This is reproducible without requiring signature determinism.
 *
 * @param account - Thirdweb account instance
 * @param encryptedKey - Base64 encrypted data key from metadata
 * @param keyNonce - Base64 nonce for key decryption
 * @returns Decrypted data key
 */
export async function decryptDataKey(
  account: Account,
  encryptedKey: string,
  keyNonce: string
): Promise<Uint8Array> {
  console.log('🔓 V2: Decrypting data key...');

  try {
    // Derive session key from wallet address (deterministic, no signature needed)
    const walletAddress = account.address.toLowerCase();
    const chainId = ENCRYPTION_DOMAIN.chainId.toString();
    const seed = `${walletAddress}:${chainId}:evidence-encryption-v2`;

    console.log(`   Using wallet: ${walletAddress.substring(0, 10)}...`);

    // Hash the seed to get a 32-byte key using React Native compatible crypto
    const encoder = new TextEncoder();
    const seedBytes = encoder.encode(seed);

    // Use expo-crypto for React Native compatibility
    const { digest } = await import('expo-crypto');
    const keyHash = await digest('SHA-256', seedBytes);
    const sessionKey = new Uint8Array(keyHash);

    console.log('🔑 Session key derived from wallet address');

    // Decrypt data key
    const encryptedKeyBytes = decodeBase64(encryptedKey);
    const nonceBytes = decodeBase64(keyNonce);

    const dataKey = nacl.secretbox.open(encryptedKeyBytes, nonceBytes, sessionKey);

    if (!dataKey) {
      throw new Error('Failed to decrypt data key - wrong wallet or corrupted data');
    }

    console.log('✅ Data key decrypted successfully');

    return dataKey;
  } catch (error) {
    console.error('❌ Failed to decrypt data key:', error);
    throw new Error(
      error instanceof Error
        ? `Data key decryption failed: ${error.message}`
        : 'Failed to decrypt data key (ensure you are using the same wallet)'
    );
  }
}

/**
 * Create encrypted evidence bundle (V2 - wallet-based encryption)
 *
 * V2 approach: No signature required, better UX!
 *
 * @param personalData - Name and address to encrypt
 * @param reason - Public reason for request
 * @param type - 'citizen' or 'attester'
 * @param account - Thirdweb account instance
 * @returns Complete encrypted evidence with V2 metadata
 */
export async function createEncryptedEvidenceV2(
  personalData: PersonalData,
  reason: string,
  type: 'citizen' | 'attester',
  account: Account
): Promise<EncryptedEvidence> {
  console.log('📦 Creating encrypted evidence bundle (V2)...');

  try {
    // Step 1: Derive session key and data key (V2 approach - wallet-based, no signature)
    console.log('🔑 Deriving V2 encryption keys...');
    const { dataKey, encryptedDataKey, keyNonce } = await deriveSessionKey(account);

    // Step 2: Encrypt personal data with random data key
    console.log('🔒 Encrypting personal data with V2 encryption...');
    const encrypted = encryptPersonalData(personalData, dataKey);

    // Step 3: Create public metadata
    const metadata: PublicMetadata = {
      reason,
      timestamp: new Date().toISOString(),
      type,
      requester: account.address,
      encrypted: true,
      encryptionVersion: 'eip712-v2', // V2: wallet-based key derivation
      encryptedKey: encryptedDataKey, // Encrypted data key
      keyNonce: keyNonce, // Nonce for data key decryption
    };

    const evidence: EncryptedEvidence = {
      encrypted,
      metadata,
    };

    console.log('✅ Encrypted evidence bundle created (V2)');
    return evidence;
  } catch (error) {
    console.error('❌ Failed to create encrypted evidence (V2):', error);
    throw error;
  }
}

/**
 * Decrypt evidence (V2 - supports both V1 and V2 encryption)
 *
 * Automatically detects encryption version and uses appropriate decryption method.
 *
 * @param evidence - Encrypted evidence
 * @param account - Thirdweb account instance (must be owner)
 * @returns Decrypted personal data
 */
export async function decryptEvidenceV2(
  evidence: EncryptedEvidence,
  account: Account
): Promise<PersonalData> {
  console.log('🔓 Decrypting evidence (V2)...');

  try {
    // Check if requester matches
    if (evidence.metadata.requester.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Access denied: Only the requester can decrypt this evidence');
    }

    // Check encryption version
    const version = evidence.metadata.encryptionVersion || 'eip712-v1';

    if (version === 'eip712-v2') {
      // V2 decryption: wallet-based key derivation
      console.log('   Using V2 decryption (wallet-based)');

      if (!evidence.metadata.encryptedKey || !evidence.metadata.keyNonce) {
        throw new Error('Missing encrypted key or nonce in V2 metadata');
      }

      // Decrypt data key using wallet-derived session key
      const dataKey = await decryptDataKey(
        account,
        evidence.metadata.encryptedKey,
        evidence.metadata.keyNonce
      );

      // Decrypt personal data with data key
      const data = decryptPersonalData(evidence.encrypted, dataKey);

      console.log('✅ Evidence decrypted successfully (V2)');
      return data;
    } else {
      // V1 decryption: signature-based key derivation (backward compatibility)
      console.log('   Using V1 decryption (signature-based)');

      const { key } = await deriveEncryptionKey(
        account,
        evidence.metadata.encryptionTimestamp
      );

      const data = decryptPersonalData(evidence.encrypted, key);

      console.log('✅ Evidence decrypted successfully (V1)');
      return data;
    }
  } catch (error) {
    console.error('❌ Failed to decrypt evidence:', error);
    throw error;
  }
}
