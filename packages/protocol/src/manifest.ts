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
    })
    .optional(),
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

  chain: z.object({
    chainId: z.number().int().positive(),
    rpc: urlOrSecret,
  }),
  contracts: z.object({
    citizenNft: address,
    attesterNft: address,
    governor: address,
    timelock: address,
    maci: address,
    safe: address,
    circlesGroup: address.optional(),
    gatekeeper: address.optional(),
  }),

  identity: Identity,
  governance: Governance,
  treasury: Treasury,
  services: Services,
  ai: Ai.optional(),
  agents: Agents.optional(),

  branding: z
    .object({
      primary: z.string(),
      logo: z.string().optional(),
      fonts: z.array(z.string()).optional(),
    })
    .optional(),
  modules: z.record(z.boolean()),

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
