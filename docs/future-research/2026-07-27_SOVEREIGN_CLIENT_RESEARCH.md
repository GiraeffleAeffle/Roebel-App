# The Netizen sovereign client: browser vs extension vs identity wallet

> **2026-07-27.** Answers the brief in `netizen_labs/RESEARCH_PROMPT_sovereign_client.md`.
> Method: primary-source web research (repos, standards bodies, EU legislative documents,
> maintainer statements, company blogs), plus a direct count against the Brave source tree.
> Every claim carries a source and a date. Claims I could not verify are marked
> *(unverified)*. Section 9 lists what stayed open.
>
> The brief asked for pushback, not validation. Section 2 is the case against the browser,
> section 6 is the case against the recommendation I am making.

---

## 0. Executive recommendation

**Build the identity and attestation wallet. Ship a thin desktop extension as a distribution
probe. Do not fork Chromium, and do not plan to.**

The honest finding is that the three options are not three versions of the same bet. Two of
them are products Netizen is already 70% of the way to owning, and one of them is a
permanent 2 to 4 FTE tax on browser-core engineering that buys a differentiator the market
has already routed around.

Three things landed in the last nine months that change the answer, and all three point away
from the browser:

1. **The ENS-in-the-browser problem got solved without browsers.** The ecosystem moved to
   making onchain names DNS-resolvable (.box via 3DNS, tokenized DNS names via Doma/D3
   resolving as native ENS, Oct 2025) rather than making browsers ENS-aware. Brave, the one
   browser that shipped decentralized resolution, deprecated its local IPFS node in Aug 2024.
   Native `.eth` resolution is structurally blocked at ICANN, not at the browser (section 1.5).
2. **AI did not lower the fork-maintenance floor. It arguably raised it.** The clearest
   evidence is Ladybird closing all external pull requests in June 2026 *specifically because*
   AI made contributions cheap and review expensive, on a browser project. Chromium's own AI
   policy requires that a human understands and attests to every line. Google's Big Sleep is
   accelerating vulnerability *discovery*, which increases the patch cadence a downstream fork
   must chase (section 1.2).
3. **The EU handed Netizen its distribution channel, and it is a credential channel, not a
   browser channel.** eIDAS 2.0 forces 27 member states to ship wallets by 24 Dec 2026, and
   the European Business Wallet proposal (19 Nov 2025, Council position 9 Jun 2026) does the
   same for organisations. Netizen does not need to be a certified wallet to participate: any
   entity can issue **non-qualified electronic attestations of attributes** and any entity can
   register as a **relying party**. That is exactly the shape of a Netizen membership
   (section 3).

The wallet you described, "not directly focused on finance but instead on identity and
attestations for communities and nodes", is the right instinct. It is also the only one of the
three that is defensible, because the defensibility does not come from the client. It comes
from being the issuer of memberships that a real town actually uses.

### The ladder

| Stage | What | Cost | Trigger to advance |
|---|---|---|---|
| **0. Now** | **Netizen ID**: extract the identity layer already inside the Röbel Expo app into a standalone client. Memberships as soulbound NFT (anchor) + SD-JWT VC (portable) + OpenID4VP (presentation). Node-agnostic. | 1 to 2 devs, 8 to 12 weeks | (built) |
| **1. Parallel, cheap** | **Netizen Connect** browser extension: Sign-in-with-node (OIDC), node-name resolution, attestation display, payment intents. Firefox + Chrome. | 1 dev, 4 to 6 weeks | ship alongside stage 0 |
| **2. Conditional** | **Managed Netizen Chromium**: policy-configured stock Chromium, signed extension bundle, sovereign search/AI defaults, no Google endpoints. **Not a fork.** | 0.5 dev + packaging | ≥3 institutions with a written client requirement |
| **3. Probably never** | Chromium fork | 2 to 4 permanent FTE + on-call | see the falsifiable gate in section 5.2 |

Stage 2 is the part most people skip. It delivers most of what institutions actually mean when
they ask for a "sovereign browser" (no Google telemetry, enforced policy, controlled defaults,
managed updates) at roughly 1% of the cost of a fork, because Chromium's enterprise policy
surface is designed for exactly this.

---

## 1. Part A: the browser thesis

### 1.1 The true cost of a Chromium fork in 2026

**Hard numbers, verified:**

| Fact | Value | Source |
|---|---|---|
| Patch files Brave maintains against Chromium | **898** (891 in `patches/`, 5 in `patches/third_party/`, 2 in `patches/v8/`) | direct count, GitHub API `brave/brave-core`, 2026-07-27 |
| Brave headcount | ~343 to 353 (2026); 289 (2025) | [Growjo](https://growjo.com/company/Brave_Software), [Latka](https://getlatka.com/companies/brave.com) *(third-party aggregators, treat as ±20%)* |
| Brave DevOps team, 2021 | 4 people, build/release only | [brave.com/blog/building-brave](https://brave.com/blog/building-brave/), 2021-06-25 |
| Vivaldi developers | **~20**, against ~600 on Chromium | [vivaldi.com/blog/vivaldi-code-integration](https://vivaldi.com/blog/vivaldi-code-integration/), 2018-09-12 |
| Vivaldi Chromium integration, per cycle | **under 2 weeks** (was 3 to 4); ~80 of 900 patched files break per major version | ibid. |
| Vivaldi output vs Google | 2,700 commits/year vs 15,000 Google commits between Chromium 68 and 69 | ibid. |
| Chromium release cadence | 4 to 6 weeks major, continuous security | [Browserbase](https://www.browserbase.com/blog/chromium-fork-for-ai-automation), 2025-11-19 |
| Chrome zero-days exploited in the wild | **8 in 2025**; **4 by April 2026** | [BleepingComputer](https://www.bleepingcomputer.com/news/security/google-fixes-fourth-chrome-zero-day-exploited-in-attacks-in-2026/), [Malwarebytes](https://www.malwarebytes.com/blog/news/2025/12/another-chrome-zero-day-under-attack-update-now) |
| Cold build time | 3 to 4 days on standard hardware; ~1 hour on dedicated infra | [Browserbase](https://www.browserbase.com/blog/chromium-fork-for-ai-automation), 2025-11-19 |

**Read the Vivaldi number carefully, because it is the most useful one.** Vivaldi is the
*cheapest possible* real Chromium fork: it is essentially a UI layer, it does not rewrite the
network stack or the ad-blocking path, and it still costs a senior specialist (Yngve Pettersen)
roughly two weeks per six-week cycle just to stay current. That is a floor of ~0.4 FTE of a
person who is very hard to hire, before a single Netizen-specific feature exists. Brave, which
does patch deep (899 patch points), runs a company of ~350 people.

**The real cost is not the rebase. It is the on-call.** Eight in-the-wild Chrome zero-days in
2025 means eight times a year where an emergency, out-of-band, all-platform rebuild and ship
has to happen within hours to days. Miss it and your users are running a known-exploited
browser. This is the load that kills small forks: Thorium (single maintainer) moved to an LTS
cadence, explicitly accepting longer windows without upstream security fixes; ungoogled-chromium
contributors have publicly flagged that slow CI builds delay security updates ([issue #515,
Nov 2025](https://github.com/ungoogled-software/ungoogled-chromium-windows/issues/515)).

**What killed the ones that died:**

- **Arc / The Browser Company.** Not a maintenance failure. A *strategy* failure. Arc entered
  maintenance mode May 2025, the company was acquired by Atlassian for **$610M** (announced
  2025-09-04, closed 2025-10-21), and resources went to Dia. As of June 2026 Arc still gets
  security patches only. Lesson: a beautifully engineered, extremely well funded browser with
  a devoted user base was still worth more as an acquisition than as a browser.
  ([TechCrunch](https://techcrunch.com/2025/09/04/atlassian-to-buy-arc-developer-the-browser-company-for-610m), [Atlassian](https://www.atlassian.com/blog/announcements/atlassian-acquires-the-browser-company))
- **Opera Crypto Browser.** Delisted, updates discontinued **2024-03-14**, features folded back
  into flagship Opera. Opera's own framing: "crypto and Web3 technologies are no longer a
  separate ecosystem". This is the closest precedent to the idea in the brief, and it was run
  by a company with an existing browser, existing distribution, and a browser-core team. It
  still did not sustain as a separate product.
  ([Opera Desktop blog](https://blogs.opera.com/desktop/2024/02/opera-delists-the-experimental-crypto-browser/))
- **Beaker Browser.** Discontinued Sept 2021, repo archived 2022, Paul Frazee went to Bluesky.
  The stated reason is the single most interesting datapoint in this whole report: Beaker apps
  *had no backend*, and building one "which matched the browser's security and page-based
  runtime model" defeated them. They concluded a browser cannot also be the platform.
  ([archive-notice.md](https://github.com/beakerbrowser/beaker/blob/master/archive-notice.md))

Beaker is the strongest pro-browser argument available to Netizen, and it should be stated
honestly: **Netizen has the thing Beaker lacked.** The node *is* the backend. Identity, storage,
comms, treasury and AI already exist as a provisioned stack. So the specific failure that killed
Beaker does not apply here. That does not make the browser correct, because Beaker's other
constraint (a two-person team maintaining an Electron browser) applies more than ever. It means
the *architecture* objection is answered and the *economics* objection is not.

### 1.2 Does AI change the maintenance calculus?

**No. The evidence points the other way, and it is unusually direct.**

The single most relevant fact of 2026: **Ladybird stopped accepting all external pull requests
in June 2026, and gave AI as the reason.** Andreas Kling's argument was that a large PR used to
be a costly signal that the author understood and would stand behind the code, and AI destroyed
that signal, while review burden stayed with maintainers. He specifically cited that this matters
more for a browser, "since it processes untrusted content from the internet directly on users'
machines". Open PRs were closed, and no patch-by-email or alternative channel was opened.
([Linuxiac](https://linuxiac.com/ladybird-browser-closes-public-pull-requests-ahead-of-first-alpha/),
[AlternativeTo](https://alternativeto.net/news/2026/6/ladybird-browser-ends-public-pull-requests-due-to-ai-and-security-concerns/), June 2026)

That is a browser project, in 2026, concluding that AI-generated contributions make browser
maintenance *harder*, not easier.

**Chromium's own AI policy says the same thing in governance form.** From
[`agents/ai_policy.md`](https://chromium.googlesource.com/chromium/src/+/main/agents/ai_policy.md):
authors "must self-review and understand all code and documentation updates" before review, and
"must attest that the code they submit is their original creation, regardless of whether AI
tooling was used". Chromium keeps a strict 2-committer human review requirement, and the policy
states that "a human reply must get a human reply", so if an agent files a CL, the human operator
must answer review feedback. Accounts submitting CLs the human does not understand risk losing
committer status. Upstream has explicitly refused to let accountability move to the agent.

**Now split the work, as the brief asked.**

- **Mechanical rebasing: plausibly automatable, and it was already the cheap part.** Vivaldi's
  lead maintainer got a merge down to "five to six hours, a process that used to take up to a
  week" *in 2018*, with tooling and no AI. Assume agents get you a further 2 to 5x on conflict
  resolution across ~900 patch hunks. That is real, and it saves maybe 0.2 to 0.3 FTE. It does
  not change the decision.
- **Security triage and 0-day response: not automatable today.** Google's Big Sleep (DeepMind
  + Project Zero) does find real Chromium bugs autonomously, including CVE-2025-9478 (ANGLE
  use-after-free) and CVE-2025-9132 (V8 out-of-bounds write), plus 20 flaws across open-source
  projects announced Aug 2025. But Google is explicit that "we have a human expert in the loop
  before reporting". AI is doing *discovery*, which is the part a downstream fork does not do
  anyway. ([TechCrunch](https://techcrunch.com/2025/08/04/google-says-its-ai-based-bug-hunter-found-20-security-vulnerabilities/), [SecurityAffairs](https://securityaffairs.com/181338/security/google-fixed-chrome-flaw-found-by-big-sleep-ai/))

**The non-obvious conclusion: AI is net negative for a small fork.** AI-accelerated bug hunting
(on both the defensive and offensive side) increases the rate at which critical patches land
upstream. Every one of those is a forced, unplanned rebuild-and-ship for the fork. AI compresses
the cost per rebase by maybe 3x while multiplying the number of forced events. A small fork's
binding constraint was never keyboard time, it was **a human who is accountable at 2am and
understands V8 sandbox semantics well enough to judge whether a patch conflict re-introduced a
UAF.** Nothing in 2026 removes that person.

**Minimum viable human team for a Chromium fork that ships to the public:** 2 senior
browser engineers (one of whom must be genuinely deep in Chromium security architecture),
1 release/build engineer, plus a funded on-call rotation, which realistically means 3 people
minimum and 4 to 5 to avoid single-person dependency. Call it €600k to €900k/year in EU
salaries, permanently, before product work. *(This is my estimate, not a sourced figure.)*

### 1.3 Gecko / WebKit / Servo / Ladybird

| Engine | 2026 state | Verdict for Netizen |
|---|---|---|
| **Chromium fork** | 898-patch surface for a Brave-class fork; 4 to 6 week cadence; 8 in-the-wild 0-days in 2025 | Highest capability, highest tax, the only one with real web compatibility |
| **Gecko** | Not designed for third-party embedding. No supported embedding API. Effectively means forking Firefox, with a smaller ecosystem and fewer people who can help | Worse than Chromium on every axis except independence from Google |
| **WebKit** | Embeddable (WKWebView on Apple, WebKitGTK on Linux). This is what an iOS "browser" is anyway. Zero engine maintenance | The correct choice *if* the target is an app-shell, not a browser |
| **Servo** | **0.1.0 published to crates.io 2026-04-13**, first `cargo add servo`. Linux Foundation Europe project. Explicitly: fine for controlled content, "be cautious" for arbitrary internet HTML, security hardening ongoing | Genuinely exciting, and genuinely not ready to render the untrusted web. Watch it |
| **Ladybird** | Alpha for Linux/macOS targeted 2026; beta 2027; stable 2028 (targets, not promises). Closed external PRs June 2026 | Not a platform you can build a 2027 product on |

([Servo](https://servo.org/), [Phoronix Jan 2026](https://www.phoronix.com/news/Servo-January-2026), [Ladybird](https://ladybird.org/))

The interesting one is Servo. A Rust engine you embed as a library, backed by Linux Foundation
Europe, is a much better long-term fit for a European sovereignty story than a Google-derived
fork. It is a 2028+ option, not a 2026 one.

### 1.4 Distribution

**Brave (the optimistic case, read pessimistically):**

- 101M MAU / 42M DAU as of 2025-09-30, and Brave's own post says "about 2.5 million net new
  users each month" over the preceding two years. ([brave.com/blog/100m-mau](https://brave.com/blog/100m-mau/), 2025-10-01)
- That took roughly a decade (Brave Software founded 2015, browser released 2016), a company of
  ~350 people, and total funding reported between $178M and $364M depending on the aggregator
  *(the spread across PitchBook, Tracxn and Crunchbase is large enough that I do not trust any
  single figure)*.
- **What actually drove growth was the built-in ad blocker and speed, not crypto.** Brave has
  never publicly attributed acquisition to BAT. Brave Rewards is opt-in and off by default
  ([Brave FAQ](https://brave.com/faq/)). The crypto layer is monetization and retention, not
  a growth channel. Anyone reasoning "Brave proves a crypto browser can get users" has the
  causality backwards.
- The sharpest anti-signal in the entire report: **Brave deprecated local IPFS node and protocol
  support on 2024-08-22 (v1.69.153)**, and ENS offchain lookup remains an opt-in setting with a
  privacy warning. A browser with 100M users, a crypto-native founder, and its own token
  concluded that maintaining decentralized resolution was not worth it. If it is not worth it at
  100M users, it is not a wedge at zero users.

**Ecosia (the sobering comparison):**

~20M MAU, ~5 to 6M DAU, 0.10 to 0.15% global search share, 1.71% in Germany, after 16 years,
with a mission (planting trees, 230M+ funded by Aug 2025) that is vastly more universally
legible than "Ethereum-native". Growth averaged 15 to 20%/year 2019 to 2023.
([Ecosia stats compilations](https://electroiq.com/stats/ecosia-statistics/), [Ecosia blog](https://blog.ecosia.org/eusp/))

If a cause as broadly sympathetic as reforestation buys 20M users and 0.1% share over 16 years,
the honest ceiling for "sovereign, Ethereum-native, community-governed" is lower, not higher.

**Is the Ethereum community a real distribution channel? Estimate:**

- a16z State of Crypto 2025 (Oct 2025): **40 to 70 million monthly active crypto users** globally,
  against ~716M owners, so a 6 to 10% owner-to-active conversion.
  ([a16z](https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/))
- Ethereum L1: ~837,200 30-day-average daily active addresses (early March 2026), with a
  February 2026 spike approaching 2M. Addresses are not humans.
  ([growthepie](https://www.growthepie.com/fundamentals/daily-active-addresses), [The Block](https://www.theblock.co/data/on-chain-metrics/ethereum/number-of-active-addresses-on-the-ethereum-network-monthly))

Now apply the funnel honestly. Of 40 to 70M monthly-active crypto users worldwide, the subset
that (a) is Ethereum-centric rather than Solana/Bitcoin/exchange-only, (b) cares about
self-sovereignty as an identity rather than as a trade, (c) is willing to **change default
browser**, which is among the stickiest consumer behaviours that exists, and (d) is in a
geography Netizen can support, is plausibly **200k to 800k people globally, spread across every
country.** *(My estimate.)* Those people are already served by MetaMask and Rabby as extensions
in a browser they like. "Ethereum users would enjoy an Ethereum-native browser" is probably
true as a sentiment and probably worth a few tens of thousands of installs, which is a rounding
error against a permanent 3-FTE cost.

**And the competitive context has changed.** The AI browser slot is being contested by companies
with billions: ChatGPT Atlas at roughly 10 to 15M MAU and Perplexity Comet in the 3 to 18M range
by mid-2026 *(these figures come from analyst roundups, not company disclosures, and the Comet
spread is too wide to trust)*, with AI browsers projected at 15 to 20% of the market by end of
2026. "Perplexity with Brave privacy" is a product two extremely well-capitalised companies are
already building, and Google is folding into Chrome by default. That is not a fight to pick with
a small team.

### 1.5 Native ENS resolution: why browsers do not do it, and why that will not change

This is where the browser thesis loses its last unique feature.

**The blocker is not technical, it is namespace governance.**

1. **`.eth` is reserved.** It is an ISO 3166-1 alpha-3 code (Ethiopia), which ICANN holds as a
   potential future ccTLD. It sits in what the ENS DAO forum itself calls an administrative
   "no-mans-land" requiring an ICANN policy change to be added to the DNS root.
   ([ENS DAO forum](https://discuss.ens.domains/t/icann-application-for-eth-and-ens-tlds/20182))
2. **ENS's own governance forbids squatting the root.** The stated principle is that "ENS
   governance must not create new top-level domains unless those domains have been granted to
   ENS by a DNS authority." ENS respects DNS primacy. So the pressure that would push browsers
   to adopt `.eth` natively is not coming from ENS.
3. **ENS is going the other way.** ENS Labs is considering applying for **`.ens`** as a brand
   gTLD in the ICANN 2026 round, not `.eth`.
   ([ENS blog, 2025-11-12](https://ens.domains/blog/post/icann-84-gtld))
   **The window is open right now: applications 30 April 2026 to 12 August 2026, earliest
   delegation 2028.** ([ICANN](https://newgtldprogram.icann.org/en/application-rounds/round2),
   [The Register, 2026-05-01](https://www.theregister.com/2026/05/01/icann_new_gtld_applications/))
4. **There is an unresolved correctness problem.** ENS names and DNS names do not map
   one-to-one. raffy documented (2022-05-07) that distinct ENS names normalize to the same
   Punycode under browser UTS-46/IDNA handling (the emoji-with-ZWJ case collapsing to
   `xn--ns8haa78mbab`), and that browsers differ in their normalization. Native resolution would
   require browsers to adopt ENSIP-15 normalization instead of IDNA, which is a security
   argument no browser vendor wants to have.
   ([ENS DAO forum](https://discuss.ens.domains/t/dns-collisions-of-ens-names-in-browser-input/12539))

**What actually shipped instead, and this is the decisive part:**

- **Gateways**: append `.limo` or `.link` to any `.eth` name and it resolves in any browser.
- **DNS-native onchain names**: `.box`, powered by 3DNS, is a real ICANN TLD that is
  simultaneously an ENS name, resolving in every browser with no software.
  ([ENS blog](https://ens.domains/blog/post/ens-integrates-dot-box))
- **Tokenized DNS**: the Doma/D3 integration (2025-10-21) lets DNS domains tokenized on Doma
  resolve as native ENS names, without DNSSEC or TXT record configuration.
  ([ENS blog](https://ens.domains/blog/post/d3-doma))
- **ENSv2 dropped its own L2.** Namechain was cancelled Feb 2026 and ENSv2 deploys on Ethereum
  mainnet, because L1 registration costs fell ~99% with the gas limit increases.
  ([CoinDesk, 2026-02-06](https://www.coindesk.com/tech/2026/02/06/ethereum-s-ens-identity-system-scraps-planned-rollup-amid-vitalik-s-warning-about-layer-2-networks))

**Implication for Netizen, concretely:** `roebel.eth` will never be typed into Chrome. But
`roebel.app` already resolves everywhere and can be anchored onchain. The right architecture is
to **use DNS for navigation and ENS for identity records**, not to build a browser that fixes
navigation. Whatever value there was in "native ENS resolution" as a browser differentiator has
been arbitraged away by the naming ecosystem itself.

---

## 2. Part B: the extension path

### 2.1 What Manifest V3 actually forbids, and one thing that just changed

**Hard limits (verified):**

- **No blocking `webRequest`.** The `webRequestBlocking` permission is unavailable to most
  extensions. Observation survives, in-flight modification does not.
  ([Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests))
- **`declarativeNetRequest` caps.** 30,000 dynamic rules since Chrome 121 (was 5,000 combined
  dynamic + session before Chrome 120); max 1,000 regex rules of each type. Rules must be
  declared ahead of time, not decided per request.
  ([Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest))
- **Service workers terminate when idle.** This is the one that bites a wallet. MetaMask had to
  cache the vault encryption key as an exported JWK so the service worker can re-decrypt after
  restart without re-prompting for the password. That is a security compromise MV3 *forced*, and
  it is the model any keyholding extension inherits.

**The thing that changed, and it is genuinely new (March 2026):** extensions can now register
**custom protocol handlers** declaratively via a `protocol_handlers` manifest key. Firefox has
supported this since 2017; **Chrome ships it in 146+ behind
`--enable-features=ExtensionProtocolHandlers`**; Safari initially supported it then moved to
opposed. The W3C WebExtensions Community Group is moving toward WG status and there are proposals
to add `protocol_handlers` to the Draft Community Group Report.
([Igalia, 2026-03-24](https://blogs.igalia.com/jfernandez/2026/03/24/protocol-handler-registration-via-browser-extensions/))

The safelist matters enormously for Netizen:

> bitcoin, cabal, dat, **did**, doi, dweb, **ethereum**, geo, hyper, im, **ipfs**, **ipns**, irc,
> ircs, magnet, mailto, **matrix**, mms, news, nntp, openpgp4fpr, sip, sms, smsto, ssb, ssh, tel,
> urn, webcal, wtai, xmpp

`did:`, `ethereum:`, `ipfs:`, `ipns:` and `matrix:` are all on it. **`ens:` and `web3:` are not.**
Handler targets must be http(s), and activation requires a runtime user approval dialog.

Two actionable consequences:

- Netizen can ship a real `did:` handler today on Firefox and soon on Chrome, which is precisely
  the primitive an identity client wants. Nobody in the Ethereum ecosystem appears to be using
  this yet.
- Getting `ens` onto that safelist is a cheap, high-leverage standards move (one WebExtensions CG
  proposal). It is also the single genuine browser-only capability identified in this report, and
  landing it in the standard **removes** the last technical reason to fork.

### 2.2 What an extension can and cannot deliver as the "sovereign resolution layer"

| Capability | Extension? | Note |
|---|---|---|
| Resolve node names / ENS on navigation | **Yes** | `webNavigation.onBeforeNavigate` + redirect, or omnibox keyword, or `protocol_handlers` |
| Sign-in-with-node (OIDC to Röbel ID) | **Yes** | plain OAuth flow, no special API needed |
| Display node attestations / memberships | **Yes** | content script + side panel |
| Inject an EIP-1193 provider | **Yes** | this is what every wallet does |
| Payment intents (Münzen / EURe) | **Yes** | |
| Key custody outside the browser sandbox | **No** | requires a companion desktop app (the Frame model) or the mobile client |
| Survive service-worker termination with a hot key | **Partly** | only via the MetaMask JWK-caching compromise |
| Be the default search / new tab without user action | **No** | user must accept an override prompt |
| Enforce enterprise policy | **No** | but stock Chromium enterprise policy can, without a fork |
| Remove Google endpoints (update ping, Safe Browsing, component updater) | **No** | needs a build, which stage 2 (managed Chromium) gives you without forking |
| Native `ens://` protocol | **No** | not on the safelist. The only true browser-exclusive found |

### 2.3 Precedents, and they are not encouraging for either path

- **ENS-resolving extensions**: Almonit (Firefox, ENS+IPFS, effectively dormant, last meaningful
  activity around 2021), `cpacia/ens-chrome-extension` (light client), `ComfyGummy/chrome-web3`
  (ERC-4804 `web3://` via omnibox keyword). All hobby-scale, all negligible install bases. The
  category has been attempted repeatedly and has never found users.
- **Only Brave ships web3 domain resolution by default**, and it did so via a third-party offchain
  lookup gated behind an opt-in privacy warning, and it deprecated the local IPFS half in 2024.
- **Wallets that tried to be more than wallets**: Opera Crypto Browser folded back (2024-03-14);
  Trust Wallet removed its iOS dApp browser (June 2021) for App Store policy reasons; Brave had to
  remove the Web3 tab from its own wallet explorer. The pattern is that the "browser" layer gets
  cut and the wallet survives.
- **Frame** (desktop wallet with a companion extension) is still alive in 2026 and is the closest
  architecture to what Netizen actually wants on desktop: keys in a native app, the extension is a
  thin bridge. *(Frame's activity level in 2026 is unverified beyond its docs and store listing.)*

The lesson from every precedent is the same. **The client that survives is the one that holds the
credential. The browser around it is disposable.**

---

## 3. Part C: the identity and attestation wallet

### 3.1 Who is alive in 2026, and what the dead ones got wrong

| Project | Status | What happened |
|---|---|---|
| **EUDI Wallet** (eIDAS 2.0) | **Alive, legally mandated.** 27 member states must offer a wallet by **24 Dec 2026** under Reg. (EU) 2024/1183. Open-source reference implementation (Android/iOS/wallet-provider) on GitHub, already forked in production (FortID/TBTL) | Fewer than a third of member states assessed as meeting the readiness benchmark; Germany building for 80M users at LoA High, first public stage of the state wallet expected early 2027; Netherlands and Malta signalling partial launches |
| **European Business Wallet** | **Alive, in trilogue.** Commission proposal **2025-11-19**; Council negotiating position **2026-06-09**; aim to conclude before end of 2026 | Public bodies must accept within 24 months of entry into force (36 for some functions); voluntary for companies initially; Commission must assess mandatory use within 3 years. Broad operational impact expected 2028/29 |
| **Ethereum Attestation Service** | **Alive.** 9.5M+ attestations, 450k+ attesters as of 2026-05-14; shipped an agent-first CLI across 12+ chains *(figures from EAS's own site)* | The de facto onchain attestation primitive |
| **Semaphore v4** | **Alive.** Trusted setup ceremony completed 2024-07-13 with 400+ participants; contracts + JS libraries maintained by PSE | The membership-anonymity primitive |
| **Human Passport** (ex-Gitcoin Passport) | **Alive, acquired.** Holonym Foundation acquired it Feb 2025 for **$10M**; rebranded under human.tech; 34.5M credentials for 2.1M users; 8 of the Passport team retained | Proof-of-personhood consolidated into a bigger org |
| **walt.id** | **Alive**, shipping EUDI-aligned issuer/verifier/wallet infra and OpenID4VCI/VP tooling, docs actively updated through 2026 | The most usable open-source on-ramp to EUDI formats |
| **Disco.xyz** | **Dead as an independent product.** Acquired by Privado ID **2024-09-17** | Built VC infrastructure looking for a user base |
| **Sismo** | **Dead.** Legacy ZK badges sunset 1 Sept (2023), app.sismo.io discontinued, pivot to Sismo Connect did not sustain | Same failure mode |
| **Verida** | *(unverified)* No credible 2026 status found | |

**The pattern in the dead column is one thing, and it is the whole argument for Netizen.** Disco
and Sismo built excellent credential infrastructure and then went looking for communities that
needed credentials. Netizen has the inverse: **a real town with real memberships (20 citizens,
5 attesters, org roles) that already gate real things (voting, currency, workspace).** The
credential is not speculative. It is already load-bearing. That is exactly the asset the dead
projects lacked and could not manufacture.

### 3.2 EUDI interop: what it would take, and the structural loophole in Netizen's favour

**Binding standards.** The ARF selected two credential formats for launch: **ISO/IEC 18013-5
mdoc** and **IETF SD-JWT VC** (with W3C VCDM also supported). Presentation is **OpenID4VP** for
remote flows and **ISO/IEC 18013-5** for proximity/NFC; issuance is **OpenID4VCI**.
([ARF](https://eudi.dev/2.2.0/architecture-and-reference-framework-main/), [OpenID4VP 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html))

**The loophole, and it is decisive.** Certification is required only for wallets that hold
**PID, PuB-EAA or QEAA**. There is an explicit, separate space for **non-certified wallets**
serving everyday consumer and business credentials such as loyalty programmes and employee
credentials. And **non-qualified EAAs can be issued by any (non-qualified) trust service
provider**, i.e. by anyone. ([walt.id eIDAS2 wallet-provider guide](https://walt.id/eidas2/wallet-provider))

Therefore, Netizen does **not** need to become a certified EUDI wallet provider, which would be a
multi-year, six-figure conformity exercise. It needs to do two much smaller things:

1. **Issue Netizen memberships as non-qualified EAAs in SD-JWT VC**, over OpenID4VCI. A Röbel
   citizenship, an attester role, an `org:<id>:<role>` membership then becomes a credential that
   can be held in *any* conformant wallet, including future EUDI wallets, alongside the state PID.
   Selective disclosure is native to SD-JWT, so "I am a member of Röbel" can be presented without
   revealing name or address.
2. **Register the node as a Relying Party** so it can *consume* an EUDI PID. Member states must
   provide registration processes and issue access certificates to registered relying parties;
   TS6 defines the common set of information a relying party must register (identity, intended
   use, data requested).
   ([ARF relying-party registration](https://eudi.dev/latest/discussion-topics/x-relying-party-registration/),
   [TS6](https://github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications/blob/main/docs/technical-specifications/ts6-common-set-of-rp-information-to-be-registered.md))

**Why this matters more than anything else in this report:** Röbel's attestation flow currently
requires human attesters to vouch that someone lives in Röbel. From 2027, that same claim can be
proven from a state-issued PID address attribute, with selective disclosure, in seconds. The
sybil-hardening work, the percentage-band thresholds, the whole social-graph machinery becomes a
*fallback* rather than the primary path, and Netizen becomes the first community platform that
speaks EU-legal identity natively. **That capability needs zero browser and zero fork.** It needs
an issuer service and a wallet client, both of which are 80% built.

**The European Business Wallet is the same story for the org lane.** Röbel's `org:<id>:<role>`
groups, the Gemeinschaftskasse Safe signatories, the org work suite: those are exactly the
"identity of the company plus the scope of authority of a specific natural person acting on its
behalf" that the EBW proposal defines. Public bodies will be *obliged* to accept business wallets.
A German town platform that already models org roles as portable credentials is positioned for
that, and 2028/29 is precisely the horizon at which a Netizen Cloud business would be selling to
municipalities.

### 3.3 How soulbound NFTs, VCs and ZK compose

Three layers, three distinct jobs. They are not competitors.

| Layer | Object | Job | Netizen today |
|---|---|---|---|
| **Anchor** | CitizenNFTv2 / AttesterNFTv2 (soulbound, Gnosis) | Public, revocable, censorship-resistant source of truth. Gates onchain actions (MACI signup, Circles group, treasury) | Live |
| **Portable presentation** | SD-JWT VC issued over OpenID4VCI, signed by the node | Off-chain, selectively disclosable, EU-standard, works with institutions and with wallets that have never heard of Ethereum | To build |
| **Anonymity** | Semaphore v4 group over the NFT holder set | "I am a member of node X" without revealing which member. Anonymous signalling, anonymous voting | Adjacent to the MACI work |

**The adversarial point you should not skip.** An onchain soulbound membership NFT is a *public
membership roster*. ZK does not fix that. Semaphore only hides *which* member is signalling, and
only to the extent the anonymity set is large. **Röbel has 20 citizens.** A Semaphore proof over a
20-person set, combined with any timing or side-channel correlation, is close to no anonymity at
all. This is a genuine limitation of the current design and it does not improve until the node has
hundreds of members, or until proofs are aggregated across *multiple* nodes into a shared
anonymity set. That cross-node anonymity set is, incidentally, a real reason for Netizen to want
many nodes, and a real product argument for the protocol layer over any client.

The SD-JWT layer partly sidesteps this: an off-chain credential presented selectively to one
verifier leaks nothing to the chain at all. For privacy-sensitive claims, the VC path is
*better* than the onchain path, which is a good reason to build it.

---

## 4. What a sovereign browser could offer that an extension provably cannot

Asked concretely, and answered honestly.

| Claimed browser-only capability | Real? | Assessment |
|---|---|---|
| Key custody in the browser's own keystore | **Partly** | Real relative to an extension (MV3 forces the JWK-caching compromise). But a companion desktop app or the mobile client solves it at 1% of the cost |
| Process isolation per node/origin | **Yes** | Real, and near-worthless at Netizen's threat model. Site isolation already exists in stock Chromium |
| Default search and AI routed to sovereign infra | **Yes, without user action** | The most legitimate item on the list. Achievable on stock Chromium via enterprise policy for managed institutional fleets, which is stage 2, not a fork |
| No Google dependency (update ping, Safe Browsing, component updater, DNS) | **Yes** | Real. ungoogled-chromium already does exactly this and is maintainable as a *build configuration*, not a product fork |
| Policy enforcement for institutions | **Yes** | Fully available via stock Chrome/Chromium enterprise policy. No fork needed |
| Native `ens://` protocol handling | **Yes** | The only capability an extension truly cannot have today. Its practical value is near zero because nobody types `ens://`, and the fix is a standards proposal, not a fork |

**The honest answer is "not much, for now."** Every item that has real institutional value is
obtainable through a *managed distribution* of stock Chromium rather than a patched fork. The one
item that genuinely requires engine access is the one nobody wants.

---

## 5. Strategy synthesis

### 5.1 Ranking

Scored 1 (bad) to 5 (good) for a small team with one live node and real users.

| | Time to value | Defensibility | Distribution leverage | Maintenance burden | Mission fit | **Total** |
|---|---|---|---|---|---|---|
| **Identity/attestation wallet** | **5** (8 to 12 wks, mostly extraction) | **4** (defensibility is in being the issuer, not the client) | **5** (EUDI + EBW are a legislated channel; institutional buyers) | **5** | **5** | **24** |
| **Extension** | **5** (4 to 6 wks) | **2** (trivially cloneable) | **3** (cheap probe, real desktop reach, tiny category precedent) | **4** (MV3 churn) | **4** | **18** |
| **Managed Chromium distribution** | **3** | **2** | **3** (only matters once institutions ask) | **3** | **4** | **15** |
| **Chromium fork** | **1** (12+ months to a shippable browser) | **2** (Brave has 100M users and a 10-year head start; AI browsers are funded in the billions) | **2** | **1** (permanent 3+ FTE, on-call, 8 emergency ships/yr) | **3** | **9** |

The wallet wins on every axis, and it wins hardest on the two that matter most for a small team:
time to value and maintenance burden.

**Note what the defensibility column is really saying.** No client is defensible. MetaMask is not
defensible, Brave is not defensible. What is defensible is **being the issuer of credentials that
a real community depends on**, and the registry of nodes that issue them. The client is
distribution for that, nothing more. Which is one more argument for spending the least possible
on the client.

### 5.2 The escalation ladder and the falsifiable trigger

Escalate extension to **managed Chromium distribution** (stage 2) when **any one** of:

- ≥3 institutions (municipality, Kreis, Land agency, or a company of >50 people) put a managed or
  hardened client in writing as a procurement requirement or contract condition; **or**
- a paying Netizen Cloud customer requires a locked-down default search/AI configuration that
  cannot be delivered by extension.

Escalate to a **Chromium fork** only when **all four** hold simultaneously:

1. **≥25,000 weekly active users** of the Netizen extension, sustained for ≥3 months, across
   ≥3 nodes that Netizen does not operate. (If the extension cannot reach 25k, the browser will
   not reach 250k, and below that a fork is unfinanceable.)
2. **≥3 signed institutional contracts** whose deliverable explicitly requires a client that the
   managed-Chromium distribution provably cannot satisfy. Name the capability in the contract.
3. **A named capability gap that is engine-level and revenue-blocking**, documented, with a
   demonstrated failed attempt to solve it via extension APIs or a companion native app. As of
   today the only candidate is `ens://` protocol handling, and the correct response to that is a
   WebExtensions CG proposal, not a fork.
4. **≥€2M/year committed for ≥3 years** ring-fenced for browser-core headcount (2 senior Chromium
   engineers, 1 release engineer, funded on-call), independent of product engineering.

If gate 1 fails, everything else is moot. **Gate 1 is the experiment the extension exists to run.**
That is its real purpose: it is a cheap, falsifiable test of whether "sovereign client" is a
product or a preference. Build it to answer that question, and instrument it accordingly (weekly
actives, per-node actives, retention at 30 days, which feature is actually used).

### 5.3 What to do about the AI and search parts of the idea

The "Perplexity with Brave privacy and Ecosia network effects" instinct is right about the
*bundle* and wrong about the *container*.

- **Sovereign search already exists as infrastructure you can buy into.** Ecosia and Qwant's joint
  venture **European Search Perspective (EUSP)** operates **Staan**, a European search index, and
  **the index is explicitly open to other companies building search or generative AI tools via an
  open API**. Ecosia began serving its own results in France in 2025 with a target of 30% of French
  queries. ([Ecosia blog](https://blog.ecosia.org/eusp/), [EUSP](https://www.eu-searchperspective.com/))
  A Netizen node routing search through a European index, with the node's AI gateway on top, is a
  genuinely sovereign search+AI stack. It requires an API integration, not a browser.
- **The AI belongs in the node, not the client.** The Netizen AI gateway is already in the
  blueprint. Surfacing it through the existing app and through Mecky is where the differentiated
  value is. An "AI browser" from a small team in 2026 competes with OpenAI, Perplexity and Google
  on their strongest axis.
- **The gamification/network-effect part is the one thing a browser genuinely helps with, and
  Netizen has a better vehicle for it**: Röbel Münzen and the points system already exist, inside
  an app people already have. A browser would be a worse place to put them, not a better one.

---

## 6. The strongest case against this recommendation

Stated properly, because the brief demanded it.

1. **"Identity wallet" is a category littered with corpses.** Disco, Sismo, and a dozen others
   built exactly this and died. The counter-argument (Netizen has a real community that already
   depends on the credential) is *true today at a scale of 20 citizens*. It is not proven at 200
   or 2,000, and the moment Netizen sells to a second town, it inherits the same
   infrastructure-looking-for-users problem the dead projects had. **The wallet is only defensible
   as long as node count grows. If Netizen cannot land node #2 and #3, the wallet is a
   single-customer app.**
2. **The EUDI bet has real timing risk.** Fewer than a third of member states meet the readiness
   benchmark for a 24 Dec 2026 deadline; Germany's public wallet is expected early 2027; the EBW
   will not bite operationally until 2028/29. Building for standards that slip is how startups die
   of correctness. Mitigation: SD-JWT VC and OpenID4VP are useful *now* regardless of EUDI
   timelines, so build the formats, not the compliance.
3. **The browser might be the only thing that ever gets a consumer to care.** Extensions and
   wallets are invisible. A browser is a thing you can put on a poster. There is a real
   possibility that the sovereignty story only becomes legible to normal people when it has a
   window and an icon, and that Netizen is under-weighting narrative capital. My answer is that
   stage 2 (a Netizen-branded managed Chromium) captures nearly all the narrative for nearly none
   of the cost, and should be reached for the moment the story needs a face.
4. **Beaker's failure genuinely does not apply here, and I may be under-weighting that.** Beaker
   died because a browser cannot be a backend. Netizen *is* a backend. That is a materially
   different starting position and the strongest structural argument for the browser that exists.
   It still does not pay for on-call.
5. **Röbel already has an app, which means the marginal cost of the "wallet" is small, which
   means my recommendation is partly just "keep doing what you are doing."** That is a fair
   criticism. The substantive new work is the credential-format layer (SD-JWT VC, OpenID4VCI,
   OpenID4VP, relying-party registration) and node-independence of the client. If that work is not
   done, "build the identity wallet" collapses into a no-op.

---

## 7. Risk list

| Risk | Severity | Mitigation |
|---|---|---|
| Node count stays at 1, wallet becomes a single-customer app | **High** | Node #2 is the top company priority, above any client work |
| EUDI/EBW timelines slip past 2028 | Medium | Build SD-JWT VC + OpenID4VP because they are useful standalone, not because of the deadline |
| Extension fails gate 1 (25k WAU) and the sovereign-client thesis is falsified | Medium | That is the point of the experiment. Budget it as a test, not a product |
| MV3 churn breaks the extension (service-worker semantics, DNR limits) | Medium | Keep the extension thin. Keys live in the mobile client or a companion app, never only in the extension |
| Anonymity set too small for Semaphore to mean anything at 20 citizens | **High for the privacy claim** | Do not market anonymity until sets are large. Prefer off-chain selective disclosure for sensitive claims. Design toward a cross-node anonymity set |
| Onchain soulbound roster is a public membership list, which is a GDPR-adjacent exposure for a German municipality | **High** | Legal review. Consider commitment-only onchain anchors with the credential body off-chain |
| Chromium fork attempted anyway, under-resourced, ships a browser with an unpatched in-the-wild 0-day | **Critical if it happens** | The four-gate rule in 5.2. Treat gate 4 (funded on-call) as non-negotiable |
| ICANN `.ens` round outcome changes the naming picture | Low | Watch the 30 Apr to 12 Aug 2026 window and the 2028 delegation horizon. It does not change the recommendation either way |
| A major wallet (MetaMask, Rabby) ships node-style membership credentials first | Medium | Their incentive is finance, not community memberships. Netizen's moat is issuance, so ship the issuer even if the client is theirs |

---

## 8. Immediate next actions

1. **Decide the credential format now**: SD-JWT VC over OpenID4VCI for issuance, OpenID4VP for
   presentation, with CitizenNFTv2/AttesterNFTv2 as the onchain anchor. This decision unblocks
   everything else and is independent of which client wins.
2. **Add an NSP for credentials to the protocol package.** Node Manifest already declares services.
   It should declare the credential types a node issues. That is the piece that makes memberships
   portable across nodes, and it is protocol work, not client work.
3. **Prototype the relying-party path**: what would it take for a Röbel attestation to consume a
   German PID attribute in 2027. One engineer, two weeks, against walt.id's stack.
4. **Ship the extension as an instrumented experiment**, with gate 1 metrics defined before the
   first line of code.
5. **File a WebExtensions CG proposal to add `ens` to the protocol-handler safelist.** Costs
   almost nothing, benefits the whole ecosystem, and if it lands it permanently removes the last
   technical argument for forking a browser.
6. **Do not fork Chromium.** Revisit only against the four gates in 5.2.

---

## 9. What I could not verify

- **Brave's total funding.** Reported figures range from $42M to $364.1M across PitchBook, Tracxn
  and Crunchbase. No primary disclosure found. Used only as an order of magnitude.
- **Brave's browser-core headcount** as distinct from total headcount. The only primary figure is
  the 4-person DevOps team from the 2021 build-and-release post.
- **Brave MAU in 2026.** Brave's own post says 101M MAU on 2025-09-30; a Sacra profile reports 58M
  (Q1 2025) to 65M (Q1 2026). These are irreconcilable and probably measure different things. I
  used Brave's own figure and flagged it.
- **AI browser MAU figures** (Atlas 10 to 15M, Comet 3 to 18M). Analyst roundups only, no company
  disclosures, and the Comet range is too wide to be useful.
- **Verida's 2026 status.** No credible source found.
- **Frame's 2026 development activity.** Store listing and docs exist; commit activity not checked.
- **EAS's 9.5M attestations / 450k attesters** comes from EAS's own site, not an independent index.
- **My estimate of the switchable Ethereum-native browser market (200k to 800k people)** is a
  derived judgement, not a sourced figure. Treat it as a hypothesis to attack.
- **The minimum-team and salary estimates for a Chromium fork** are my construction from the
  Vivaldi and Brave data points, not published numbers.
- **The European Business Wallet application timeline (2028/29)** comes from law-firm and vendor
  commentary rather than the regulation text, since the file is still in trilogue.

---

## 10. Addendum: the agent argument (added same day, after review)

The original brief framed the browser as a *consumer distribution* bet: Ethereum users would
enjoy an Ethereum-native browser. Section 1.4 dismantles that. But there is a stronger framing
that the brief did not ask about, and it deserves a separate answer:

> Netizen is a full sovereign stack (workspace, identity, AI, governance, money). Agents have to
> operate across all of it, which means they need the web. The human has to verify and sign with
> their onchain identity. Doesn't that require a client that unifies browsing, identity and
> signing?

**It requires browser capability. It does not require a browser product. And on inspection the
agent argument is the strongest argument yet *against* merging the agent and the signing key into
one client.**

### 10.1 The security finding that decides it

Agentic browsers have a vulnerability class that is, by the vendors' own admission, not fully
fixable:

- **Brave security team, 2025-08-20**: demonstrated indirect prompt injection against Perplexity
  Comet. Instructions hidden in a Reddit spoiler tag caused the agent to read the user's email
  address, pull an OTP from Gmail, and exfiltrate both by posting them back to Reddit. The attack
  **bypassed same-origin policy and CORS**, because the agent operates with full user privileges
  across authenticated sessions. Brave's conclusion: "traditional Web security assumptions don't
  hold for agentic AI." ([brave.com/blog/comet-prompt-injection](https://brave.com/blog/comet-prompt-injection/))
- Brave followed with [unseeable prompt injections in screenshots](https://brave.com/blog/unseeable-prompt-injections/), affecting Comet and others.
- **Zenity Labs, March 2026**: the "PleaseFix" family, zero-click agent hijacking in Comet.
- Reporting through 2026 states that prompt injection cannot be fully patched in Atlas, Comet or
  Dia, and that OpenAI says it is unlikely to ever be fully solved.

**Brave's own recommended mitigation #4 is: "isolate agentic browsing from regular browsing."**
And #3: "require explicit user interaction for security-sensitive operations."

A Netizen browser that renders the open web, runs an agent, and holds the citizen's signing key is
that vulnerability class shipped as a product, aimed at a municipality, with a treasury behind it.
The correct architecture is the exact opposite of unification:

| Function | Where it belongs | Why |
|---|---|---|
| Agent executes on the web | **Headless browser on the node**, sandboxed, no keys, no authenticated user sessions | Attacker-controlled content never shares a process with credentials |
| Human verifies and signs | **Signing client**, small, auditable, renders only node-authored content | Its security property comes from *not* being a browser |
| Agent proves a human authorized it | **Signed mandate** (protocol layer), not a UI trick | Survives the agent being compromised |

The trust boundary between "the thing that reads hostile input" and "the thing that holds the key"
is the whole security model. A browser is by definition the place where that boundary collapses.

### 10.2 The four protocols that already decompose the problem

Everything the agent framing asks for shipped as standards in the last 18 months. Building a
browser to unify them would mean re-implementing them behind glass.

| Need | What exists | Status |
|---|---|---|
| **The agent's hands on the web** | [Steel Browser](https://github.com/steel-dev/steel-browser) (open source, Docker, Chromium + CDP, session/cookie/proxy management, self-hostable) and Browserless (self-host Docker image, in market since ~2017) | Production, self-hostable today |
| **Agents acting on Netizen surfaces** | **WebMCP**: `navigator.modelContext`, a site declares its own capabilities as callable tools instead of the agent screenshotting and guessing. W3C Web Machine Learning CG, authored by Microsoft and Google engineers, announced **2026-02-10**. Chrome 146 Canary behind a flag; **origin trial Chrome 149 to 156**; Gemini in Chrome will support it | Early preview, production readiness expected mid-to-late 2026 |
| **Agent identity and reputation** | **ERC-8004 Trustless Agents**: Identity, Reputation and Validation registries. Draft EIP, v1 Oct 2025, **core registries deployed to Ethereum mainnet 2026-01-29**; in the Ethereum Foundation dAI team's 2026 roadmap | Live reference deployments, adoption early |
| **Proving a human authorized a specific agent action** | **AP2 (Agent Payments Protocol)**: cryptographically signed *mandates* defining what an agent may do, under what conditions and limits (price ceilings, time windows, action scope), provable to a counterparty. **Google donated AP2 to the FIDO Alliance in April 2026.** Alongside x402 for machine-to-machine settlement | Standardizing |

AP2 mandates are precisely "the human verifies with their onchain identity and signs", expressed
as a protocol rather than a UI. Netizen already has the onchain analogue: **Zodiac Roles Modifier
v2 onchain per-role spending allowances** (see the [2026-07-22 stack research](2026-07-22_NETIZEN_SOVEREIGN_STACK_RESEARCH.md) §2). A Netizen
agent mandate should be a Roles Modifier role plus a signed AP2-shaped attestation, not a consent
dialog in a browser Netizen maintains.

### 10.3 The inversion that is actually the opportunity

The instinct is "build a browser so our agents can use the world." The higher-leverage move is
the inverse:

> **Publish WebMCP on every Netizen surface so that the world's agents can use a Netizen node.**

Röbel already exposes MCP endpoints (`/api/roebel/mcp`, `/api/mcp`). WebMCP is the browser-side
twin of that, and Chrome is running a production origin trial for it right now. If a citizen's
ChatGPT Atlas, Gemini in Chrome, or Claude can call "check my Münzen balance", "sign this
proposal", "book the Bürgerhaus" as declared tools against a Netizen node, Netizen gets agent
reach across every browser without maintaining any of them. A Netizen browser would deliver the
same capability to an audience of zero.

This also flips the ERC-8004 story: Netizen's attestation stack (soulbound memberships,
attester graph, EAS) is exactly the reputation and validation layer ERC-8004 declares but leaves
open. Being the credential issuer for agents in a town is a better position than being the
browser those agents run in.

### 10.4 What this changes in the recommendation

The stage ladder in section 0 gains a stage, and it is the one to start on:

- **Stage 0b (new, high priority): browser as node infrastructure.** Steel Browser or Browserless
  in the Node Manifest, provisioned by `netizen render` / `netizen up`, so every node ships an
  agent execution sandbox it owns. This is real browser engineering, it is sovereign (self-hosted,
  no vendor), and it costs days, not FTE-years. Per the standing rule that everything on a node
  must land in the manifest, this belongs in an NSP, not in a hand-wired box config.
- **Stage 0c (new): publish WebMCP.** Track the Chrome 149 to 156 origin trial. Cheap, and it is
  the distribution channel the browser was supposed to provide.
- **Stage 1 gains a purpose.** The signing client is not just a wallet, it is the **consent and
  provenance surface**: "agent X (ERC-8004 identity) proposes action Y against node Z under
  mandate M, sign?" Nobody ships this well today, it is genuinely unbuilt, and it is small enough
  for a small team to own. It is also the one component whose value depends on it *not* being a
  browser.
- **Stage 2 gains a second justification.** For institutions, a managed Chromium distribution is
  now also how you *disable* Gemini in Chrome and route all agent traffic to the node's own model
  and the node's own search. Enterprise policy does this on stock Chromium. A fork still buys
  nothing extra.
- **Stage 3 is unchanged.** The agent argument does not move the fork gates. If anything it
  raises the bar, because shipping a consumer agentic browser means owning an unpatchable
  vulnerability class on behalf of a municipality.

### 10.5 The honest residue

Two things in the agent framing are true and are not fully answered by the above:

1. **The trusted terminal is genuinely unbuilt.** No existing client shows an agent's proposed
   action with verifiable provenance and a one-tap onchain signature. That is a real product gap
   and Netizen is unusually well placed to fill it. The report's recommendation is that this is
   the *wallet*, given a bigger job, and that its security case rests on it staying small.
2. **Brand and narrative.** "A fast, private, AI-native, good-for-the-world browser" is a story a
   normal person can repeat, and "an SD-JWT credential issuer with a WebMCP surface" is not. That
   is a genuine cost of this recommendation. The mitigation is that the good-for-the-world story
   already has a better vehicle (the node, the currency, the town) and that stage 2 gives it a
   branded window whenever it needs one. Sovereign search does not require building a search
   engine either: EUSP's Staan index is open to third parties via API.

---

## 11. Addendum 2: is anyone building the Ethereum-native, agent-optimized browser?

**Short answer: no one has shipped it, the gap is real, and it is being closed from three
directions at once by parties Netizen should build on rather than race.**

### 11.1 The scan

| Who | What they shipped | Date | Read |
|---|---|---|---|
| **Steel** | **Stealth Browser**, described in their own words as "Steel's custom Chromium fork for agent workloads: stable browser-level signals from startup and a lighter runtime." Shipped in Launch Week v3 with dedicated IPs, Rust/Go SDKs, Atlas | ~June 2026 | **Someone is already paying for the Chromium fork Netizen would need, and it is open source and self-hostable.** Note *what* they forked for: headless agent workloads, not consumer browsing. This is a commercial validation of stage 0b, not of a browser product |
| **Ethereum Foundation, Kohaku** | Privacy SDK integrating Railgun, Privacy Pools and Tornado at the **wallet layer**; reference browser-extension wallet (a fork of Ambire, Sepolia only); EIP-4337 mempool relaying. Vitalik endorsed it 2026-05-26 | SDK **2026-05-25** | See 11.2. The EF has claimed this lane |
| **MetaMask Agent Wallet** | Fully user-controlled wallet built for AI agents. Framework-agnostic (Claude Code, Codex, Cursor, Hermes, OpenClaw). Every tx gets simulation + Blockaid threat scanning + MEV protection, with up to $10k/month protection coverage. 200-spot early access, GA "this summer" | **2026-06-08** | **The incumbent built a wallet and a CLI for agents, not a browser.** The strongest available signal about where the value actually sits |
| **Opera Neon** | The agentic browser that actually exists. Public access Dec 2025; **MCP Connector** March 2026 lets external AI clients drive the browser | 2025-12 / 2026-03 | Agent-optimized, not Ethereum-native. Opera's crypto (MiniPay, on Celo) is a separate product. Nobody has joined the two |
| **ERC-8004** | Identity, Reputation and Validation registries for agents; mainnet 2026-01-29 | 2026-01 | Identity is specified. **Reputation and validation are deliberately left open.** That is the hole |

### 11.2 The Kohaku problem, and it is the most important finding in this addendum

The Ethereum Foundation's Kohaku roadmap
([notes.ethereum.org/@niard/KohakuRoadmap](https://notes.ethereum.org/@niard/KohakuRoadmap), verified directly) states:

> "creating a native ethereum browser is the logical path to pursue"

to give stronger security to dApp interfaces and IPFS UIs. It also commits to
"transaction security scoring through **local AI** to help identify low-risk vs high-risk
transactions without leaking private information", and to working toward native account
abstraction "over 2026", with privacy-preserving AA requiring client-side ZK-EVM proving.

**The Ethereum Foundation is roadmapping, almost item for item, the browser described in this
thread: Ethereum-native, privacy-preserving, local-AI-assisted.**

That is validation of the idea and a strategic red light on building it. The EF has more
legitimacy, more ecosystem pull, and no need to monetize the client. Kohaku is GPL-3.0, its
stated goals explicitly include "collaborations with other wallet teams", and the extension is
a reference implementation meant to be consumed.

**The correct move is to build on Kohaku, not next to it.** Netizen's differentiator was never
privacy primitives, and it should not try to become that. It is community memberships, node
identity, and the attester graph, which Kohaku does not do and shows no sign of doing.

### 11.3 Two different things are both called "stealth", and conflating them is a real risk

| | Steel's Stealth Browser | Railgun / stealth addresses (ERC-5564) |
|---|---|---|
| What it hides | The agent, from **the website's bot defenses**. Fingerprint management, stable browser signals, dedicated IPs, `puppeteer-extra-plugin-stealth` | The user's **funds and counterparties**, from onchain observers. Shielded balances, private DeFi |
| Who it defends against | Cloudflare, rate limits, anti-automation | Chain analytics |
| Legitimacy for a civic platform | **Poor.** It is evasion of other parties' access controls | **Good.** Financial privacy is a normal civic expectation |

Railgun's own state is healthy: ~$4B cumulative private volume since its 2021 launch, a record
$1.6B shielded in 2025, `railgun_connect` (private wallets interacting directly with DeFi apps)
launched 2026-01-23, and the US Treasury softened its stance on mixers on 2026-03-09,
acknowledging legitimate privacy uses. Kohaku integrates it at the wallet layer, which is the
right place. *(Whether Railgun supports Gnosis, and therefore whether it can touch Röbel Münzen
or EURe, is unverified and must be checked before any design work.)*

**The warning specific to Netizen:** Röbel is a public civic platform with a town's name on it
and a Gemeinschaftskasse behind it. A client that both evades bot detection and shields funds is
a regulatory and reputational profile no German Gemeinde will adopt. Anti-detection stealth
belongs, if anywhere, in the node's agent runtime for well-defined tasks, never in the citizen-
facing product. Financial privacy belongs in the wallet, via Kohaku, and should be described in
those terms.

### 11.4 The gap that is genuinely still open

Line the four up and the hole is obvious:

- **Steel**: the agent has hands. No identity.
- **MetaMask Agent Wallet**: the agent has funds and transaction-level safety. No notion of *on
  whose behalf*, beyond the key owner.
- **Kohaku**: the user has privacy. No memberships.
- **ERC-8004**: the agent has an identity and a place to put reputation. **Reputation and
  validation are left as an exercise for the ecosystem.**

Nobody has shipped: **"this agent is acting on behalf of this verified member of this community,
under this mandate, and here is the proof."**

That is the intersection of agent identity (ERC-8004), community membership (soulbound NFT +
SD-JWT VC), and human consent (AP2-shaped signed mandates + Zodiac Roles allowances). It is
exactly the sum of what Netizen already has and what section 10 recommends building. It is not a
browser, and it is the one thing in this landscape that a browser would actively make harder,
because its whole security argument is that the consent surface never renders attacker-controlled
content.

**Revised position on the market question:** there is no Ethereum-native agent browser, the two
parties best placed to build one are the Ethereum Foundation and MetaMask, and the correct read
of that is not "the gap is open" but "the gap is being filled by people whose work Netizen can
consume for free." Take Steel as the runtime, Kohaku as the privacy layer, ERC-8004 as the agent
registry, and spend the whole team on the layer none of them will build: verified community
membership as the thing an agent acts on behalf of.

### 11.5 Precision on Kohaku, and the blocker nobody mentions

**The Ethereum Foundation is not building a browser.** The roadmap says building one "is the
logical path to pursue". That is a stated future direction in a notes document. There is no team,
no timeline, and no repository. Do not plan around it, and do not describe it to anyone as a
product in flight.

What actually exists, today:

| | Status |
|---|---|
| Kohaku SDK | v0.0.1-alpha.21, released 2026-05-25, GPL-3.0. Integrates Railgun / Privacy Pools / Tornado at the wallet layer; EIP-4337 mempool relaying via the Railgun integration |
| Kohaku wallet | A reference **browser extension**, forked from Ambire. **Sepolia testnet only.** "Work in progress and currently under active development" |
| Native Ethereum browser | A sentence in a roadmap |

**And the blocker that decides whether Netizen can consume any of it:**

- **Railgun is live on Ethereum, BSC, Polygon and Arbitrum.** Announced 2026 expansions name
  Solana, NEAR, Arbitrum and Metis. **Gnosis is not supported and is not announced.**
- Kohaku's own approach is "mainnet first", then progressively L2s "at stage 1 committed to stage
  2 with fast withdrawals". **Gnosis is an independent L1 sidechain, not an L2**, so it does not
  sit on that roadmap path either.

**Netizen's entire stack (identity, governance, MACI, Safe, Circles/Münzen, EURe) is on the one
chain the EF privacy layer does not reach.** Any plan that says "we get privacy from Kohaku" is
currently false for this deployment.

Three responses, in order of cost:

1. **Consume the chain-agnostic half now.** Per-dapp addresses, IP protection, social recovery,
   spending policies and key management are useful independent of shielded transfers. Take those,
   skip the shielded-pool integration.
2. **Build the seam, not the integration.** A `PrivacyProvider` interface in the client, with a
   no-op implementation on Gnosis, so Kohaku drops in the day Gnosis is supported. Costs days.
3. **Be the reason Gnosis gets supported.** Netizen is a real deployment, with real users, a
   MiCA-compliant e-money token (EURe) and a live community currency, on Gnosis. Kohaku's stated
   goals explicitly include "collaborations with other wallet teams". That door is open and
   nobody has walked through it with a civic use case. This is the highest-leverage option and
   it costs a conversation.

**On offering an Ethereum-native client as a UX option:** supporting one costs nothing and
building one costs everything. Support **EIP-6963 multi-injected provider discovery** so any
client (Kohaku, Ambire, Rabby, MetaMask, Frame) can be brought by the user, ship the Netizen
extension so any browser becomes Netizen-aware, and recommend clients in the docs. That is "the
option", delivered.

One honesty note on the UX claim itself: for the median Röbel citizen, an Ethereum-native browser
is not better UX. The best UX is that they never learn there is a chain, which is what the
smart-account and gasless work already buys. Ethereum-nativeness is better UX for the crypto-
native minority and for agents. Both are worth serving. Neither is the median user.

---

## 12. Sources

Browser economics and post-mortems: [Brave, Building and releasing Brave](https://brave.com/blog/building-brave/) (2021-06-25) · [Brave, 100M MAU](https://brave.com/blog/100m-mau/) (2025-10-01) · [Brave Chromium rebases wiki](https://github.com/brave/brave-browser/wiki/Chromium-rebases) · [Vivaldi, How we work with Chromium code](https://vivaldi.com/blog/vivaldi-code-integration/) (2018-09-12) · [Browserbase, Why we forked Chromium](https://www.browserbase.com/blog/chromium-fork-for-ai-automation) (2025-11-19) · [TechCrunch, Atlassian to buy The Browser Company for $610M](https://techcrunch.com/2025/09/04/atlassian-to-buy-arc-developer-the-browser-company-for-610m) (2025-09-04) · [Atlassian announcement](https://www.atlassian.com/blog/announcements/atlassian-acquires-the-browser-company) · [Opera delists the Crypto Browser](https://blogs.opera.com/desktop/2024/02/opera-delists-the-experimental-crypto-browser/) (2024-02) · [Beaker archive notice](https://github.com/beakerbrowser/beaker/blob/master/archive-notice.md) (2021/2022)

AI and maintenance: [Chromium AI coding policy](https://chromium.googlesource.com/chromium/src/+/main/agents/ai_policy.md) · [Linuxiac, Ladybird closes public pull requests](https://linuxiac.com/ladybird-browser-closes-public-pull-requests-ahead-of-first-alpha/) (2026-06) · [AlternativeTo on the same](https://alternativeto.net/news/2026/6/ladybird-browser-ends-public-pull-requests-due-to-ai-and-security-concerns/) · [TechCrunch, Big Sleep finds 20 vulnerabilities](https://techcrunch.com/2025/08/04/google-says-its-ai-based-bug-hunter-found-20-security-vulnerabilities/) (2025-08-04) · [SecurityAffairs, Chrome flaw found by Big Sleep](https://securityaffairs.com/181338/security/google-fixed-chrome-flaw-found-by-big-sleep-ai/) · [BleepingComputer, fourth Chrome 0-day of 2026](https://www.bleepingcomputer.com/news/security/google-fixes-fourth-chrome-zero-day-exploited-in-attacks-in-2026/)

Engines: [Servo](https://servo.org/) · [Phoronix, Servo January 2026](https://www.phoronix.com/news/Servo-January-2026) · [Ladybird](https://ladybird.org/)

Naming: [ENS, How ENS is approaching ICANN's gTLD expansion](https://ens.domains/blog/post/icann-84-gtld) (2025-11-12) · [ICANN New gTLD Program 2026 Round](https://newgtldprogram.icann.org/en/application-rounds/round2) · [The Register, ICANN opens gTLD applications](https://www.theregister.com/2026/05/01/icann_new_gtld_applications/) (2026-05-01) · [ENS DAO forum, DNS collisions of ENS names](https://discuss.ens.domains/t/dns-collisions-of-ens-names-in-browser-input/12539) (2022-05-07) · [ENS DAO forum, ICANN application for .ETH and .ENS](https://discuss.ens.domains/t/icann-application-for-eth-and-ens-tlds/20182) · [ENS, .box integration](https://ens.domains/blog/post/ens-integrates-dot-box) · [ENS, Doma/D3 tokenized DNS](https://ens.domains/blog/post/d3-doma) · [CoinDesk, ENS scraps Namechain](https://www.coindesk.com/tech/2026/02/06/ethereum-s-ens-identity-system-scraps-planned-rollup-amid-vitalik-s-warning-about-layer-2-networks) (2026-02-06) · [ENSIP-23 Universal Resolver](https://docs.ens.domains/ensip/23/)

Extensions: [Igalia, Protocol handler registration via browser extensions](https://blogs.igalia.com/jfernandez/2026/03/24/protocol-handler-registration-via-browser-extensions/) (2026-03-24) · [Chrome, declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) · [Chrome, Replace blocking web request listeners](https://developer.chrome.com/docs/extensions/develop/migrate/blocking-web-requests) · [Brave ENS offchain lookup wiki](https://github.com/brave/brave-browser/wiki/ENS-offchain-lookup) · [ComfyGummy/chrome-web3](https://github.com/ComfyGummy/chrome-web3) · [cpacia/ens-chrome-extension](https://github.com/cpacia/ens-chrome-extension)

Identity and EU: [EUDI ARF](https://eudi.dev/2.2.0/architecture-and-reference-framework-main/) · [EUDI relying-party registration](https://eudi.dev/latest/discussion-topics/x-relying-party-registration/) · [TS6, relying-party information](https://github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications/blob/main/docs/technical-specifications/ts6-common-set-of-rp-information-to-be-registered.md) · [EUDI reference implementation](https://github.com/eu-digital-identity-wallet) · [OpenID4VP 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) · [walt.id, eIDAS2 wallet provider requirements](https://walt.id/eidas2/wallet-provider) · [Council of the EU, European business wallets negotiating position](https://www.consilium.europa.eu/en/press/press-releases/2026/06/09/european-business-wallets-council-adopts-negotiating-position/) (2026-06-09) · [European Parliament legislative train, European business wallets](https://www.europarl.europa.eu/legislative-train/theme-a-new-plan-for-europe-s-sustainable-prosperity-and-competitiveness/file-european-business-wallet) · [EDPS opinion on EBW](https://www.edps.europa.eu/system/files/2026-01/26-01-20_opinion_establishment_of_european_business_wallets_en.pdf) (2026-01-20) · [CoinDesk, Holonym acquires Gitcoin Passport](https://www.coindesk.com/business/2025/02/10/digital-identity-startup-holonym-acquires-gitcoin-passport) (2025-02-10) · [Human Passport rebrand](https://passport.human.tech/blog/from-gitcoin-passport-to-human-passport-we-re-now-part-of-human-tech) · [Semaphore docs](https://docs.semaphore.pse.dev/) · [EAS docs](https://docs.attest.org/) · [SpruceID](https://spruceid.com/)

Agents (section 10): [Brave, Agentic browser security: indirect prompt injection in Comet](https://brave.com/blog/comet-prompt-injection/) (2025-08-20) · [Brave, Unseeable prompt injections in screenshots](https://brave.com/blog/unseeable-prompt-injections/) · [Chrome for Developers, WebMCP](https://developer.chrome.com/docs/ai/webmcp) · [VentureBeat, Chrome ships WebMCP in early preview](https://venturebeat.com/infrastructure/google-chrome-ships-webmcp-in-early-preview-turning-every-website-into-a) · [Chrome at I/O 2026](https://developer.chrome.com/blog/chrome-at-io26) · [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) · [erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) · [Steel Browser](https://github.com/steel-dev/steel-browser) · [AP2 explainer](https://eco.com/support/en/articles/14845479-ap2-agent-payments-protocol-explained)

Market scan (section 11): [Kohaku roadmap, notes.ethereum.org](https://notes.ethereum.org/@niard/KohakuRoadmap) · [ethereum/kohaku-extension](https://github.com/ethereum/kohaku-extension) · [Cryptopolitan on the Kohaku roadmap](https://www.cryptopolitan.com/ethereum-foundation-roadmap-for-kohaku/) · [Steel blog, Launch Week v3 and Stealth Browser](https://steel.dev/blog) · [MetaMask, Agent Wallet launch](https://metamask.io/news/metamask-launches-agent-wallet-giving-ai-agents-full-defi-access-with-default-security-on-every-transaction) (2026-06-08) · [CoinDesk on MetaMask Agent Wallet](https://www.coindesk.com/tech/2026/06/08/metamask-launches-ai-agent-wallet-with-built-in-security-for-crypto-trades) · [Opera Neon public access](https://investor.opera.com/news-releases/news-release-details/opera-opens-public-access-opera-neon-its-experimental-agentic-ai/) · [RAILGUN v3 architecture](https://medium.com/@Railgun_Project/the-new-architecture-for-ethereum-privacy-introducing-railgun-v3-21e111fa297e) · [Railgun on DefiLlama](https://defillama.com/protocol/railgun)

Distribution and search: [a16z, State of Crypto 2025](https://a16zcrypto.com/posts/article/state-of-crypto-report-2025/) · [growthepie, daily active addresses](https://www.growthepie.com/fundamentals/daily-active-addresses) · [Ecosia, teaming up with Qwant on a European search index](https://blog.ecosia.org/eusp/) · [European Search Perspective](https://www.eu-searchperspective.com/) · [ZenDiS](https://www.zendis.de/en) · [openProject, the rise of the Sovereign Workplace](https://www.openproject.org/blog/sovereign-workplace/)
