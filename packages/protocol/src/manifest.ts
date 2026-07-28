import { z } from "zod";

/**
 * NSP-0 v2 — the Netizen Node Manifest.
 *
 * One signed JSON document = a sovereign node. Chain-agnostic, secrets by
 * reference (never inline), modular under a single validated root. See
 * docs/superpowers/specs/2026-07-26-netizen-node-manifest.md.
 */

const address = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "expected a 20-byte EVM address");

/**
 * A reference to a secret — NEVER an inline value. `$ENV_VAR` (resolved from the
 * environment / Fly secrets) or `vault:<path>`. This is what makes the manifest
 * safe to publish, sign, and anchor on-chain.
 */
const secretRef = z
  .string()
  .regex(
    /^(\$[A-Z0-9_]+|vault:[\w./-]+)$/,
    "must be a secret reference ($ENV_VAR or vault:path), not an inline value",
  );

const urlOrSecret = z.union([z.string().url(), secretRef]);

const RelyingParty = z.object({
  id: z.string().min(1),
  redirectUris: z.array(z.string().url()).min(1),
  scopes: z.array(z.string()).optional(),
});

/** NSP-1 — Identity & SSO. The node's own sovereign OIDC IdP + membership + federation. */
const Identity = z.object({
  idp: z.object({
    issuer: z.string().url(),
    discovery: z.string().url(),
    /**
     * Where the identity provider RUNS. "node" = provisioned by the installer on
     * this node's box. "external" = already hosted elsewhere (e.g. Fly), so the
     * installer must NOT start a second keystone or route to a local one — it
     * only points the other services at `issuer`. Defaults to "node".
     */
    hosted: z.enum(["node", "external"]).optional(),
    jwks: secretRef,
    authMethods: z
      .array(z.enum(["wallet-siwe", "google", "apple", "facebook", "email"]))
      .min(1),
    scopes: z.array(z.string()).min(1),
    claims: z.array(z.string()).min(1),
  }),
  // The swappable wallet→account seam (MISSION G2). Flipping providers is a manifest edit.
  // The ERC-4337 fields are what "Netizen mints accounts on its own rails" needs.
  authBridge: z.object({
    provider: z.enum(["thirdweb", "netizen"]),
    chain: z.number().int().positive(),
    accountType: z.literal("erc4337-smart"),
    bundlerRpc: secretRef.optional(),
    entryPoint: address.optional(),
    factory: address.optional(),
    paymaster: address.optional(),
  }),
  // Drives the keystone's first-party client list (apps/roebel-id firstPartyClientIds).
  relyingParties: z.array(RelyingParty),
  membership: z.object({
    credential: z.string(),
    admission: z.object({
      attesterBand: z.string(),
      sybilTier: z.string(),
    }),
    portable: z.boolean(),
    exitable: z.boolean(),
  }),
  // NSP-6 agent principals from the same IdP.
  agentIdentity: z.object({
    grant: z.literal("client_credentials"),
    delegation: z.literal("rfc8693-act"),
    killSwitch: z.boolean(),
  }),
  // "Sign in with <node>" — peer-to-peer, never central.
  federation: z.object({
    trustedIssuers: z.array(z.string().url()),
    registry: z.string().optional(),
  }),
});

/** NSP-2 — on-chain governance (MACI + coordinator). */
const Governance = z.object({
  engine: z.enum(["maci", "simple", "none"]),
  quorum: z.record(z.unknown()).optional(),
  coordinator: z.object({
    type: z.enum(["shamir", "single", "none"]),
    threshold: z.string().optional(),
    pubkey: secretRef.optional(),
  }),
  executionMatrix: z.record(z.unknown()).optional(),
});

/** NSP-3 — treasury / fiscal constitution. Signers are authoritative ON-CHAIN (the Safe). */
const Treasury = z.object({
  safe: address,
  threshold: z.number().int().positive().optional(),
  signers: z.array(address).optional(),
  splits: z
    .record(z.number())
    .refine(
      (s) => Object.values(s).reduce((a, b) => a + b, 0) === 100,
      "treasury.splits must sum to 100",
    )
    .optional(),
  agentBudgets: z
    .array(z.object({ role: z.string(), cap: z.string(), token: z.string() }))
    .optional(),
});

/** NSP-7 (new) — the deployable infrastructure layer. */
const Services = z.object({
  host: z.object({ provider: z.string(), region: z.string() }),
  // The openDesk-equivalent office suite. Nextcloud/Collabora + Matrix are provisioned
  // by the installer today; mail/wiki/video/project/portal are modeled here and
  // provisioned on the roadmap. Each lights up its dashboard tile only when set.
  workspace: z
    .object({
      nextcloud: z.string().url().optional(), // files
      collabora: z.boolean().optional(), // collaborative docs
      groupFolders: z.boolean().optional(), // shared folder per org
      /**
       * Origins allowed to act as a WOPI host against this node's Collabora —
       * i.e. the app that embeds the editor. Without the app's own origin here,
       * Collabora refuses to render its documents.
       */
      wopiHosts: z.array(z.string().url()).optional(),
      /**
       * Enable user_oidc bearer-token validation, which lets the app call
       * WebDAV/OCS with the citizen's access token instead of a password.
       * Needs user_oidc >= 7.4.0.
       */
      bearerValidation: z.boolean().optional(),
      mail: z.string().url().optional(), // Open-Xchange (mail/calendar/contacts)
      wiki: z.string().url().optional(), // XWiki
      video: z.string().url().optional(), // Jitsi
      project: z.string().url().optional(), // OpenProject
      portal: z.string().url().optional(), // openDesk-style launcher
    })
    .optional(),
  // The community data backend (Netizen Node). Modeled here; provisioning is roadmap.
  backend: z
    .object({
      provider: z.enum(["supabase", "postgres"]),
      url: urlOrSecret.optional(),
      realtime: z.boolean().optional(),
      edgeFunctions: z.boolean().optional(),
    })
    .optional(),
  chat: z
    .object({
      matrix: z
        .object({
          homeserver: z.string().url(),
          mas: z.string().url(),
          element: z.string().url(),
        })
        .optional(),
      nostr: z
        .object({
          relay: z.string().regex(/^wss:\/\//, "nostr relay must be a wss:// url"),
          groupsRelay: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  /**
   * NSP-10 — the cross-node query layer.
   *
   * Federation gives a node two stores (its own relay and its peers' mirror) and
   * no way to ask a question across them. The indexer is that: search, time
   * ranges, per-author history, and provenance — which node did this come from.
   *
   * `publicRead` exposes it at a hostname. Everything it serves already came off
   * world-readable relays, so publishing leaks nothing new, and it is what lets a
   * PEER's agent query this node. A community that wants it internal-only omits it.
   */
  indexer: z
    .object({
      publicRead: z.string().url().optional(),
      /** Event kinds to index. No implicit "all" — widening is a visible edit. */
      kinds: z.array(z.number().int().nonnegative()).min(1),
      ingestIntervalSeconds: z.number().int().positive().optional(),
    })
    .optional(),
  // Secret references only (guards the "secrets by reference" rule).
  secrets: z.record(secretRef).optional(),
});

/** NSP-8 (new) — sovereign AI: model routing, sovereignty tier, MCP, data-egress, agent workers. */
const Ai = z.object({
  gateway: z.string(), // e.g. "litellm"
  selfHosted: z.boolean().optional(), // does the gateway run on the node
  gpuHost: z.string().optional(), // EU GPU host for sovereignty-tier models
  models: z.record(z.string()),
  sovereignty: z
    .object({
      tier: z.string(),
      model: z.string().optional(),
      dataEgressPolicy: z.string(),
    })
    .optional(),
  mcp: z.object({ toolBus: z.string().url() }).optional(),
  contextGraph: z.boolean().optional(),
  // Long-running agent workers (the "AI members" of the Buzz-like workspace).
  workers: z
    .array(z.object({ name: z.string(), model: z.string().optional(), transport: z.enum(["xmtp", "nostr"]).optional() }))
    .optional(),
});

/**
 * NSP-9 — federation. Which OTHER nodes this one exchanges public data with.
 *
 * Deliberately top-level and NOT inside `identity.federation`: that block means
 * OIDC trusted issuers — *who may log in here*. Which nodes mirror each other's
 * public record is a different question, and two things called "federation" in
 * one manifest is a trap for whoever reads it next.
 *
 * Declaring a peer IS the authorisation — the same principle as `alwaysAllow`
 * agent keys: an operator putting it in the manifest is the decision, and it is
 * auditable in a git diff. A future `peerRegistry` can populate this same shape
 * from an on-chain contract without changing anything downstream.
 *
 * Federation is PULL-ONLY, so there is no direction to configure. A node reaches
 * out, reads a peer's public record, and stores it in its own federation mirror.
 * No node ever writes into another node's database — each decides what it
 * ingests, and both ends still converge on the same set. That is a sovereignty
 * property, not an implementation detail.
 */
const Peer = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "peer id must be a lowercase slug"),
  name: z.string().min(1),
  /**
   * The peer's relay.
   *
   * `wss://` always. Plaintext `ws://` is permitted ONLY for a host with no dot —
   * a container/service name or `localhost` — which cannot be routed off the
   * machine. The rule being encoded is "never plaintext across a network you do
   * not control", not "always TLS": demanding a public DNS name and a certificate
   * for a same-host test fixture would push people toward disabling the check.
   */
  relay: z
    .string()
    .refine(
      (u) =>
        /^wss:\/\/.+/.test(u) ||
        /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\]|[^./:]+)(:\d+)?(\/.*)?$/.test(u),
      "a peer relay must be wss://, or ws:// only for a same-host name (no dot)",
    ),
  /**
   * Event kinds this link carries. There is no implicit "all": a link that
   * declares nothing carries nothing, so widening what leaves the node is always
   * a visible edit.
   */
  kinds: z.array(z.number().int().nonnegative()).min(1),
  /**
   * Why this peer is trusted, in plain language. Required: a trust decision with
   * no stated reason is one nobody can review later, and this is the file a
   * contributor reads to understand who this node talks to.
   */
  why: z.string().min(1, "state why this peer is trusted"),
});

/** NSP-6 — agent charter + agent-to-agent transport. */
const Agents = z.object({
  charter: z.object({
    scopes: z.array(z.string()),
    killSwitch: z.boolean(),
    auditSink: z.string().optional(),
    x402Bounds: z.record(z.unknown()).optional(),
  }),
  a2a: z
    .object({
      transport: z.enum(["xmtp", "nostr"]),
      nostrKey: z.string().optional(),
      /**
       * Nostr pubkeys (64-hex) of this node's own agents, which keep relay write
       * access across every allow-list sync.
       *
       * An agent's key is NIP-06 derived from an agent smart account that holds
       * no CitizenNFT, so the citizen-membership syncer would erase it on the
       * next pass. Declaring it here IS the authorisation — auditable in git,
       * rather than hand-added to a generated file that is about to be rewritten.
       */
      relayPubkeys: z
        .array(z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase 64-hex nostr pubkey"))
        .optional(),
    })
    .optional(),
});

/**
 * NSP-9 — node operations: durability and host hardening.
 *
 * Sovereignty means owning the infrastructure AND the responsibility. A managed
 * SaaS quietly does this work for you; a sovereign node does not. **A node you
 * cannot restore from is less sovereign than the SaaS it replaced**, so this
 * block is declarative like everything else — node #2 inherits the durability,
 * it does not repeat the mistake.
 */
const Operations = z.object({
  backup: z
    .object({
      /** systemd OnCalendar expression. "02:30" = nightly at 02:30 local. */
      schedule: z.string().default("02:30"),
      /** Local dumps older than this are pruned. Offsite retention is restic's. */
      retentionDays: z.number().int().positive().default(14),
      /**
       * What to dump. Postgres is transaction-consistent (`pg_dump -Fc`);
       * Nextcloud's data dir is captured under maintenance mode so files and DB
       * agree; strfry is exported as JSONL because copying a live LMDB is not safe.
       */
      include: z.array(z.enum(["postgres", "nextcloud", "strfry"])).optional(),
      /**
       * Off-box destination. A snapshot on the same provider is NOT a backup
       * strategy — it dies with the account. `restic-sftp` targets e.g. a Hetzner
       * Storage Box; credentials come from .env, never from this manifest.
       */
      offsite: z.enum(["restic-sftp", "restic-s3", "none"]).default("none"),
    })
    .optional(),
  hardening: z
    .object({
      /** false ⇒ installer sets `PasswordAuthentication no` (keys only). */
      sshPasswordAuth: z.boolean().optional(),
      fail2ban: z.boolean().optional(),
    })
    .optional(),
  /**
   * Emit machine-readable health at a stable path so an AI agent can read node
   * state as data instead of scraping human prose. See `ops/status.json`.
   */
  agentReadableHealth: z.boolean().optional(),
});

export const NetizenManifestSchema = z.object({
  nsp: z.literal("0"),
  manifestVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "expected semver"),
  id: z.string().regex(/^[a-z0-9-]+$/, "node id must be a lowercase slug"),
  name: z.string().min(1),
  // A node is ANY sovereign entity — not just a town. The stack empowers
  // individuals, businesses, clubs, institutions, communities, and AI agents
  // equally; each runs its own node (identity + wallet + governance + AI).
  type: z
    .enum(["community", "town", "individual", "business", "club", "institution", "agent"])
    .optional(),

  /**
   * Everything from here to `services` is OPTIONAL — the civic stack.
   *
   * The minimum viable Netizen node is an id, a name and some services: a relay
   * that federates is a legitimate node. Requiring a Safe, a MACI deployment, an
   * OIDC issuer and six contract addresses before anyone can run one turns "fork
   * this" into "reproduce a whole town first", which is the opposite of the point.
   *
   * Röbel declares all of it. A contributor's relay-only node declares none of it,
   * and the installer simply emits nothing for what is absent.
   */
  chain: z
    .object({
      chainId: z.number().int().positive(),
      rpc: urlOrSecret,
    })
    .optional(),
  contracts: z.object({
    citizenNft: address,
    attesterNft: address,
    governor: address,
    timelock: address,
    maci: address,
    safe: address,
    circlesGroup: address.optional(),
    gatekeeper: address.optional(),
  }).optional(),

  identity: Identity.optional(),
  governance: Governance.optional(),
  treasury: Treasury.optional(),
  services: Services,
  ai: Ai.optional(),
  agents: Agents.optional(),
  operations: Operations.optional(),
  /** NSP-9 — nodes this one mirrors public events with. Absent means no federation. */
  peers: z.array(Peer).optional(),

  branding: z
    .object({
      primary: z.string(),
      logo: z.string().optional(),
      fonts: z.array(z.string()).optional(),
    })
    .optional(),
  /** Feature switches. A node that declares none simply runs none. */
  modules: z.record(z.boolean()).optional(),

  signature: z
    .object({
      signer: address,
      alg: z.literal("eip191"),
      sig: z.string(),
    })
    .optional(),
});

export type NetizenManifest = z.infer<typeof NetizenManifestSchema>;

/** Parse + validate a manifest. Throws a ZodError on drift. */
export function parseManifest(input: unknown): NetizenManifest {
  return NetizenManifestSchema.parse(input);
}

/** Non-throwing variant. */
export function safeParseManifest(input: unknown) {
  return NetizenManifestSchema.safeParse(input);
}
