/**
 * MaciContext — manages each citizen's MACI BabyJubjub keypair and their MACI
 * sign-up state on chain.
 *
 * Keypair lifecycle:
 *   - Generated on demand via `generateAndStoreKeypair()`.
 *   - Persisted in expo-secure-store (Keychain on iOS, EncryptedSharedPreferences
 *     on Android) under SECURE_KEY. Never touches AsyncStorage.
 *   - Loaded on mount; surfaced via `serializedKeypair` so the UI can decide
 *     "needs onboarding" vs "ready to vote".
 *
 * Sign-up lifecycle:
 *   - Each citizen signs up to MACI exactly once. After signup, MACI assigns a
 *     state index (uint256) to their pubkey hash.
 *   - MACI v2 has NO public view to look up an existing user's stateIndex from
 *     their pubkey (that's a v3-only addition). The canonical sources are the
 *     `SignUp` event log emitted at signup time.
 *   - We resolve `signUpState` in three layers (fastest first):
 *       1. Local cache: serializedKeypair.stateIndex matches the current
 *          pubKeyHash → use it directly. No network.
 *       2. Event scan: query MACI's SignUp logs filtered by the indexed
 *          pubX/pubY topics. If we find one, persist its stateIndex into
 *          secure-store so future sessions hit the cache.
 *       3. Otherwise: needs-signup.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "@/lib/storage/secureStorage";
import { getContractEvents, prepareEvent } from "thirdweb";
import { keccak256 } from "thirdweb/utils";
import { getRpcClient, eth_blockNumber } from "thirdweb/rpc";
import { useActiveAccount } from "thirdweb/react";
import { client, MACI_DEPLOY_BLOCK, maciReadContract } from "@/constants/thirdweb";
import { gnosisRead } from "@/constants/gnosis";
import {
  deserializeKeypair,
  deriveMaciKeypairFromSeed,
  type SerializedKeypair,
  Keypair,
} from "@/lib/maci";

const SECURE_KEY = "roebel.maci.keypair.v1";
const VOTES_KEY = "roebel.maci.votes.v1";

/** Fixed message signed once per device to deterministically derive the
 *  citizen's MACI voting key. Bump the version suffix only if the derivation
 *  scheme must change (it would mint a new key → requires a fresh signup). */
const KEY_DERIVATION_MESSAGE = "Röbel Bürgerumfrage – Abstimmungsschlüssel v1";

type SignUpState =
  | { status: "unknown" } // not yet checked
  | { status: "needs-keypair" } // no keypair generated yet
  | { status: "needs-signup"; pubKeyHash: bigint } // keypair exists, MACI doesn't know it
  | { status: "signed-up"; pubKeyHash: bigint; stateIndex: bigint };

/**
 * Locally-cached record of the citizen's most recent vote on a poll.
 *
 * MACI's process circuit takes the highest-nonce signed command per voter, so
 * the LATEST publishMessage wins. We persist what they actually picked so the
 * UI can show "Du hast Dafür gestimmt" after a re-render — neither the Poll
 * contract nor anyone else can decrypt their choice. This is a UX cache, not
 * authoritative state. Wiped on app reinstall (acceptable: revoting is free
 * until the deadline).
 */
export interface VoteRecord {
  pollAddress: string;   // lower-cased
  optionIndex: number;   // VoteType: 0=Against, 1=For, 2=Abstain
  nonce: string;         // bigint serialized as decimal string
  txHash: string;
  votedAt: number;       // epoch seconds (Date.now() / 1000)
}

type VotesMap = Record<string, VoteRecord>;

interface MaciContextShape {
  serializedKeypair: SerializedKeypair | null;
  keypairLoading: boolean;
  signUpState: SignUpState;
  generateAndStoreKeypair: () => Promise<SerializedKeypair>;
  clearKeypair: () => Promise<void>;
  /** Re-resolve sign-up state and return the resolved value, so callers can act
   *  on the *actual* result rather than the stale closure `signUpState`. */
  refreshSignUp: () => Promise<SignUpState>;
  /** Optimistically promote state to `signed-up` after a confirmed signUp tx,
   *  using the stateIndex parsed from the SignUp event log. Also persists
   *  the stateIndex to secure-store so cold-starts can skip the chain. */
  markSignedUp: (pubKeyHash: bigint, stateIndex: bigint) => Promise<void>;
  getKeypair: () => Keypair | null;
  /** Record the citizen's latest vote on a poll. Persisted to secure-store
   *  so re-opening the app shows "Du hast … gestimmt" without a chain read. */
  recordVote: (pollAddress: string, optionIndex: number, nonce: bigint, txHash: string) => Promise<void>;
  /** Latest cached vote for this poll, or null if none recorded on this device. */
  getLastVote: (pollAddress: string) => VoteRecord | null;
  /** Suggested nonce for the next publishMessage on this poll. Returns
   *  lastVote.nonce + 1 if a vote exists, else 1n — so re-voting bumps the
   *  nonce monotonically across cold-starts. */
  getNextNonce: (pollAddress: string) => bigint;
}

const MaciContext = createContext<MaciContextShape | null>(null);

export function MaciProvider({ children }: { children: React.ReactNode }) {
  const account = useActiveAccount();
  const [serializedKeypair, setSerializedKeypair] = useState<SerializedKeypair | null>(null);
  const [keypairLoading, setKeypairLoading] = useState(true);
  const [signUpState, setSignUpState] = useState<SignUpState>({ status: "unknown" });
  const [votes, setVotes] = useState<VotesMap>({});
  const lastCheckedHash = useRef<bigint | null>(null);

  // Load keypair + votes from secure store on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawKeypair, rawVotes] = await Promise.all([
          SecureStore.getItemAsync(SECURE_KEY),
          SecureStore.getItemAsync(VOTES_KEY),
        ]);
        if (cancelled) return;
        if (rawKeypair) {
          setSerializedKeypair(JSON.parse(rawKeypair) as SerializedKeypair);
        } else {
          setSignUpState({ status: "needs-keypair" });
        }
        if (rawVotes) {
          try {
            setVotes(JSON.parse(rawVotes) as VotesMap);
          } catch (err) {
            console.warn("[MaciContext] failed to parse votes cache:", err);
          }
        }
      } catch (err) {
        console.warn("[MaciContext] failed to load keypair:", err);
        setSignUpState({ status: "needs-keypair" });
      } finally {
        if (!cancelled) setKeypairLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persist a keypair update + return the new serialized form. */
  const persistKeypair = useCallback(async (next: SerializedKeypair) => {
    await SecureStore.setItemAsync(SECURE_KEY, JSON.stringify(next));
    setSerializedKeypair(next);
    return next;
  }, []);

  const refreshSignUp = useCallback(async (): Promise<SignUpState> => {
    if (!serializedKeypair) {
      const s: SignUpState = { status: "needs-keypair" };
      setSignUpState(s);
      return s;
    }

    const kp = deserializeKeypair(serializedKeypair);
    const pubKeyHash = kp.pubKey.hash() as bigint;
    const pubX = BigInt(serializedKeypair.pubX);
    const pubY = BigInt(serializedKeypair.pubY);

    // Layer 1 — local cache. Fast path: secure-store already knows the
    // stateIndex for this exact keypair.
    if (
      serializedKeypair.stateIndex !== undefined &&
      serializedKeypair.pubKeyHash === pubKeyHash.toString()
    ) {
      const stateIndex = BigInt(serializedKeypair.stateIndex);
      lastCheckedHash.current = pubKeyHash;
      const s: SignUpState = { status: "signed-up", pubKeyHash, stateIndex };
      setSignUpState(s);
      console.log("[MaciContext] refreshSignUp: cache hit", { stateIndex: stateIndex.toString() });
      return s;
    }

    // Layer 2 — event scan. MACI v2 has no getStateIndex(pubKeyHash) view, so
    // we filter SignUp logs by the indexed pubX/pubY topics. Each pubkey can
    // appear at most once (the gatekeeper enforces uniqueness).
    //
    // The Gnosis read RPC caps eth_getLogs at a ~10k-block range, and the live
    // range (MACI_DEPLOY_BLOCK → latest) is hundreds of thousands of blocks. We
    // split it into <10k windows and scan them with bounded concurrency against the
    // reliable read RPC (maciReadContract), returning on the first window that
    // contains this pubkey's SignUp. Parallel + direction-agnostic, so an early
    // signup near the deploy block resolves in seconds instead of dozens of
    // serial round-trips. On a hit we persist the stateIndex (Layer 1) so this
    // scan runs at most once per device.
    //
    // CRITICAL: distinguish "scanned the whole range, no event" (→ needs-signup)
    // from "a window errored" (→ unknown, retryable) — a transient failure must
    // NOT be reported as needs-signup.
    const signUpEvent = prepareEvent({
      signature:
        "event SignUp(uint256 _stateIndex, uint256 indexed _userPubKeyX, uint256 indexed _userPubKeyY, uint256 _voiceCreditBalance, uint256 _timestamp)",
      filters: { _userPubKeyX: pubX, _userPubKeyY: pubY },
    });

    let latest: bigint;
    try {
      latest = await eth_blockNumber(getRpcClient({ client, chain: gnosisRead }));
    } catch (err) {
      console.warn("[MaciContext] refreshSignUp: eth_blockNumber failed", err);
      const s: SignUpState = { status: "unknown" };
      setSignUpState(s);
      return s;
    }

    const WINDOW = 9_000n; // under Gnosis's ~10k eth_getLogs cap
    const CONCURRENCY = 6;
    const ranges: { from: bigint; to: bigint }[] = [];
    for (let to = latest; to >= MACI_DEPLOY_BLOCK; ) {
      const from = to - WINDOW + 1n > MACI_DEPLOY_BLOCK ? to - WINDOW + 1n : MACI_DEPLOY_BLOCK;
      ranges.push({ from, to });
      if (from === MACI_DEPLOY_BLOCK) break;
      to = from - 1n;
    }
    console.log(
      `[MaciContext] refreshSignUp: scanning ${ranges.length} windows [${MACI_DEPLOY_BLOCK}-${latest}] @${CONCURRENCY}x`,
    );

    let hitStateIndex: bigint | null = null;
    let anyError = false;
    let cursor = 0;

    const scanWindow = async (r: { from: bigint; to: bigint }): Promise<"hit" | "empty" | "error"> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const events = await getContractEvents({
            contract: maciReadContract,
            events: [signUpEvent],
            fromBlock: r.from,
            toBlock: r.to,
          });
          if (events.length > 0) {
            const ev = events[0] as unknown as { args: { _stateIndex?: bigint } };
            if (hitStateIndex === null) hitStateIndex = ev.args._stateIndex ?? 0n;
            console.log(`[MaciContext] refreshSignUp: hit in window ${r.from}-${r.to}`);
            return "hit";
          }
          return "empty";
        } catch (err) {
          console.warn(`[MaciContext] refreshSignUp: window ${r.from}-${r.to} attempt ${attempt + 1}/2 failed`, err);
          await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
        }
      }
      return "error";
    };

    const worker = async () => {
      while (hitStateIndex === null && cursor < ranges.length) {
        const r = ranges[cursor++];
        const res = await scanWindow(r);
        if (res === "error") anyError = true;
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, () => worker()),
    );

    if (hitStateIndex !== null) {
      const stateIndex = hitStateIndex;
      await persistKeypair({
        ...serializedKeypair,
        stateIndex: stateIndex.toString(),
        pubKeyHash: pubKeyHash.toString(),
      });
      lastCheckedHash.current = pubKeyHash;
      const s: SignUpState = { status: "signed-up", pubKeyHash, stateIndex };
      setSignUpState(s);
      console.log("[MaciContext] refreshSignUp: signed-up", { stateIndex: stateIndex.toString() });
      return s;
    }

    // No hit. Only trust "not registered" if every window scanned cleanly;
    // otherwise stay `unknown` so the UI offers a retry.
    if (anyError) {
      console.warn(`[MaciContext] refreshSignUp: scan incomplete (window errors) across ${ranges.length} windows`);
      const s: SignUpState = { status: "unknown" };
      setSignUpState(s);
      return s;
    }
    const s: SignUpState = { status: "needs-signup", pubKeyHash };
    setSignUpState(s);
    console.log(`[MaciContext] refreshSignUp: no SignUp across ${ranges.length} windows → needs-signup`);
    return s;
  }, [serializedKeypair, persistKeypair]);

  // Refresh signup whenever the keypair changes or wallet reconnects.
  useEffect(() => {
    if (!serializedKeypair) return;
    if (!account) return;
    refreshSignUp().catch((err) => console.warn("[MaciContext] refreshSignUp:", err));
  }, [serializedKeypair, account?.address, refreshSignUp]);

  const markSignedUp = useCallback(
    async (pubKeyHash: bigint, stateIndex: bigint) => {
      if (serializedKeypair) {
        await persistKeypair({
          ...serializedKeypair,
          stateIndex: stateIndex.toString(),
          pubKeyHash: pubKeyHash.toString(),
        });
      }
      lastCheckedHash.current = pubKeyHash;
      setSignUpState({ status: "signed-up", pubKeyHash, stateIndex });
    },
    [serializedKeypair, persistKeypair],
  );

  const generateAndStoreKeypair = useCallback(async () => {
    // Migration shim: if this device already has a key, keep it. Older installs
    // minted a RANDOM key that may already be registered on-chain — overwriting
    // it would orphan that registration. New installs fall through to the
    // deterministic, wallet-derived path below.
    if (serializedKeypair) return serializedKeypair;

    if (!account) {
      throw new Error("Bitte verbinde zuerst dein Wallet.");
    }

    // Derive the voting key deterministically from a wallet signature so the
    // same wallet reproduces the same key on every device / after a reinstall.
    const signature = await account.signMessage({ message: KEY_DERIVATION_MESSAGE });
    const seed = BigInt(keccak256(signature as `0x${string}`));
    const derived = deriveMaciKeypairFromSeed(seed);

    const persisted = await persistKeypair(derived);
    setSignUpState({
      status: "needs-signup",
      pubKeyHash: deserializeKeypair(derived).pubKey.hash() as bigint,
    });
    return persisted;
  }, [account, serializedKeypair, persistKeypair]);

  const clearKeypair = useCallback(async () => {
    await SecureStore.deleteItemAsync(SECURE_KEY);
    await SecureStore.deleteItemAsync(VOTES_KEY);
    setSerializedKeypair(null);
    setSignUpState({ status: "needs-keypair" });
    setVotes({});
    lastCheckedHash.current = null;
  }, []);

  const getKeypair = useCallback(() => {
    if (!serializedKeypair) return null;
    return deserializeKeypair(serializedKeypair);
  }, [serializedKeypair]);

  const recordVote = useCallback(
    async (pollAddress: string, optionIndex: number, nonce: bigint, txHash: string) => {
      const key = pollAddress.toLowerCase();
      const next: VotesMap = {
        ...votes,
        [key]: {
          pollAddress: key,
          optionIndex,
          nonce: nonce.toString(),
          txHash,
          votedAt: Math.floor(Date.now() / 1000),
        },
      };
      setVotes(next);
      try {
        await SecureStore.setItemAsync(VOTES_KEY, JSON.stringify(next));
      } catch (err) {
        console.warn("[MaciContext] failed to persist vote record:", err);
      }
    },
    [votes],
  );

  const getLastVote = useCallback(
    (pollAddress: string): VoteRecord | null => votes[pollAddress.toLowerCase()] ?? null,
    [votes],
  );

  const getNextNonce = useCallback(
    (pollAddress: string): bigint => {
      const last = votes[pollAddress.toLowerCase()];
      if (!last) return 1n;
      try {
        return BigInt(last.nonce) + 1n;
      } catch {
        return 1n;
      }
    },
    [votes],
  );

  const value = useMemo<MaciContextShape>(
    () => ({
      serializedKeypair,
      keypairLoading,
      signUpState,
      generateAndStoreKeypair,
      clearKeypair,
      refreshSignUp,
      markSignedUp,
      getKeypair,
      recordVote,
      getLastVote,
      getNextNonce,
    }),
    [serializedKeypair, keypairLoading, signUpState, generateAndStoreKeypair, clearKeypair, refreshSignUp, markSignedUp, getKeypair, recordVote, getLastVote, getNextNonce],
  );

  return <MaciContext.Provider value={value}>{children}</MaciContext.Provider>;
}

export function useMaci(): MaciContextShape {
  const ctx = useContext(MaciContext);
  if (!ctx) throw new Error("useMaci must be used inside <MaciProvider>");
  return ctx;
}
