export type UnreadCountParameters = {
  after?: string;
  walletAddress?: string;
};

export class UnreadCountRequestError extends Error {}

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Normalise the small, public input surface for the unread-count reader.
 *
 * The same validation serves the legacy JSON request and the staging-safe
 * query-string reader.  It deliberately accepts only an ISO date and a full
 * EVM address; callers must not pass database filters through this boundary.
 */
export function parseUnreadCountParameters(input: {
  since?: unknown;
  wallet?: unknown;
}): UnreadCountParameters {
  const { since, wallet } = input;

  if (since !== undefined && typeof since !== "string") {
    throw new UnreadCountRequestError("Invalid since timestamp");
  }

  if (wallet !== undefined && typeof wallet !== "string") {
    throw new UnreadCountRequestError("Invalid wallet address");
  }

  let after: string | undefined;
  if (since) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      throw new UnreadCountRequestError("Invalid since timestamp");
    }
    after = parsed.toISOString();
  }

  if (wallet && !WALLET_PATTERN.test(wallet)) {
    throw new UnreadCountRequestError("Invalid wallet address");
  }

  return { after, walletAddress: wallet };
}

/** Query strings may not repeat either bounded reader parameter. */
export function readUnreadCountQuery(searchParams: URLSearchParams) {
  const since = searchParams.getAll("since");
  const wallet = searchParams.getAll("wallet");
  if (since.length > 1 || wallet.length > 1) {
    throw new UnreadCountRequestError("Repeated query parameter");
  }

  return parseUnreadCountParameters({
    since: since[0],
    wallet: wallet[0],
  });
}
