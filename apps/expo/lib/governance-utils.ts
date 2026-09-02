import { ProposalState, ProposalVotes, VotePercentages } from './governance-types';
import { balanceOf } from 'thirdweb/extensions/erc721';
import { governanceCitizenNFTContract as citizenNFTContract } from '@/constants/thirdweb';

/**
 * Get human-readable proposal state name (German)
 */
export function getProposalStateName(state: ProposalState): string {
  switch (state) {
    case ProposalState.Pending:
      return 'Ausstehend';
    case ProposalState.Active:
      return 'In Abstimmung';
    case ProposalState.Canceled:
      return 'Abgebrochen';
    case ProposalState.Defeated:
      return 'Abgelehnt';
    case ProposalState.Succeeded:
      return 'Genehmigt';
    case ProposalState.Queued:
      return 'In Warteschlange';
    case ProposalState.Expired:
      return 'Abgelaufen';
    case ProposalState.Executed:
      return 'Ausgeführt';
    default:
      return 'Unbekannt';
  }
}

/**
 * Get color for proposal state badge (matching mockup design)
 */
export function getProposalStateColor(state: ProposalState): {
  background: string;
  text: string;
} {
  switch (state) {
    case ProposalState.Active:
      return { background: '#FEF3C7', text: '#92400E' }; // Yellow/orange
    case ProposalState.Succeeded:
    case ProposalState.Executed:
      return { background: '#D1FAE5', text: '#065F46' }; // Green
    case ProposalState.Defeated:
    case ProposalState.Canceled:
      return { background: '#FEE2E2', text: '#991B1B' }; // Red
    case ProposalState.Pending:
      return { background: '#FFFBEB', text: '#92400E' }; // Light yellow
    case ProposalState.Queued:
      return { background: '#DBEAFE', text: '#1E40AF' }; // Blue
    case ProposalState.Expired:
      return { background: '#F3F4F6', text: '#374151' }; // Gray
    default:
      return { background: '#F3F4F6', text: '#6B7280' }; // Default gray
  }
}

/**
 * Check if proposal is currently active for voting
 */
export function isProposalActive(state: ProposalState): boolean {
  return state === ProposalState.Active;
}

/**
 * Format proposal description (truncate if needed)
 */
export function formatProposalDescription(
  description: string,
  maxLength: number = 100
): string {
  if (description.length <= maxLength) {
    return description;
  }
  return description.substring(0, maxLength) + '...';
}

/**
 * Calculate vote percentages from vote counts
 */
export function calculateVotePercentages(votes: ProposalVotes): VotePercentages {
  const total = votes.forVotes + votes.againstVotes + votes.abstainVotes;

  if (total === 0n) {
    return {
      forPercent: 0,
      againstPercent: 0,
      abstainPercent: 0,
      totalVotes: 0n,
    };
  }

  // Convert to numbers for percentage calculation
  const totalNum = Number(total);
  const forNum = Number(votes.forVotes);
  const againstNum = Number(votes.againstVotes);
  const abstainNum = Number(votes.abstainVotes);

  return {
    forPercent: (forNum / totalNum) * 100,
    againstPercent: (againstNum / totalNum) * 100,
    abstainPercent: (abstainNum / totalNum) * 100,
    totalVotes: total,
  };
}

/**
 * Shorten ethereum address
 */
export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Check if an address owns a Citizen NFT
 */
export async function checkCitizenStatus(address: string): Promise<boolean> {
  try {
    const balance = await balanceOf({
      contract: citizenNFTContract,
      owner: address,
    });
    return balance > 0n;
  } catch (error) {
    console.error('Error checking citizen status:', error);
    return false;
  }
}

/**
 * Format bigint to readable number string
 */
export function formatBigInt(value: bigint): string {
  return value.toString();
}

/**
 * Hermes-safe coercion to bigint.
 *
 * Hermes (React Native's JS engine) does not accept `BigInt(<Number>)` for
 * runtime values — only `bigint`, `string`, or `boolean` arguments. Passing
 * a JS Number (which is what thirdweb's typegen returns for any uint < 53
 * bits, including `clock()` → uint48) throws
 *   `TypeError: Cannot convert N to BigInt`
 *
 * Routing through `String(...)` always succeeds because `BigInt("123")` is
 * universally supported. Use this for any contract read whose ABI return type
 * isn't already pre-narrowed to bigint.
 */
export function toBigInt(raw: unknown): bigint {
  if (typeof raw === 'bigint') return raw;
  if (raw === null || raw === undefined) return 0n;
  return BigInt(String(raw));
}

/**
 * Human-readable German label + tone for a proposal state.
 * Used to drive UI copy in vote panels, list items, and badges.
 */
export type ProposalStateMessage = {
  label: string;
  detail: string;
  tone: 'pending' | 'active' | 'success' | 'failure' | 'neutral';
};

export function getStateMessage(state: ProposalState | undefined): ProposalStateMessage {
  switch (state) {
    case ProposalState.Pending:
      return {
        label: 'Abstimmung beginnt gleich',
        detail: 'Die Abstimmung startet, sobald der nächste Block verarbeitet wurde. Komm gleich zurück.',
        tone: 'pending',
      };
    case ProposalState.Active:
      return {
        label: 'Abstimmung läuft',
        detail: 'Du kannst jetzt verschlüsselt abstimmen. Stimmen können bis zum Ende der Frist geändert werden.',
        tone: 'active',
      };
    case ProposalState.Succeeded:
      return {
        label: 'Vorschlag angenommen',
        detail: 'Die Mehrheit hat dafür gestimmt. Der Vorschlag wartet auf die Ausführung im Timelock.',
        tone: 'success',
      };
    case ProposalState.Defeated:
      return {
        label: 'Vorschlag abgelehnt',
        detail: 'Es gab nicht genug Ja-Stimmen oder das Quorum wurde nicht erreicht.',
        tone: 'failure',
      };
    case ProposalState.Queued:
      return {
        label: 'In Timelock-Warteschlange',
        detail: 'Der Vorschlag wurde angenommen und wartet auf das Ablaufen der Timelock-Frist.',
        tone: 'success',
      };
    case ProposalState.Executed:
      return {
        label: 'Ausgeführt',
        detail: 'Der Vorschlag wurde erfolgreich auf der Blockchain ausgeführt.',
        tone: 'success',
      };
    case ProposalState.Canceled:
      return {
        label: 'Zurückgezogen',
        detail: 'Dieser Vorschlag wurde vor Ablauf der Frist zurückgezogen.',
        tone: 'neutral',
      };
    case ProposalState.Expired:
      return {
        label: 'Frist abgelaufen',
        detail: 'Die Frist zur Ausführung ist abgelaufen, ohne dass der Vorschlag ausgeführt wurde.',
        tone: 'neutral',
      };
    default:
      return {
        label: 'Status wird geladen…',
        detail: 'Die Daten zu diesem Vorschlag sind noch nicht vollständig.',
        tone: 'neutral',
      };
  }
}

/**
 * Calculate reading time estimate in minutes
 */
export function calculateReadingTime(text: string): number {
  const wordsPerMinute = 200;
  const wordCount = text.split(/\s+/).length;
  const readingTime = Math.ceil(wordCount / wordsPerMinute);
  return Math.max(1, readingTime); // Minimum 1 min
}
