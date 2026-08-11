# Kickoff documents

Briefs handed to specialised agents. Each is self-contained: mission, verified
current state with file references, hard constraints, sliced deliverables, and
the open questions its author could not decide alone.

A kickoff is not a plan. It ends where a design begins — most of these require a
decision memo before any code.

| Doc | Mission | Blocks on |
|---|---|---|
| [K1 — Netizen Accounts replaces thirdweb](2026-08-11_K1_NETIZEN_ACCOUNTS_REPLACES_THIRDWEB.md) | Serve every capability thirdweb provides from our own stack, so a community launches without a vendor account | Migration-strategy memo (Slice 0) |
| [K2 — Nostr read fallback](2026-08-11_K2_NOSTR_READ_FALLBACK.md) | Let the app read from the sovereign record, so a fork runs without our Supabase | Nothing — start here |
| [K3 — Identity inversion](2026-08-11_K3_IDENTITY_INVERSION.md) | Make a key the user owns the root of identity, not a vendor's smart account | K1 Slice 0 |
| [Strategy — Ortis one-click community launch](2026-08-11_STRATEGY_ORTIS_ONE_CLICK_COMMUNITY.md) | Few clicks in the Ortis Dashboard → deployed stack + installable PWA for another town or a political party | K1 + K2; decisions in §3a and §7.1 now settled |
| [K4 — Ortis Dashboard](2026-08-11_K4_ORTIS_DASHBOARD.md) | The operator-facing surface: sign up, describe a community, launch it, manage it | Nothing — contract-first against a mock. Works in `Netizen-Labs`, not this repo |

**Cross-repo note:** the Netizen Accounts packages and the Ortis dashboard live
in `MaxBrych/Netizen-Labs`, not in this repo. Every doc states which repo its
work happens in.
