# Hetzner Sovereign Infra Migration — Design Spec

> **Status:** DRAFT for review · 2026-07-25 · grounded in the existing sovereign corpus.
> **Scope:** the **infra / hosting cutover** — *where each service physically runs and who owns the
> compute* — to reach **EU data residency under EU-owned hardware**. This is the operational
> realization of the [Netizen Node](2026-07-21-netizen-stack-design.md) (§4) and OS-SPEC "Stage-1b
> sovereignty hardening"; it is **not** the protocol-extraction plan (that is blueprint §7) and does
> not re-decide the trust rails. It fills the gaps those docs left open (Vercel, maps, analytics,
> email, video, image-gen, backups/HA, mobile-push mitigations).
> **Anchor sources:** [`2026-07-21-netizen-stack-design.md`](2026-07-21-netizen-stack-design.md) ·
> [`2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md`](../../future-research/2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md)
> (adversarially verified) · [`SOVEREIGN_AI_FUTARCHY.md`](../../future-research/SOVEREIGN_AI_FUTARCHY.md).

## 1. Goal & what "sovereign" means here (precisely)

Move the **operational** layer — the part that is "Max's Supabase project + Vercel + two Fly apps +
thirdweb + Cloudflare + US AI APIs" — onto **infrastructure we control, physically in the EU, owned
by an EU company (Hetzner: Germany/Finland)**. Three distinct wins, ranked:

1. **Data residency + jurisdiction.** All personal data (users, posts, DMs, consent logs) stored on
   Hetzner (EU-owned) → out from under the US **CLOUD Act**, which reaches Supabase/Vercel/Cloudflare
   even in their EU regions (US parent companies). This is the biggest concrete GDPR/sovereignty gain
   and it is achievable *today*.
2. **Operational self-custody.** We can stand the whole backend up ourselves, repeatably (`netizen init`),
   with no vendor able to deplatform or price-gate us.
3. **Compute sovereignty for AI.** Sensitive inference runs on our own GPU, in the EU, under a
   governance-controlled egress policy — never leaving for a US model unless policy allows (FUTARCHY §1).

**Non-goal:** a new chain, a novel database, or self-hosting things the corpus already decided to
*rent* (Gnosis, Safe hosted infra, Monerium EMI). Sovereignty is *self-hostable + repeatable*, not
"on-chain everything" (blueprint §1). We keep every seam **provider-agnostic** so cutover is config,
not rewrite.

## 2. Component inventory — current → sovereign target

Legend: **Effort** S/M/L/XL · **Decided** = replacement already chosen in the corpus (cited) · **Gap** =
this spec is the first to decide it.

| Service | Today (vendor / jurisdiction) | Sovereign target (Hetzner/EU) | Source |
|---|---|---|---|
| **Postgres + API + Realtime + Storage** | Supabase (AWS, US parent) | **Self-hosted Supabase OSS** on Hetzner (Docker/Coolify); Storage → S3-compatible **MinIO/Garage**. NSP-4 is the contract, Supabase the impl. **M** | Decided — blueprint §4(1), §3 L5 |
| **Auth** | Supabase Auth + `x-wallet-address` MVP | **SIWE** (EIP-1271-aware) issuing node JWTs. **M** | Decided — blueprint §4(2) |
| **Web hosting** | **Vercel** (US) | **Coolify on Hetzner** (self-hosted Vercel-equivalent: git→build→deploy, TLS, preview URLs). **M** | **Gap** (corpus only flags Vercel as a persisting SPOF, blueprint §8) |
| **Coordinator + workers** | 2× Fly.io apps (US) | Docker on Hetzner (or Coolify). **S** | Node §4(5) |
| **Mobile app** | Expo client | unchanged (client). Build/OTA = EAS cloud → optionally **self-hosted `expo-updates` server** + own CI later. **S now / L later** | **Gap** (self-host-updates not in corpus) |
| **AI — text** | Claude / OpenAI (US) | **EuroLLM-22B** (Apache-2.0) on a Hetzner **GPU box** behind **LiteLLM**; Claude kept as *frontier fallback* behind the same gateway; **SOOFI-S** = upgrade trigger. **L** | Decided — RESEARCH §5 |
| **AI — serving engine** | (n/a) | **vLLM or SGLang** on the GPU box (LiteLLM routes, it does not serve) — **still undecided** | **Open** — RESEARCH left "vLLM/SGLang specifics" unverified |
| **AI — image gen** | KIE / Seedream (non-EU) | provider **behind LiteLLM/gateway**; EU/self-host option (SDXL/FLUX on GPU) or an EU API; low priority | **Gap** (corpus covers text only) |
| **Wallet / smart account / bundler** | **thirdweb** (US) | **Safe smart account + Safe passkey module + react-native-passkeys (PRF) + Alto/Voltaire bundler + self-run paymaster** on Gnosis. **XL** | Decided — RESEARCH §1, §7 |
| **Fiat rail** | Monerium (EU EMI) + Stripe (US) | **Keep Monerium** (regulated EMI — never self-host); drop/retain Stripe as optional. **S** | Decided — RESEARCH §7, BIZPLAN §2 |
| **Email (transactional/newsletter)** | Resend (US) | **EU sender** (Scaleway TEM / Mailjet EU) or self-host Postal (deliverability caveat). **S–M** | **Gap** |
| **Video** | Cloudflare Stream (US) | Storage-backed HLS (MinIO + own transcode) or **EU CDN**; pluggable. **M** | Node §4(7) (pluggable) |
| **Maps** | Mapbox + Google Maps (US) | **MapLibre + OpenStreetMap** tiles (self-host tileserver or EU tile provider). **M** | **Gap** |
| **Analytics / errors** | PostHog Cloud (EU region exists) + Sentry | **Self-hosted PostHog** on Hetzner; self-host GlitchTip/Sentry. **S–M** | **Gap** |
| **Push** | Expo Push → **APNs/FCM** (Apple/Google) | notifications hub is ours; **APNs/FCM irreducible** (native) — see §6. **—** | Irreducible — blueprint §8 |
| **RPC** | thirdweb/public RPC | EU RPC provider or **own Gnosis node** (`eth_getLogs`; archive/trace only if Voltaire safe-mode needs it). **S–M** | RESEARCH §7 |
| **Identity anonymity / attestation** | — | **Semaphore v4** (live on Gnosis); keep **custom soulbound NFTs** (EAS is *not* on Gnosis). **—** | Decided — RESEARCH §4 |
| **Safe backend** | Safe hosted tx-service/client-gateway | **Keep hosted** (decision 2026-07-21); self-host `safe-transaction-service` = documented fallback only. **—** | Decided — blueprint §10 |
| **DNS / TLS / domain** | (registrar) + Vercel/CF | EU registrar + Coolify/Traefik + Let's Encrypt. **S** | **Gap** |

## 3. Target Hetzner topology (concrete)

Town-scale data is *small* (a few GB of Postgres per community — blueprint §1), so this is modest and
horizontal, not hyperscaler:

```
Hetzner (EU: Nürnberg/Falkenstein/Helsinki)
├── app-node-1  (dedicated, e.g. AX52 / CCX)   ── Coolify host
│     ├── Supabase stack (Postgres, PostgREST, GoTrue/SIWE, Realtime, Storage→MinIO, Studio, Kong)
│     ├── Next.js web (apps/web)               ── preview + prod deploys
│     ├── Coordinator + workers (ex-Fly)
│     ├── LiteLLM gateway  ── routes to GPU box + frontier fallback
│     ├── PostHog (self-host) · GlitchTip
│     └── Traefik (TLS, routing) · automated encrypted backups → Hetzner Storage Box (offsite)
├── gpu-node-1  (GEX44 20GB → 7B, or GEX131 96GB → 30B/70B-FP8)
│     └── vLLM/SGLang serving EuroLLM-22B (+ image model optional)   ── private net to LiteLLM
└── (later) HA: app-node-2 + Postgres streaming replica + failover; per-new-town → its own node
```

- **Start:** one app box + one GPU box. Add HA (replica + second app node) once it hosts real users.
- **Backups:** nightly `pg_dump` + WAL/PITR to an **offsite Hetzner Storage Box** (different DC), encrypted, restore-tested monthly. This is the #1 ops gap the corpus never specified — it is mandatory before any prod cutover.
- **Secrets:** move off Vercel/Fly env into a self-hosted vault (Infisical/OpenBao) or Coolify secrets; the `service_role`, coordinator keys, paymaster key never leave the EU box.

## 4. Migration order — strangler-fig, never pause Röbel

**Hard rule (inherited, blueprint §7): never pause the Röbel app to build infra.** Each service cuts
over independently, behind its provider-agnostic seam, with a **verify + rollback** per step. Staging
(already a full clone) is the rehearsal ground for every one of these.

| # | Cut over | Prep | Cutover | Verify | Rollback |
|---|---|---|---|---|---|
| **P0** | *Schema-in-git* (prereq, = blueprint Phase 0) | Dump live schema→migrations in `packages/node` | already proven on staging | fresh box serves app | keep Supabase cloud |
| **P1** | **Web → Coolify** | Coolify on app-node-1; import repo; set env (staging Supabase first) | point a preview domain, then `stage.roebel.app`, then prod domain | parity vs Vercel deploy; Lighthouse; SSR/API routes | DNS back to Vercel (both live in parallel) |
| **P2** | **Supabase → self-host** | Deploy Supabase OSS; `pg_dump`/restore prod (off-peak, PITR fence) | flip `NEXT_PUBLIC_SUPABASE_URL` + keys via env; short read-only window | row counts, RLS, edge fns, realtime, auth | flip env back to cloud (keep cloud warm N days) |
| **P3** | **Coordinator + workers → Hetzner** | Dockerize; move secrets | cron/worker DNS swap | a full MACI tally session end-to-end | Fly stays warm |
| **P4** | **AI → LiteLLM + EuroLLM** | GPU box + vLLM/SGLang; LiteLLM in front of *both* local + Claude | route by data-class policy (sensitive→local) | Mecky quality A/B; egress audit log | LiteLLM routes 100% to frontier |
| **P5** | **Peripheral SaaS** (maps, analytics, video, email, RPC) | stand up EU/self-host equivalents | swap per-integration flags | feature parity each | provider flag flip |
| **P6** | **thirdweb → Safe+passkeys+own 4337** (own milestone) | build the *unshipped* gasless passkey ref impl; test on Chiado | opt-in cohort → default | signup/vote/pay on passkey wallet; PRF-floor fallback | thirdweb stays for legacy wallets |

**Gate (blueprint §8 / §7):** P0–P2 are pure debt-paydown + the CLOUD-Act win — justified regardless.
**P6 is the highest-risk item** — RESEARCH §1 flags the end-to-end gasless-passkey-on-Gnosis reference
as *"the reference implementation nobody has shipped."* Treat it as R&D with its own spec, gated on
Chiado proof + the PRF device-floor fallback (iOS18/Android14) being solved.

## 5. AI sovereignty details

- **Model:** EuroLLM-22B (Apache-2.0) primary; honest that it trails Gemma-3-27B/Qwen-3/Mistral-3.2 on
  benchmarks (RESEARCH §5) → keep Claude as a **frontier fallback rail behind LiteLLM**, not the default.
- **Serving engine is an OPEN decision** (vLLM vs SGLang) — RESEARCH did not close it. Pick during P4;
  vLLM is the safer default for EuroLLM-class models.
- **Governance-controlled egress (FUTARCHY §1):** the routing policy is itself DAO-governed. Data
  classes: *citizen-linked / IP-sensitive* → **pinned local, physically cannot egress**; *non-sensitive*
  → may burst to frontier under zero-retention terms. LiteLLM does per-member quotas (Intelligence
  Dividend metering) with only Postgres + stable IDs — no custom code.
- **Cost (verified 2026-07-22):** GEX44 €232/mo (7B) · GEX131 €1,197/mo (30B/70B-FP8) + setup. One box
  multiplexes many orgs via LiteLLM. Managed EU alternative: IONOS AI Model Hub (Berlin).

## 6. The irreducible boundary (and honest mitigations)

Blueprint §8: *"Not everything decentralizes: push (Apple/Google), app-store distribution, fiat rails,
legal wrappers."* This spec adds the mitigations the corpus omitted:

| Irreducible | Why | Mitigation (new here) |
|---|---|---|
| **App Store / Play** distribution | Apple/Google gatekeep native install | **PWA** as a sovereign parallel (loses native modules + store reach); keep native for reach |
| **APNs / FCM** push | OS-level push is vendor-owned | **UnifiedPush** (self-hostable) for Android/degoogled only — niche; accept APNs/FCM for reach |
| **EAS build/OTA** | Expo cloud | self-host `expo-updates` server + own CI (fastlane) — deferred, `L` |
| **Fiat rail** | regulated EMI | Monerium (EU) — *by design, never self-host* |
| **Legal wrapper** | jurisdiction | e.V./eG/gGmbH — the wrapper is permanent (thesis limit) |

**Gnosis chain is not on this list** — it is a shared public commons we adopt, not a dependency we own.

## 7. Ops runbook (the corpus never specified this — mandatory before prod)

- **Backups:** nightly `pg_dump` + continuous WAL/PITR → offsite encrypted Storage Box; **monthly
  restore drill** (a backup you haven't restored is not a backup).
- **HA/DR:** P0–P5 ship single-node (fine for staging + early prod); before scale, add a Postgres
  streaming replica + second app node + documented failover + a runbook'd recovery-time objective.
- **Monitoring:** Uptime Kuma (uptime), self-host Grafana/Prometheus (host + Postgres), GlitchTip (errors),
  PostHog (product). Alerts → the maintainer.
- **Security:** unattended-upgrades, UFW/Hetzner firewall, SSH keys only + fail2ban, secrets in
  Infisical/OpenBao, quarterly key rotation, TLS via Traefik/Let's Encrypt.
- **Who operates:** Netizen Labs (GmbH/gGmbH) runs Netizen Cloud; self-hosters run their own. Per-node
  operator = **GDPR data controller for exactly its community** (locality as a compliance feature).

## 8. GDPR / legal posture

- Hetzner (EU-owned) removes US CLOUD-Act exposure that Supabase/Vercel/CF carry even in EU regions —
  the core sovereignty argument, and a real German-civic-market selling point.
- Data-controller-per-node maps cleanly to the hybrid tenancy model (blueprint §4).
- **Gate (Legal Masterplan):** Fachanwalt + Steuerberater before any real-money phase; EU AI Act
  deployer/provider duties apply once we self-host/fine-tune a model (RESEARCH §9(6)).

## 9. Risks & open questions

- **P6 (thirdweb replacement) is R&D, not migration** — the gasless-passkey-on-Gnosis reference is
  unshipped (RESEARCH §1); PRF device floors (iOS18/Android14) need a fallback onboarding path (§9(3)).
- **Serving engine (vLLM vs SGLang)** undecided (RESEARCH §5).
- **EuroLLM quality gap** vs frontier — mitigated by the fallback rail, but Mecky UX must be A/B'd.
- **Ops burden is the real cost** of sovereignty — you trade managed-Supabase reliability for control;
  backups + monitoring + on-call are non-optional.
- **Email deliverability** self-hosted is hard → prefer an EU sender over self-hosting Postal.
- **Two data-sovereignty models coexist unreconciled** in the corpus (OS-SPEC Nextcloud/Fileverse
  document-Vault vs blueprint packaged-Supabase Node) — decide whether the encrypted Vault lives *inside*
  the Node or as a separate rail before P2.
- **Contradiction to resolve:** OS-SPEC's older "GLM (China) vs Mistral" AI framing is superseded by
  RESEARCH's EuroLLM+LiteLLM — the EU/sovereign framing rules out GLM.

## 10. Cost sketch (per BIZPLAN §6, verified prices)

- **Minimum sovereign prod:** 1× app box (~€50–100/mo) + 1× GEX44 GPU (€232/mo) + Storage Box (~€4/mo)
  ≈ **~€300–350/mo** for a 7B-local AI + full self-hosted backend. GEX131 (30B) pushes it to ~€1.3k/mo.
- Per additional town-node COGS ~€30–100/mo (data is small). Horizontal, not vertical.

## 11. Decisions for Max

1. **Sequence:** do P1 (web→Coolify) + P2 (Supabase→Hetzner) *first* (the CLOUD-Act win, low risk), and
   defer P6 (thirdweb) as separate R&D — **recommended** — or bundle differently?
2. **GPU tier now:** GEX44 (7B, €232/mo — cheaper, weaker) vs GEX131 (30B, €1,197/mo)?
3. **Managed vs raw:** Coolify on Hetzner (self-managed) vs a managed layer — accept the ops burden?
4. **First cutover to rehearse on staging:** web, or Supabase?
5. **Encrypted document Vault:** inside the Node, or a separate Nextcloud rail? (blocks P2 data model)

---

*Next step after approval: superpowers **writing-plans** for **P1+P2** only (web→Coolify, Supabase→Hetzner)
— the low-risk, high-sovereignty-payoff slice — rehearsed on the staging environment that already exists.*
