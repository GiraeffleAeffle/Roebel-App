import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useActiveAccount } from 'thirdweb/react';
import { prepareContractCall, readContract, sendTransaction, waitForReceipt } from 'thirdweb';
import { gnosis } from '@/constants/gnosis';
import { keccak256, toHex } from 'thirdweb/utils';
import { useGnosisWallet } from '@/context/GnosisWalletContext';
import {
  client,
  governorContract,
  maciContract,
  citizenNFTContract,
  getPollContract,
} from '@/constants/thirdweb';
import { VoteType, ProposalState } from '@/lib/governance-types';
import { isProposalActive, toBigInt, getStateMessage } from '@/lib/governance-utils';
import ErrorDrawer from './ErrorDrawer';
import SuccessDrawer from './SuccessDrawer';
import LastVoteCard from './LastVoteCard';
import StoryProgress from './StoryProgress';
import BirthdatePromptSheet from './rewards/BirthdatePromptSheet';
import { loadCitizenPreimage, setCitizenBirthdate } from '@/lib/citizen-commitment';
import { useTheme } from '@/context/ThemeContext';
import { useMaci } from '@/context/MaciContext';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useVerificationContext } from '@/context/VerificationContext';
import CitizenVerificationBanner from '@/components/profile/CitizenVerificationBanner';
import { SUPPORT_ACCOUNT_ID } from '@/lib/support-contact';
import { recordVote as recordVoteToSupabase } from '@/lib/supabase-votes';
import { claimReward } from '@/lib/rewards-claim';
import { useCelebrateSettling } from '@/hooks/useCelebrateSettling';
import { useRoebelTaler } from '@/hooks/useRoebelTaler';
import { Events, track } from '@/lib/analytics';
import {
  buildVoteMessage,
  prepareInitialVoiceCreditProxyData,
  prepareSignUpGatekeeperData,
  PubKey,
} from '@/lib/maci';

// Reward screen body copy for casting a vote (governance participation).
const VOTE_REWARD_SUBTITLE =
  'Danke fürs Mitbestimmen! Für deine Teilnahme an der Abstimmung gibt es Röbel Münzen.';

// Privacy confirmation shown after the reward screen is dismissed.
const VOTE_PRIVACY_MESSAGE =
  'Versiegelt und eingeworfen. Deine Stimme ist ab jetzt für niemanden sichtbar — nicht für die Stadt, nicht für uns. Erst nach Ablauf der Frist öffnen mehrere Schlüsselhalter:innen die digitale Wahlurne gemeinsam. Bis dahin kannst du deine Wahl jederzeit ändern.';

interface VoteButtonsProps {
  proposalId: bigint;
  proposalState: ProposalState;
  hasVoted: boolean;
  isCitizen: boolean;
  onVoteSuccess: () => void;
}

type Phase =
  | 'idle'
  | 'creating-key'
  | 'signing-up'
  | 'encrypting-vote'
  | 'submitting-vote';

// Substate inside a multi-step transaction phase. `wallet-prompt` = the wallet
// popup is waiting on the user; `tx-submitted` = the tx is on chain and we're
// waiting for inclusion; `recovering` = we're (re)scanning the chain to confirm
// an existing signup (no wallet popup involved). Surfaced as inline button
// labels so the user never sees a bare spinner without context.
type TxSubstate = 'wallet-prompt' | 'tx-submitted' | 'recovering' | null;

/**
 * Extract a human-readable error message from a thirdweb / ethers error.
 * Falls back to the raw message string. Strips `Error: ` and trims trailing
 * RPC noise to keep the drawer readable.
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const raw = err instanceof Error ? err.message : String(err);

  // Common revert-reason patterns from thirdweb / ethers / Base RPC.
  const patterns: RegExp[] = [
    /execution reverted:\s*"?([^"\n]+)"?/i,
    /reason="([^"]+)"/i,
    /reverted with reason string ['"]([^'"]+)['"]/i,
    /reverted: ([^\n(]+)/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && m[1]) return m[1].trim();
  }
  // User rejection in most wallets.
  if (/user (?:rejected|denied)/i.test(raw) || /rejected by user/i.test(raw)) {
    return 'Transaktion wurde im Wallet abgebrochen.';
  }
  // First line, capped at 240 chars.
  const firstLine = raw.split('\n')[0]?.trim() ?? raw;
  return firstLine.length > 240 ? firstLine.slice(0, 240) + '…' : firstLine || fallback;
}

/**
 * MACI-aware vote buttons.
 *
 * UX principle: surface every state explicitly.
 *
 *   1. No wallet                  → "Connect to vote"
 *   2. Not a citizen              → "Bürger-Pass erforderlich"
 *   3. Voting closed              → "Abstimmung geschlossen"
 *   4. No MACI keypair yet        → "Schritt 1: privaten Schlüssel erstellen"
 *   5. Keypair OK, not signed up  → "Schritt 2: einmalige Anmeldung bei MACI"
 *   6. Signed up + active         → 3 buttons (Dafür / Dagegen / Enthalten)
 *      (re-voting allowed; we increment a per-poll nonce)
 *
 * Voting happens on the per-proposal Poll contract, NOT the Governor.
 * Governor.proposalPolls(proposalId) tells us where the Poll lives.
 */
export default function VoteButtons({
  proposalId,
  proposalState,
  hasVoted: legacyHasVoted, // unused for MACI but kept for API compat
  isCitizen,
  onVoteSuccess,
}: VoteButtonsProps) {
  const account = useActiveAccount();
  // MACI signUp + publishMessage now live on Gnosis v2 — send those txns with
  // the Gnosis smart account (same address as Base, gasless). `account` (Base)
  // stays for UI guards + .address (Supabase mirror) since the address matches.
  const { gnosisAccount } = useGnosisWallet();
  const { colors } = useTheme();
  const router = useRouter();
  const { activePendingRequest } = useVerificationContext();
  const celebrateSettling = useCelebrateSettling();
  const { enqueueSettlement } = useRoebelTaler();
  const {
    serializedKeypair,
    keypairLoading,
    signUpState,
    generateAndStoreKeypair,
    refreshSignUp,
    markSignedUp,
    getKeypair,
    recordVote,
    getLastVote,
    getNextNonce,
  } = useMaci();

  const [phase, setPhase] = useState<Phase>('idle');
  // Substate within the active phase — drives the inline button label so the
  // user can see whether the wallet is open, the tx is in-flight, etc.
  const [txSubstate, setTxSubstate] = useState<TxSubstate>(null);
  const [votingFor, setVotingFor] = useState<VoteType | null>(null);
  const [pollAddress, setPollAddress] = useState<string | null>(null);
  const [pollId, setPollId] = useState<bigint | null>(null);
  const [pollDeadline, setPollDeadline] = useState<bigint | null>(null);
  // 'pending' = lookup in flight; 'live' = governor returned a real poll; 'orphan'
  // = governor returned the zero address. Orphan happens when the proposal was
  // created on a previous Governor (rotation) — we render a clear fallback
  // instead of an infinite spinner.
  const [pollLookupState, setPollLookupState] = useState<'pending' | 'live' | 'orphan'>('pending');
  // `changing` flips when the user taps "Stimme ändern" on the LastVoteCard,
  // collapsing the card and re-revealing the 3-button row.
  const [changing, setChanging] = useState(false);
  const [nowSec, setNowSec] = useState<bigint>(BigInt(Math.floor(Date.now() / 1000)));
  // Live on-chain state used to gate the post-deadline "Koordinator entschlüsselt…"
  // copy. It's a duplicate read of what ProposalStateBadge already polls, but
  // VoteButtons needs its own copy to know whether the result has landed —
  // showing the wait message after the tally is on chain just confuses voters.
  // null = not loaded yet; otherwise mirrors governor.state(proposalId).
  const [liveState, setLiveState] = useState<ProposalState | null>(null);
  const [errorDrawer, setErrorDrawer] = useState({ visible: false, message: '' });
  const [successDrawer, setSuccessDrawer] = useState({
    visible: false,
    message: '',
    action: null as (() => void) | null,
  });
  // Just-in-time birthdate gate. When a citizen votes without an on-device
  // birthdate, we stash the chosen option here, open the sheet, and only run
  // the actual vote once they've saved it (or cancel cleanly on close).
  const [birthdateSheetVisible, setBirthdateSheetVisible] = useState(false);
  const [savingBirthdate, setSavingBirthdate] = useState(false);
  const [pendingVote, setPendingVote] = useState<VoteType | null>(null);

  // Resolve the per-proposal Poll address + deadline from the Governor.
  useEffect(() => {
    if (!proposalId || proposalId === 0n) {
      setPollLookupState('orphan');
      return;
    }
    let cancelled = false;
    setPollLookupState('pending');
    (async () => {
      try {
        const result = (await readContract({
          contract: governorContract,
          method:
            'function proposalPolls(uint256) view returns (uint256 pollId, address poll, address messageProcessor, address tally, uint256 deadline)',
          params: [proposalId],
        })) as readonly [bigint, string, string, string, bigint];
        if (cancelled) return;
        const [pId, pAddr, , , deadline] = result;
        if (pAddr && pAddr.toLowerCase() !== '0x0000000000000000000000000000000000000000') {
          setPollId(pId);
          setPollAddress(pAddr);
          setPollDeadline(toBigInt(deadline));
          setPollLookupState('live');
        } else {
          setPollLookupState('orphan');
        }
      } catch (err) {
        console.warn('[VoteButtons] proposalPolls lookup failed:', err);
        // Don't permanently lock to orphan on a transient RPC error — the user
        // can pull-to-refresh. But surface it so we don't spin forever.
        setPollLookupState('orphan');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [proposalId]);

  // Tick local "now" once a second so the open/closed boundary doesn't lag.
  useEffect(() => {
    const id = setInterval(() => {
      setNowSec(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Poll governor.state(proposalId) every 30 s. We only use it inside the
  // post-deadline branch to differentiate "tally still pending" (state ==
  // Active during grace) from "tally landed" (state ∈ Defeated/Succeeded/…).
  useEffect(() => {
    if (!proposalId || proposalId === 0n) return;
    let cancelled = false;
    const fetchState = async () => {
      try {
        const raw = await readContract({
          contract: governorContract,
          method: 'function state(uint256 proposalId) view returns (uint8)',
          params: [proposalId],
        });
        if (cancelled) return;
        const numeric = Number(raw);
        if (!Number.isNaN(numeric)) setLiveState(numeric as ProposalState);
      } catch (err) {
        console.warn('[VoteButtons] state() read failed:', err);
      }
    };
    fetchState();
    const id = setInterval(fetchState, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [proposalId]);

  // The MACI Poll accepts publishMessage from the moment it's deployed
  // (deployTime) until deployTime + duration. The Governor's stored deadline
  // matches the Poll's voting end. Gate voting on the deadline rather than the
  // OZ Pending/Active flag — which lags by 1-2 seconds at proposal start.
  const isVotingOpen = !!pollAddress && pollDeadline !== null && nowSec <= pollDeadline;
  const isVotingClosed = !!pollAddress && pollDeadline !== null && nowSec > pollDeadline;
  const canVote = !!account && isCitizen && isVotingOpen && signUpState.status === 'signed-up';

  // Ensure refreshSignUp is called when prerequisites change.
  useEffect(() => {
    if (!serializedKeypair) return;
    if (signUpState.status === 'unknown') {
      refreshSignUp().catch(() => undefined);
    }
  }, [serializedKeypair, signUpState.status, refreshSignUp]);

  // Decide what to show after a signup attempt resolves: celebrate only when we
  // actually reached `signed-up` (so the vote buttons are about to appear).
  // Otherwise tell the user to retry instead of a misleading success.
  const showSignUpResult = (
    recovered: { status: string },
    alreadyRegistered = false,
  ) => {
    if (recovered.status === 'signed-up') {
      setSuccessDrawer({
        visible: true,
        message: alreadyRegistered
          ? 'Du bist bereits für die Bürgerumfrage angemeldet. Du kannst jetzt geheim abstimmen.'
          : 'Du bist für die Bürgerumfrage angemeldet. Du kannst jetzt geheim abstimmen — und deine Stimme bis zum Ende der Frist beliebig oft ändern.',
        action: null,
      });
    } else {
      setErrorDrawer({
        visible: true,
        message:
          'Deine Anmeldung ließ sich gerade nicht bestätigen. Bitte versuche es in einem Moment erneut.',
      });
    }
  };

  // ----- Step 1: generate keypair locally -----
  const handleGenerateKey = async () => {
    if (phase !== 'idle') return;
    try {
      setPhase('creating-key');
      await generateAndStoreKeypair();
      setSuccessDrawer({
        visible: true,
        message:
          'Dein Wahlschlüssel ist erstellt und sicher auf deinem Gerät gespeichert. Jetzt noch einmalig zur Bürgerumfrage anmelden — dann kannst du geheim abstimmen.',
        action: null,
      });
    } catch (err) {
      console.error('[VoteButtons] generate key failed:', err);
      setErrorDrawer({
        visible: true,
        message: extractErrorMessage(err, 'Schlüssel konnte nicht erstellt werden.'),
      });
    } finally {
      setPhase('idle');
      setTxSubstate(null);
    }
  };

  // ----- Step 2: sign up to MACI -----
  const handleSignUp = async () => {
    if (phase !== 'idle') return;
    if (!account) {
      setErrorDrawer({ visible: true, message: 'Bitte verbinde zuerst dein Wallet.' });
      return;
    }
    if (!serializedKeypair) {
      setErrorDrawer({ visible: true, message: 'Bitte erstelle zuerst deinen Abstimmungsschlüssel.' });
      return;
    }
    if (!gnosisAccount) {
      setErrorDrawer({ visible: true, message: 'Dein Konto wird noch geladen. Bitte versuche es gleich erneut.' });
      return;
    }
    try {
      setPhase('signing-up');
      setTxSubstate('wallet-prompt');

      // Look up the citizen's CitizenNFT tokenId. SignUpTokenGatekeeper expects
      // the tokenId so it can verify ownership and mark the token as used.
      const tokenId = (await readContract({
        contract: citizenNFTContract,
        method: 'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
        params: [account.address, 0n],
      })) as bigint;

      const signUpData = prepareSignUpGatekeeperData(tokenId);
      const voiceData = prepareInitialVoiceCreditProxyData();

      const tx = prepareContractCall({
        contract: maciContract,
        method:
          'function signUp((uint256 x, uint256 y) _pubKey, bytes _signUpGatekeeperData, bytes _initialVoiceCreditProxyData)',
        params: [
          { x: BigInt(serializedKeypair.pubX), y: BigInt(serializedKeypair.pubY) },
          signUpData,
          voiceData,
        ],
      });

      // Split sendTransaction + waitForReceipt so the substate can flip from
      // "wallet open" → "tx submitted, waiting for inclusion". A single
      // sendAndConfirmTransaction hides both stages behind one await and there's
      // no way to surface the wallet-popup state to the user — that's exactly
      // what made the previous spinner-only UX feel broken.
      const { transactionHash } = await sendTransaction({ transaction: tx, account: gnosisAccount });
      setTxSubstate('tx-submitted');
      const receipt = await waitForReceipt({ client, chain: gnosis, transactionHash });

      // SignUp(uint256 _stateIndex, uint256 indexed _userPubKeyX,
      //         uint256 indexed _userPubKeyY, uint256 _voiceCreditBalance,
      //         uint256 _timestamp)
      const SIGN_UP_TOPIC = keccak256(
        toHex('SignUp(uint256,uint256,uint256,uint256,uint256)'),
      );
      const pubX = BigInt(serializedKeypair.pubX);
      const pubY = BigInt(serializedKeypair.pubY);
      const log = receipt.logs.find(
        (l) =>
          l.address.toLowerCase() === maciContract.address.toLowerCase() &&
          l.topics[0] === SIGN_UP_TOPIC &&
          l.topics[1] !== undefined &&
          BigInt(l.topics[1]) === pubX &&
          l.topics[2] !== undefined &&
          BigInt(l.topics[2]) === pubY,
      );

      if (log) {
        // First non-indexed uint256 in `data` is _stateIndex.
        const data = log.data.replace(/^0x/, '');
        const stateIndex = BigInt('0x' + data.slice(0, 64));
        const kp = getKeypair();
        const pubKeyHash = kp ? (kp.pubKey.hash() as bigint) : 0n;
        await markSignedUp(pubKeyHash, stateIndex);
        setSuccessDrawer({
          visible: true,
          message:
            'Du bist für die Bürgerumfrage angemeldet. Du kannst jetzt geheim abstimmen — und deine Stimme bis zum Ende der Frist beliebig oft ändern.',
          action: null,
        });
      } else {
        // Log couldn't be matched — recover the state index via the event scan
        // and only celebrate if we actually reached `signed-up`.
        setTxSubstate('recovering');
        const recovered = await refreshSignUp();
        showSignUpResult(recovered);
      }
    } catch (err) {
      console.error('[VoteButtons] signUp failed:', err);

      // 0x3a81d6fc = AlreadyRegistered() from the gatekeeper. The user already
      // signed up earlier; recover the stateIndex from the SignUp event. Only
      // show success if recovery actually reached `signed-up` — otherwise the
      // vote buttons would stay hidden behind a misleading "success" message.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('0x3a81d6fc') || /already.?registered/i.test(message)) {
        setTxSubstate('recovering');
        const recovered = await refreshSignUp();
        showSignUpResult(recovered, /* alreadyRegistered */ true);
      } else {
        setErrorDrawer({
          visible: true,
          message: extractErrorMessage(
            err,
            'Anmeldung für die Bürgerumfrage ist fehlgeschlagen.',
          ),
        });
      }
    } finally {
      setPhase('idle');
      setTxSubstate(null);
    }
  };

  // ----- Step 3: cast (or change) vote -----
  // Entry point for the 3 vote buttons. Gates on the on-device birthdate
  // (part of the private citizen-commitment preimage) before the vote runs —
  // a valid ballot needs it. If it's missing we stash the choice and open the
  // birthdate sheet; `handleBirthdateSubmit` resumes the vote once saved.
  const handleVote = async (support: VoteType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!canVote || !account || !pollAddress || pollId === null) return;
    if (signUpState.status !== 'signed-up') return;
    if (!gnosisAccount) {
      setErrorDrawer({ visible: true, message: 'Dein Konto wird noch geladen. Bitte versuche es gleich erneut.' });
      return;
    }

    try {
      const pre = await loadCitizenPreimage(account.address);
      if (!pre?.birthdate) {
        setPendingVote(support);
        setBirthdateSheetVisible(true);
        return;
      }
    } catch (err) {
      // If the secure-store read fails, fall through to the prompt rather than
      // casting a ballot that might be invalid for lack of a birthdate.
      console.warn('[VoteButtons] birthdate preflight read failed:', err);
      setPendingVote(support);
      setBirthdateSheetVisible(true);
      return;
    }

    await castVote(support);
  };

  // Persist the birthdate on-device, then resume the stashed vote.
  const handleBirthdateSubmit = async (isoDate: string) => {
    if (!account) return;
    const support = pendingVote;
    try {
      setSavingBirthdate(true);
      await setCitizenBirthdate(account, isoDate);
      setBirthdateSheetVisible(false);
      setPendingVote(null);
      if (support !== null) await castVote(support);
    } catch (err) {
      console.error('[VoteButtons] save birthdate failed:', err);
      setBirthdateSheetVisible(false);
      setPendingVote(null);
      setErrorDrawer({
        visible: true,
        message: extractErrorMessage(err, 'Geburtsdatum konnte nicht gespeichert werden.'),
      });
    } finally {
      setSavingBirthdate(false);
    }
  };

  // Close = cancel the vote cleanly (no error, no ballot).
  const handleBirthdateClose = () => {
    if (savingBirthdate) return;
    setBirthdateSheetVisible(false);
    setPendingVote(null);
  };

  const castVote = async (support: VoteType) => {
    if (!canVote || !account || !pollAddress || pollId === null) return;
    if (signUpState.status !== 'signed-up') return;
    if (!gnosisAccount) {
      setErrorDrawer({ visible: true, message: 'Dein Konto wird noch geladen. Bitte versuche es gleich erneut.' });
      return;
    }
    const kp = getKeypair();
    if (!kp) return;

    // Narrow the guarded state into locals so the detached settle closure keeps
    // their non-null types (TS widens captured state back to nullable otherwise).
    const voterAddress = account.address;
    const gAccount = gnosisAccount;
    const pollAddr = pollAddress;
    const pid = pollId;

    // Was this proposal already voted on? Changing an existing vote earns no reward.
    const isChangingVote = !!getLastVote(pollAddr);

    // The vote is committed once we've signed it, so the privacy sheet now shows
    // unconditionally (the ballot settles on chain in the background).
    const showPrivacySheet = () => {
      setChanging(false);
      setTimeout(() => {
        // Vote successfully cast (or changed) — the ballot is signed and
        // committed; the privacy sheet about to appear is the success moment.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setSuccessDrawer({ visible: true, message: VOTE_PRIVACY_MESSAGE, action: () => onVoteSuccess() });
      }, 350);
    };

    try {
      setVotingFor(support);
      setPhase('encrypting-vote');

      // ---- PREPARE (fast, gated): a failure here is a real error, no celebration ----
      // VoteType.For = 1, VoteType.Against = 0, VoteType.Abstain = 2 — matches the
      // MACI option indices on the Poll's vote-option tree.
      const optionIndex = toBigInt(support);
      // Next nonce from the persistent cache so cold-starts still bump monotonically.
      const nonce = getNextNonce(pollAddr);
      // Read the coordinator pubkey from the Poll itself — a poll is permanently
      // bound to the key it was deployed with, and the MACI circuit silently
      // discards ballots encrypted to the wrong key. A read failure ABORTS (no
      // celebration): a loud error beats a silently-lost ballot.
      const poll = getPollContract(pollAddr);
      const pollCoordinatorPub = (await readContract({
        contract: poll,
        method: 'function coordinatorPubKey() view returns (uint256 x, uint256 y)',
        params: [],
      })) as readonly [bigint, bigint];
      const coordinatorPubKey = new PubKey([
        toBigInt(pollCoordinatorPub[0]),
        toBigInt(pollCoordinatorPub[1]),
      ]);
      const { message, encPubKey } = buildVoteMessage({
        voterKeypair: kp,
        voterStateIndex: signUpState.stateIndex,
        pollId: pid,
        voteOptionIndex: optionIndex,
        voiceCredits: 1n, // 1 NFT = 1 credit, all-in
        nonce,
        coordinatorPubKey,
      });
      // ABI requires uint256[10] (fixed length); coerce from bigint[] for TS.
      const messageFixed = message as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
      const tx = prepareContractCall({
        contract: poll,
        method: 'function publishMessage((uint256[10] data) _message, (uint256 x, uint256 y) _encPubKey)',
        params: [{ data: messageFixed }, encPubKey],
      });

      // ---- Committed. The slow publish + mirror + claim run detached, with retry. ----
      const settle = async () => {
        const receipt = await sendTransaction({ transaction: tx, account: gAccount });
        // Participation only — the CHOICE never leaves the device in plaintext
        // (MACI encrypts it on-chain; mirroring it to analytics would undo that).
        track(Events.PROPOSAL_VOTED, {
          proposal_id: proposalId.toString(),
          poll_id: pid.toString(),
          nonce: nonce.toString(),
          tx_hash: receipt.transactionHash,
          encrypted: true,
        });
        // Persist the choice locally so the LastVoteCard can show it.
        await recordVote(pollAddr, support, nonce, receipt.transactionHash);
        // Mirror participation to Supabase first so the claim-reward verifier
        // finds the vote, then claim the payout (it lands via the reconcile).
        await recordVoteToSupabase({
          walletAddress: voterAddress,
          proposalId: proposalId.toString(),
          transactionHash: receipt.transactionHash,
        });
        await claimReward(voterAddress, 'proposal_vote', proposalId.toString()).catch(() => {});
      };

      if (isChangingVote) {
        // A changed vote earns no reward — settle quietly, show the privacy sheet.
        enqueueSettlement({ label: 'Stimme', amount: 0, settle });
        showPrivacySheet();
      } else {
        celebrateSettling({
          message: 'Stimme abgegeben',
          coin: 'single',
          subtitle: VOTE_REWARD_SUBTITLE,
          label: 'Stimme',
          loadingLabel: [
            'Stimme wird versiegelt…',
            'Belohnung wird vorbereitet…',
            'Fast geschafft…',
          ],
          settle,
          onClose: showPrivacySheet,
        });
      }
    } catch (err) {
      console.error('[VoteButtons] vote prepare failed:', err);
      setErrorDrawer({
        visible: true,
        message: extractErrorMessage(err, 'Stimme konnte nicht abgegeben werden.'),
      });
    } finally {
      setPhase('idle');
      setTxSubstate(null);
      setVotingFor(null);
    }
  };

  // ============== Rendering ==============

  if (!account) {
    return (
      <Container colors={colors}>
        <Text style={[styles.messageText, { color: colors.textSecondary }]}>
          Verbinde dein Wallet, um abzustimmen.
        </Text>
      </Container>
    );
  }

  if (!isCitizen) {
    return (
      <View style={styles.gateWrap}>
        <Text style={[styles.gateIntro, { color: colors.textSecondary }]}>
          Nur verifizierte Bürger:innen können bei Bürgerumfragen abstimmen.
        </Text>

        {/* Reuse the profile aspiring-citizen banner: "Jetzt beantragen" when no
            request exists, "Status ansehen" while a request is pending. */}
        <CitizenVerificationBanner pending={!!activePendingRequest} />

        <Pressable
          onPress={() =>
            router.push(
              (SUPPORT_ACCOUNT_ID
                ? `/messages/new?accountId=${SUPPORT_ACCOUNT_ID}`
                : '/help') as any,
            )
          }
          style={({ pressed }) => [
            styles.gateHelpButton,
            { borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Weitere Hilfe"
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
          <Text style={[styles.gateHelpButtonText, { color: colors.primary }]}>
            Weitere Hilfe
          </Text>
        </Pressable>
      </View>
    );
  }

  // Lookup in flight — brief loader while we resolve proposalPolls(id).
  if (pollLookupState === 'pending') {
    return (
      <Container colors={colors}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={[styles.messageText, { color: colors.textSecondary, marginTop: 8 }]}>
          Lade geheime Abstimmung…
        </Text>
      </Container>
    );
  }

  // The Governor returned the zero address — proposal isn't on the current
  // Governor (likely created on an older Governor that's since been rotated).
  // Render a clear terminal state instead of an infinite spinner.
  if (pollLookupState === 'orphan' || !pollAddress) {
    return (
      <View style={styles.container}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Abstimmung nicht aufrufbar</Text>
        <View style={[styles.stepCard, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.stepBody, { color: colors.textPrimary }]}>
            Diese Abstimmung wurde auf einem früheren Governor erstellt und ist nicht mehr
            aktiv. Erstelle einen neuen Vorschlag auf dem aktuellen Governor, um abzustimmen.
          </Text>
          <Pressable
            onPress={() =>
              Linking.openURL(`https://gnosisscan.io/address/${governorContract.address}#readContract`)
            }
            hitSlop={6}
            style={styles.basescanRow}
          >
            <Text style={[styles.basescanLink, { color: colors.textSecondary }]}>
              Aktuellen Governor im Explorer prüfen ↗
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Voting closed by Poll deadline. We use the Poll's own end time rather
  // than the OZ proposalState because the cached state from Supabase lags
  // behind chain — a proposal can be on-chain Active while Supabase still
  // has it as Pending.
  if (isVotingClosed) {
    // Once the chain has resolved the proposal (Defeated/Succeeded/Executed/
    // Canceled/Queued/Expired) the result is on chain and the badge plus
    // Wahlergebnisse already convey it. Drop the duplicate "Koordinator
    // entschlüsselt jetzt…" card. It only stays useful while liveState ==
    // Active — i.e. we're in the post-deadline grace window with no tally yet.
    const TERMINAL_STATES = new Set<ProposalState>([
      ProposalState.Defeated,
      ProposalState.Succeeded,
      ProposalState.Queued,
      ProposalState.Executed,
      ProposalState.Canceled,
      ProposalState.Expired,
    ]);
    if (liveState !== null && TERMINAL_STATES.has(liveState)) {
      return null;
    }

    return (
      <Container colors={colors}>
        <Text style={[styles.title, { color: colors.textPrimary, marginBottom: 4 }]}>
          Abstimmung beendet
        </Text>
        <Text style={[styles.messageText, { color: colors.textSecondary }]}>
          Eine unabhängige Stelle entschlüsselt jetzt die Stimmen und veröffentlicht das
          Ergebnis innerhalb von ca. 15 Minuten im dezentralen Netzwerk.
        </Text>
      </Container>
    );
  }

  if (keypairLoading) {
    return (
      <Container colors={colors}>
        <ActivityIndicator color={colors.textSecondary} />
        <Text style={[styles.messageText, { color: colors.textSecondary, marginTop: 8 }]}>
          Schlüssel wird geladen…
        </Text>
      </Container>
    );
  }

  if (signUpState.status === 'needs-keypair') {
    return (
      <View style={styles.container}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Geheim abstimmen</Text>
        <View style={[styles.stepCard, { backgroundColor: colors.surfaceSecondary }]}>
          <StoryProgress step={1} totalSteps={2} />
          <Text style={[styles.stepBody, { color: colors.textPrimary }]}>
            Erstelle deinen persönlichen Wahlschlüssel. Er bleibt auf deinem Gerät
            und versiegelt jede deiner Stimmen — wie ein Briefumschlag, den niemand
            allein öffnen kann. Nicht die Stadt, nicht die App. Niemand.
          </Text>
        </View>
        <Pressable
          style={[styles.primaryButton, phase !== 'idle' && styles.disabled]}
          onPress={handleGenerateKey}
          disabled={phase !== 'idle'}
        >
          <PrimaryButtonContent
            label={phase === 'creating-key' ? 'Schlüssel wird erstellt…' : 'Schlüssel erstellen'}
            isLoading={phase === 'creating-key'}
          />
        </Pressable>
        {renderDrawers()}
      </View>
    );
  }

  if (signUpState.status === 'needs-signup' || signUpState.status === 'unknown') {
    return (
      <View style={styles.container}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Geheim abstimmen</Text>
        <View style={[styles.stepCard, { backgroundColor: colors.surfaceSecondary }]}>
          <StoryProgress step={2} totalSteps={2} />
          <Text style={[styles.stepBody, { color: colors.textPrimary }]}>
            Melde dich einmalig zur Bürgerumfrage an. Danach gilt: ein Mensch,
            eine Stimme — egal wie viele Geräte du nutzt. Keine Bots, keine
            Doppelten, keine gekauften Meinungen.
          </Text>
        </View>
        <Pressable
          style={[styles.primaryButton, phase !== 'idle' && styles.disabled]}
          onPress={handleSignUp}
          disabled={phase !== 'idle'}
        >
          <PrimaryButtonContent
            label={getSignUpButtonLabel(phase, txSubstate)}
            isLoading={phase === 'signing-up'}
          />
        </Pressable>
        {renderDrawers()}
      </View>
    );
  }

  // signed-up & active: full vote UI
  const lastVote = pollAddress ? getLastVote(pollAddress) : null;
  // Show the 3-button row when the user has no recorded vote OR they tapped
  // "Stimme ändern". Otherwise show the LastVoteCard alone.
  const showButtons = !lastVote || changing;
  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Abstimmen</Text>
      {lastVote ? (
        <LastVoteCard
          vote={lastVote}
          canChange={isVotingOpen && !changing}
          onChangeVote={() => setChanging(true)}
        />
      ) : null}
      {!showButtons ? renderDrawers() : null}
      {showButtons ? (
      <>
      <View style={[styles.infoCard, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.infoText, { color: colors.textSecondary }]}>
          {lastVote
            ? 'Wähle erneut. Nur deine letzte Stimme zählt — die vorherige wird durch die neue überschrieben.'
            : 'Deine Stimme ist geheim — wie ein versiegelter Umschlag in der Wahlurne. Bis zum Ende der Frist kannst du sie beliebig oft ändern; nur die letzte zählt.'}
        </Text>
      </View>
      <View style={styles.buttonsContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.voteButton,
            styles.voteButtonFor,
            phase !== 'idle' && styles.disabled,
            pressed && styles.pressed,
          ]}
          onPress={() => handleVote(VoteType.For)}
          disabled={phase !== 'idle'}
        >
          <VoteButtonContent
            label={getVoteButtonLabel('Dafür', VoteType.For, phase, txSubstate, votingFor)}
            isLoading={phase !== 'idle' && votingFor === VoteType.For}
            spinnerColor="#ffffff"
            textStyle={styles.voteButtonText}
          />
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.voteButton,
            styles.voteButtonAgainst,
            phase !== 'idle' && styles.disabled,
            pressed && styles.pressed,
          ]}
          onPress={() => handleVote(VoteType.Against)}
          disabled={phase !== 'idle'}
        >
          <VoteButtonContent
            label={getVoteButtonLabel('Dagegen', VoteType.Against, phase, txSubstate, votingFor)}
            isLoading={phase !== 'idle' && votingFor === VoteType.Against}
            spinnerColor="#ffffff"
            textStyle={styles.voteButtonText}
          />
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.voteButton,
            { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.disabled },
            phase !== 'idle' && styles.disabled,
            pressed && styles.pressed,
          ]}
          onPress={() => handleVote(VoteType.Abstain)}
          disabled={phase !== 'idle'}
        >
          <VoteButtonContent
            label={getVoteButtonLabel('Enthalten', VoteType.Abstain, phase, txSubstate, votingFor)}
            isLoading={phase !== 'idle' && votingFor === VoteType.Abstain}
            spinnerColor={colors.textSecondary}
            textStyle={[styles.voteButtonText, { color: colors.textPrimary }]}
          />
        </Pressable>
      </View>
      {renderDrawers()}
      </>
      ) : null}
    </View>
  );

  function renderDrawers() {
    return (
      <>
        <ErrorDrawer
          visible={errorDrawer.visible}
          message={errorDrawer.message}
          onDismiss={() => setErrorDrawer({ visible: false, message: '' })}
        />
        <SuccessDrawer
          visible={successDrawer.visible}
          message={successDrawer.message}
          primaryButtonText="OK"
          onPrimaryAction={() => {
            setSuccessDrawer({ visible: false, message: '', action: null });
            if (successDrawer.action) successDrawer.action();
          }}
          onDismiss={() => {
            setSuccessDrawer({ visible: false, message: '', action: null });
            if (successDrawer.action) successDrawer.action();
          }}
        />
        <BirthdatePromptSheet
          visible={birthdateSheetVisible}
          onClose={handleBirthdateClose}
          onSubmit={handleBirthdateSubmit}
          saving={savingBirthdate}
        />
      </>
    );
  }
}

function Container({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.container}>
      <View style={[styles.messageContainer, { backgroundColor: colors.surfaceSecondary }]}>
        {children}
      </View>
    </View>
  );
}

/**
 * Resolve the inline button label for the MACI signup flow. The label tracks
 * three substates inside `signing-up`:
 *   - wallet-prompt: wallet popup is open, waiting on the user
 *   - tx-submitted:  tx is on chain, waiting for inclusion
 *   - (idle):        button is interactive — show the call-to-action
 */
function getSignUpButtonLabel(phase: Phase, substate: TxSubstate): string {
  if (phase !== 'signing-up') return 'Zur Bürgerumfrage anmelden';
  if (substate === 'recovering') return 'Anmeldung wird geprüft…';
  if (substate === 'wallet-prompt') return 'Wallet öffnet sich…';
  if (substate === 'tx-submitted') return 'Transaktion gesendet — warte auf Bestätigung…';
  return 'Anmeldung läuft…';
}

/**
 * Resolve the inline vote-button label. Only the button matching `votingFor`
 * shows the loading state; the other two stay idle (but disabled). Mirrors the
 * three substates from signup plus a separate "encrypting" phase that runs
 * fully on-device before the wallet ever opens.
 */
function getVoteButtonLabel(
  idleLabel: string,
  forOption: VoteType,
  phase: Phase,
  substate: TxSubstate,
  votingFor: VoteType | null,
): string {
  if (phase === 'idle' || votingFor !== forOption) return idleLabel;
  if (phase === 'encrypting-vote') return 'Stimme wird versiegelt…';
  if (phase === 'submitting-vote') {
    if (substate === 'wallet-prompt') return 'Wallet öffnet sich…';
    if (substate === 'tx-submitted') return 'Versiegelte Stimme wird eingeworfen…';
    return 'Abstimmen läuft…';
  }
  return idleLabel;
}

function PrimaryButtonContent({
  label,
  isLoading,
}: {
  label: string;
  isLoading: boolean;
}) {
  if (!isLoading) {
    return <Text style={styles.primaryButtonText}>{label}</Text>;
  }
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color="#ffffff" />
      <Text style={[styles.primaryButtonText, styles.loadingLabel]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function VoteButtonContent({
  label,
  isLoading,
  spinnerColor,
  textStyle,
}: {
  label: string;
  isLoading: boolean;
  spinnerColor: string;
  textStyle: any;
}) {
  if (!isLoading) {
    return <Text style={textStyle}>{label}</Text>;
  }
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color={spinnerColor} />
      <Text style={[textStyle, styles.loadingLabel]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter-Medium',
    marginBottom: 16,
  },
  stepCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  stepBody: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: '#00498B',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  primaryButtonText: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    color: '#ffffff',
  },
  infoCard: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    lineHeight: 18,
  },
  buttonsContainer: {
    gap: 12,
  },
  voteButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  voteButtonFor: {
    backgroundColor: '#10b981',
  },
  voteButtonAgainst: {
    backgroundColor: '#ef4444',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
  voteButtonText: {
    fontSize: 16,
    fontFamily: 'MonaSansSemiCondensed-Bold',
    color: '#ffffff',
  },
  statusLine: {
    marginTop: 12,
    fontSize: 13,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 4,
  },
  loadingLabel: {
    fontSize: 14,
    flexShrink: 1,
  },
  messageContainer: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  messageText: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
  },
  gateWrap: {
    marginVertical: 16,
  },
  gateIntro: {
    fontSize: 14,
    fontFamily: 'Inter-Regular',
    textAlign: 'center',
    marginHorizontal: 16,
    lineHeight: 20,
  },
  gateHelpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
  },
  gateHelpButtonText: {
    fontSize: 14,
    fontFamily: 'MonaSansSemiCondensed-Bold',
  },
  basescanRow: {
    marginTop: 12,
  },
  basescanLink: {
    fontSize: 12,
    fontFamily: 'Inter-Regular',
    textDecorationLine: 'underline',
  },
});
