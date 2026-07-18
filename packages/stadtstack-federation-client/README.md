# Stadtstack federation client

Strict, browser-safe and read-only consumer for Stadtstack's reviewed public
civic-case federation endpoints. It has no Netizen, wallet, authentication,
Supabase, database or write dependency.

The client only accepts the pinned v1 case-index, manifest and seven-stage
snapshot contracts. It confines every linked URL to the configured Stadtstack
origin and expected path, verifies the stable stage-map SHA-256 in the browser,
and rejects redirects, oversized responses, timeouts, `404`, `410`, unknown
fields and cross-contract mismatches. A `200` case index with `cases: []` is the
only empty state. In v0.1 a `410` hides all case content as `withdrawn`; the
client intentionally does not render its body until the additive checksummed
publication-notice contract is implemented.

URL confinement applies to every federation resource fetched or opened by the
v0.1 client (`manifest`, `stage-map`, artifact and public-case URLs). The stage
contract also parses optional public-action and proof references, but the first
Röbel UI slice must not render or open those fields; a dedicated reviewed
external-link policy is required before they become interactive.

```ts
import { loadReviewedCivicCases } from "@roebel/stadtstack-federation-client";

const result = await loadReviewedCivicCases({
  baseUrl: "https://zk-residency.vercel.app",
  municipalityId: "roebel-mueritz",
});
```
