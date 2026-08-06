import { formatAtomic, type MeteringConfig } from "./config.js";
import { BULK_MAX_LIMIT } from "./bulk.js";

/**
 * The human (and human-reading-a-docs-page) landing page for the paid tier.
 * Styled like the indexer's root page — same dark, monospace, `#7ABBF2`-link
 * idiom — so the free and paid tiers of one node read as one product.
 */
export function payPageHtml(cfg: MeteringConfig): string {
  const price = (atomic: string) => `${formatAtomic(atomic, cfg.assetDecimals)} ${cfg.assetName}`;
  const treasuryShare = 100 - cfg.splitAuthors;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pay for machine-scale access — ${cfg.nodeId}</title>
<style>body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:44rem;margin:3rem auto;padding:0 1rem;line-height:1.6;background:#111;color:#ddd}a{color:#7ABBF2}code{background:#222;padding:.1rem .35rem;border-radius:4px}pre{background:#222;padding:.75rem 1rem;border-radius:6px;overflow-x:auto}h1{font-size:1.3rem}h2{font-size:1.05rem;margin-top:2rem}</style>
</head><body>
<h1>Metered access to the "${cfg.nodeId}" public record</h1>
<p>The record itself is free and always will be. This page covers the paid
tier: bulk, full-history and streaming access, priced for machines rather
than browsers, paid for per-request over <a href="https://x402.org">x402</a>
— no account, no API key, no subscription.</p>

<h2>What is free</h2>
<p>Ordinary reads never need payment. <a href="/events?limit=10">/events</a>
covers everything a citizen's browser or a small script needs (kinds,
authors, ids, since, until, node, full-text <code>q</code> — capped at a
sane per-request limit). <a href="/stats">/stats</a> shows what this index
holds, by node and kind, at no cost.</p>

<h2>What is paid</h2>
<ul>
<li><code>GET /bulk/events</code> — ${price(cfg.prices.bulk)} per request. The
same filter grammar as the free <code>/events</code> (<code>q</code>,
<code>kinds</code>, <code>authors</code>, <code>since</code>, <code>until</code>,
<code>node</code>) — except the <code>ids</code>, <code>e</code>, <code>p</code>
and <code>d</code> tag filters, which the bulk query builder deliberately
drops — but up to ${BULK_MAX_LIMIT.toLocaleString("en-US")} events per page
with keyset pagination via <code>cursor</code>.</li>
<li><code>GET /export</code> — ${price(cfg.prices.export)} per request. The
node's entire history (optionally filtered by <code>kinds</code>), streamed
as NDJSON, one signed event per line.</li>
<li><code>GET /firehose</code> — ${price(cfg.prices.firehoseDay)} per
24-hour pass. A Server-Sent-Events stream of every new event as this index
ingests it.</li>
</ul>

<h2>How an agent pays</h2>
<ol>
<li>Send the request as normal, e.g. <code>GET /bulk/events?kinds=1</code>.
No payment on the first try gets a <code>402 Payment Required</code>.</li>
<li>The 402 body is self-describing: an <code>accepts</code> array of x402
payment requirements — network, asset, exact amount, <code>payTo</code>.
Nothing to look up out of band.</li>
<li>Sign an EIP-3009 <code>TransferWithAuthorization</code> typed-data
message for that exact amount (the asset's own EIP-712 domain — name,
version, chain id — comes straight out of <code>accepts[0].extra</code>).
No on-chain transaction from the payer; the signature itself is the payment
authorization.</li>
<li>Retry the same request with an <code>X-PAYMENT</code> header: the
signed payload, base64-JSON-encoded. The gateway verifies and settles it
against the facilitator, then serves the response with an
<code>X-PAYMENT-RESPONSE</code> header confirming settlement.</li>
</ol>

<pre>curl -s "https://${cfg.publicBase.replace(/^https?:\/\//, "")}/bulk/events?kinds=1" \\
  -H "X-PAYMENT: $(node sign-payment.js)"</pre>

<h2>Where the money goes</h2>
<p>Every sale splits <strong>${cfg.splitAuthors}%</strong> to the authors of
the data actually served (pro-rata by event count, accrued per pubkey) and
<strong>${treasuryShare}%</strong> to the community treasury. Live totals,
the split, and top accruals by author are public at
<a href="/metering/stats">/metering/stats</a> — nothing here is asserted
without the ledger to back it.</p>
<p>Authors can opt out of monetization entirely: an excluded pubkey's
events never appear in a paid response, and never accrue anything, while
staying fully available on the free tier.</p>

<p>Built on the <a href="https://github.com/Roebel-Labs/Roebel-App">Röbel App</a> / Netizen stack.</p>
</body></html>`;
}
