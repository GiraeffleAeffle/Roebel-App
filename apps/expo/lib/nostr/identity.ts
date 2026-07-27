import * as SecureStore from 'expo-secure-store';
import {
  NOSTR_KEY_DERIVATION_MESSAGE,
  bindingStatement,
  buildBindingEvent,
  deriveNostrIdentity,
  getPublicKeyHex,
  npubEncode,
} from '@netizen-labs/nostr';
import { supabase } from '../supabase';

/**
 * The Citizen's Nostr identity — derived on this device, stored on this device.
 *
 * The private key NEVER leaves the phone and is never sent to the node. That is
 * the whole point: on a world-readable relay, a node that held Citizens' keys
 * could impersonate any of them. Content generated server-side (Mecky, the story
 * engine) publishes under the AGENT's own npub instead — agents are members with
 * their own identity, not ghostwriters for humans.
 *
 * Spec: docs/superpowers/specs/2026-07-27-nostr-citizen-identity-bridge-design.md
 */

const SECRET_KEY_STORE = 'nostr_secret_key_v1';
const REGISTRATION_STORE = 'nostr_registered_at_v1';

/** The minimal wallet surface this module needs — matches thirdweb's Account. */
export interface SigningAccount {
  address: string;
  signMessage: (args: { message: string }) => Promise<string>;
}

export interface NostrIdentity {
  secretKey: Uint8Array;
  publicKey: string;
  npub: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The identity already on this device, or null. Never derives. */
export async function loadStoredIdentity(): Promise<NostrIdentity | null> {
  const stored = await SecureStore.getItemAsync(SECRET_KEY_STORE);
  if (!stored) return null;
  const secretKey = fromHex(stored);
  // Only the secret key is persisted; the pubkey and npub are recomputed from it,
  // so the stored values can never drift out of sync with the key.
  const publicKey = getPublicKeyHex(secretKey);
  return { secretKey, publicKey, npub: npubEncode(publicKey) };
}

/**
 * Derive (once) and persist this wallet's Nostr identity.
 *
 * Migration shim, mirroring MACI's voting keys: if a key already exists on this
 * device it is returned untouched and never re-derived. The derivation depends on
 * a wallet signature, so if the smart-account implementation ever changed, the
 * signature — and therefore the npub — would change too. Re-deriving over an
 * existing key would silently orphan the identity the relay already knows.
 */
export async function deriveAndStoreIdentity(account: SigningAccount): Promise<NostrIdentity> {
  const existing = await loadStoredIdentity();
  if (existing) return existing;

  const signature = await account.signMessage({ message: NOSTR_KEY_DERIVATION_MESSAGE });
  const identity = deriveNostrIdentity(signature);
  await SecureStore.setItemAsync(SECRET_KEY_STORE, toHex(identity.secretKey));
  return identity;
}

export interface RegistrationResult {
  ok: boolean;
  /** German, safe to surface directly. */
  message: string;
}

/**
 * Register the wallet↔npub binding with the node.
 *
 * Both keys sign the same statement — the wallet (ERC-1271, since it is a smart
 * account) and the Nostr key (inside a signed event). Two signatures over one
 * string prove joint control, which is what the relay allow-list needs; nobody
 * has to trust that the npub was *derived* from the wallet.
 */
export async function registerIdentity(
  account: SigningAccount,
  identity: NostrIdentity,
): Promise<RegistrationResult> {
  try {
    const statement = bindingStatement({ account: account.address, npub: identity.npub });
    const ethSignature = await account.signMessage({ message: statement });
    const bindingEvent = buildBindingEvent(identity.secretKey, account.address);

    const { data, error } = await supabase.functions.invoke('nostr-identity-register', {
      body: {
        wallet: account.address.toLowerCase(),
        pubkey_hex: identity.publicKey,
        eth_signature: ethSignature,
        binding_event: bindingEvent,
      },
    });

    if (error) {
      return { ok: false, message: 'Registrierung fehlgeschlagen. Bitte später erneut versuchen.' };
    }
    if ((data as { error?: string } | null)?.error) {
      return { ok: false, message: 'Die Signaturprüfung ist fehlgeschlagen.' };
    }

    await SecureStore.setItemAsync(REGISTRATION_STORE, new Date().toISOString());
    return {
      ok: true,
      message: 'Registriert. Der Schreibzugriff wird innerhalb weniger Minuten freigeschaltet.',
    };
  } catch {
    return { ok: false, message: 'Registrierung fehlgeschlagen. Bitte später erneut versuchen.' };
  }
}

/** When this device last registered its binding, or null. */
export async function getRegisteredAt(): Promise<string | null> {
  return SecureStore.getItemAsync(REGISTRATION_STORE);
}

/**
 * Forget the Nostr identity on this device.
 *
 * Honest limit: this removes the key locally and stops future publishing. It does
 * NOT unpublish anything — see `publishDeletions` for the NIP-09 request, whose
 * effect is advisory. Events already fetched by other clients are gone for good.
 */
export async function clearIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_KEY_STORE);
  await SecureStore.deleteItemAsync(REGISTRATION_STORE);
}
