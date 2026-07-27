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
  /** Machine-readable cause, for logs and for deciding whether retrying can help. */
  reason?:
    | 'not-deployed'
    | 'verification-failed'
    | 'wallet-not-deployed'
    | 'chain-unavailable'
    | 'network'
    | 'unknown';
}

/** Pull the server's own error code out of a failed Edge Function response. */
async function serverErrorCode(error: unknown): Promise<string> {
  try {
    const response = (error as { context?: Response })?.context;
    if (!response || typeof response.json !== 'function') return '';
    return String((await response.clone().json())?.error ?? '');
  } catch {
    return '';
  }
}

/**
 * Turn a failed Edge Function call into an honest message.
 *
 * "Bitte später erneut versuchen" is only true for transient faults. Telling
 * someone to wait for a condition that will never resolve on its own — a function
 * that is not deployed — sends them into a retry loop instead of to the fix.
 */
function describeFailure(status: number | undefined, code = ''): RegistrationResult {
  // The one failure with a remedy the Citizen can actually act on.
  if (code === 'wallet-not-deployed') {
    return {
      ok: false,
      reason: 'wallet-not-deployed',
      message:
        'Dein Wallet ist auf der Blockchain noch nicht aktiviert — das passiert automatisch bei deiner ersten Transaktion. Sende oder empfange einmal Röbel Münzen und versuche es dann erneut.',
    };
  }
  if (status === 404) {
    return {
      ok: false,
      reason: 'not-deployed',
      message:
        'Die Nostr-Registrierung ist auf dem Server noch nicht freigeschaltet. Deine Identität liegt bereits sicher auf diesem Gerät — sobald der Dienst bereitsteht, genügt ein Tipp.',
    };
  }
  if (status === 503) {
    return {
      ok: false,
      reason: 'chain-unavailable',
      message:
        'Deine Wallet-Signatur konnte gerade nicht geprüft werden. Das liegt meist am Netzwerk — bitte in ein paar Minuten noch einmal versuchen.',
    };
  }
  if (status === 400 || status === 409) {
    return {
      ok: false,
      reason: 'verification-failed',
      // Quote the server's own code: it costs the reader nothing and turns a
      // support conversation from "it didn't work" into one exact answer.
      message: `Die Signaturprüfung ist fehlgeschlagen. Bitte melde dich bei uns, wenn das erneut passiert.${
        code ? `\n\nDetail: ${code}` : ''
      }`,
    };
  }
  return {
    ok: false,
    reason: status ? 'unknown' : 'network',
    message: 'Die Registrierung hat nicht geklappt. Bitte später erneut versuchen.',
  };
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
      // supabase-js wraps the HTTP response on FunctionsHttpError; the status is
      // what distinguishes "not deployed" from "your signature is wrong".
      const status: number | undefined =
        (error as { context?: { status?: number } })?.context?.status;
      const code = await serverErrorCode(error);
      console.warn('[nostr] registration failed', status ?? 'no-status', code || error.message);
      return describeFailure(status, code);
    }
    if ((data as { error?: string } | null)?.error) {
      const detail = (data as { error: string }).error;
      console.warn('[nostr] registration rejected', detail);
      return describeFailure(400, detail);
    }

    await SecureStore.setItemAsync(REGISTRATION_STORE, new Date().toISOString());
    return {
      ok: true,
      message: 'Registriert. Der Schreibzugriff wird innerhalb weniger Minuten freigeschaltet.',
    };
  } catch (err) {
    console.warn('[nostr] registration threw', (err as Error)?.message);
    return describeFailure(undefined);
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
