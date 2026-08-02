import Stripe from "stripe";

/**
 * Stripe clients are constructed LAZILY, on first property access.
 *
 * A module-level `throw` here breaks far more than Stripe: Next.js imports
 * every API route while collecting page data at build time, so an unset
 * STRIPE_SECRET_KEY failed the entire `next build` — which is exactly what a
 * fork without payment credentials hits (see docs/FORKING_GUIDE.md, record
 * mode). Deferring the check to first use keeps the build and every unrelated
 * route working, while a real Stripe call still fails loudly and specifically.
 * Same reasoning as the Supabase client in lib/supabase.ts.
 */
function lazyStripe(readKey: () => string | undefined, label: string): Stripe {
  let client: Stripe | null = null;
  return new Proxy({} as Stripe, {
    get(_target, prop) {
      if (!client) {
        const key = readKey();
        if (!key) {
          throw new Error(
            `${label} is not set — Stripe is not configured in this deployment.`,
          );
        }
        client = new Stripe(key);
      }
      return Reflect.get(client, prop, client);
    },
  });
}

// The default/primary Stripe client — used for event tickets and anything
// else that shares the main Stripe account.
export const stripe = lazyStripe(
  () => process.env.STRIPE_SECRET_KEY,
  "STRIPE_SECRET_KEY",
);

/**
 * Röbel Card Stripe client. The voucher system runs on a SEPARATE Stripe
 * account (different business entity / compliance profile), so it has its
 * own secret key, publishable key, and webhook signing secret:
 *
 *   STRIPE_SECRET_KEY_CARD          (used here, server-side)
 *   NEXT_PUBLIC_STRIPE_PUBLIC_KEY_CARD (client-side, for Stripe Elements)
 *   STRIPE_WEBHOOK_SECRET_CARD      (webhook signature verification)
 *
 * Falls back to the default key if the card-specific key is missing so
 * local dev without the split setup still works.
 */
export const stripeCard = lazyStripe(
  () => process.env.STRIPE_SECRET_KEY_CARD ?? process.env.STRIPE_SECRET_KEY,
  "STRIPE_SECRET_KEY_CARD (or STRIPE_SECRET_KEY)",
);

// Event ticket configuration
export const TICKET_CONFIG = {
  event_name: "MV Boxen Landesmeisterschaft 2026",
  event_location: "Turnhalle am Gotthunskamp, Röbel/Müritz",
  price_cents: 299, // €2.99
  currency: "eur",
  days: {
    saturday: { date: "7. März 2026", label: "Samstag" },
    sunday: { date: "8. März 2026", label: "Sonntag" },
  },
} as const;

export type EventDay = keyof typeof TICKET_CONFIG.days;

// Generate a unique ticket code
export function generateTicketCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars like 0/O, 1/I
  let code = "BOXEN-2026-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ---------------------------------------------------------------------------
// Röbel Card voucher configuration
// ---------------------------------------------------------------------------

/**
 * Röbel Card voucher configuration.
 *
 * Differentiated fee model by buyer type:
 *   citizen  — no fee; card gets full face value.
 *   tourist  — fee on top (default 10 %, optional 15/20/25 % generous tiers).
 *   sachbezug — fee deducted from total (org pays ≤50 €, card gets remainder).
 *
 * Fee split (when fee > 0):
 *   - Half to the chosen Verein (or Röbeler Topf)
 *   - The rest: partner redemption bonus + operational (implicit, reconciled at payout)
 */
export const ROEBEL_CARD_CONFIG = {
  currency: "eur",
  MIN_AMOUNT_CENTS: 500, //   5 €
  MAX_AMOUNT_CENTS: 50000, // 500 €
  PRESET_AMOUNTS_CENTS: [1000, 2500, 5000, 10000] as const,
  FEE_BPS: 1000, // 10 %
  VEREINE_BPS: 500, // 5 %
  SACHBEZUG_ALLOWED_CENTS: [1000, 2500, 5000] as const,
  ALLOWED_DONATION_BPS: [1000, 1500, 2000, 2500] as const,
} as const;

export type FeeMode = "citizen" | "tourist" | "sachbezug";

/**
 * Compute fee, Vereine share, card credit, and Stripe total for a
 * Röbel Card purchase.
 *
 * - `citizen`:  fee = 0, total = amountCents (card gets full value)
 * - `tourist`:  fee = amountCents * feeBps/10000, total = amount + fee
 * - `sachbezug`: fee = amountCents * 10%, card = amount - fee, total = amount
 */
export function computeRoebelCardFee(
  amountCents: number,
  feeMode: FeeMode = "tourist",
  donationBps?: number,
): {
  cardCreditCents: number;
  feeCents: number;
  vereineCents: number;
  totalCents: number;
} {
  if (feeMode === "citizen") {
    return {
      cardCreditCents: amountCents,
      feeCents: 0,
      vereineCents: 0,
      totalCents: amountCents,
    };
  }

  const bps =
    feeMode === "tourist"
      ? (donationBps ?? ROEBEL_CARD_CONFIG.FEE_BPS)
      : ROEBEL_CARD_CONFIG.FEE_BPS;

  const feeCents = Math.floor((amountCents * bps) / 10000);
  // Vereine get half the fee bps.
  const vereineBps = Math.floor(bps / 2);
  const vereineCents = Math.floor((amountCents * vereineBps) / 10000);

  if (feeMode === "sachbezug") {
    // Fee is deducted from the total paid.
    return {
      cardCreditCents: amountCents - feeCents,
      feeCents,
      vereineCents,
      totalCents: amountCents, // org pays exactly this amount
    };
  }

  // tourist — fee on top
  return {
    cardCreditCents: amountCents,
    feeCents,
    vereineCents,
    totalCents: amountCents + feeCents,
  };
}

export interface RoebelCardCheckoutMetadata {
  kind: "roebel_card";
  wallet_address: string;
  amount_cents: string;
  fee_cents: string;
  vereine_cents: string;
  beneficiary_account_id: string;
  purchase_id: string;
  fee_mode: string;
}

/**
 * Validates that a Stripe session's metadata is a well-formed
 * Röbel Card checkout. Throws on missing/invalid fields so the webhook
 * handler can fail loudly with a specific error.
 */
export function parseRoebelCardMetadata(
  metadata: Stripe.Metadata | null,
): RoebelCardCheckoutMetadata {
  if (!metadata) {
    throw new Error("missing metadata on Stripe session");
  }
  if (metadata.kind !== "roebel_card") {
    throw new Error(`unexpected metadata.kind: ${metadata.kind}`);
  }
  const required = [
    "wallet_address",
    "amount_cents",
    "fee_cents",
    "vereine_cents",
    "purchase_id",
  ] as const;
  for (const key of required) {
    if (!metadata[key]) {
      throw new Error(`missing metadata.${key}`);
    }
  }
  return {
    kind: "roebel_card",
    wallet_address: metadata.wallet_address,
    amount_cents: metadata.amount_cents,
    fee_cents: metadata.fee_cents,
    vereine_cents: metadata.vereine_cents,
    beneficiary_account_id: metadata.beneficiary_account_id ?? "",
    purchase_id: metadata.purchase_id,
    fee_mode: metadata.fee_mode ?? "tourist",
  };
}
