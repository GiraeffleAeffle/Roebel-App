# Working in Röbel

Röbel connects public discussion to evidence, citizen adoption and accountable
municipal handling. Read [CONTEXT.md](CONTEXT.md) before changing that flow and
the relevant [ADRs](docs/adr/) before changing its boundaries.

## Execution

- Carry the requested slice through implementation and the required checks.
  Honor authorization already given in the conversation. Prepare a concrete,
  reviewable change before requesting any additional approval that is needed;
  identify the exact rule or external restriction requiring it.
- Report the current roadmap milestone, verified progress and next unresolved
  gate. Distinguish local tests, published images and verified live behavior.
- Use sub-agents only when the user explicitly requests delegation or parallel
  agent work. Preserve unrelated edits; use an isolated worktree when needed.
- Prefer removing an unused path or duplicated behavior over adding another
  wrapper. Confirm callers and ownership first. Preserve historical deployment
  data and tests that protect signatures, privacy or authority boundaries.

## Implementation and verification

- Use pnpm. Read the owning package's scripts instead of copying command lists
  into documentation. Keep changes in the package that owns the behavior.
- Test observable behavior at the nearest stable interface. Reuse existing
  fixtures and assertions; add regression coverage for a demonstrated failure.
  Remove a test only when its behavior is obsolete or covered elsewhere, and
  record that reason. Avoid tests that merely match implementation text.
- Start with affected checks, then satisfy required CI. Repeat or broaden tests
  when a change, failure or unresolved concern warrants it. Documentation edits
  need link/consistency checks; they do not require an application rebuild.
- For build work, read [ADR 0018](docs/adr/0018-separate-public-journey-and-operator-console-build-boundaries.md).
  Measure the affected job; keep Web compilation in its existing OCI lane.
  Frontend/backend boundaries and an independently deployed operator console
  are separate decisions. A folder move alone proves no speed improvement.
- Keep at least 20 GiB free before and after local container builds. Follow the
  user's storage policy and run `~/.local/bin/codex-storage-guard` afterwards.

## Product boundaries

- Public projections are read-only. AI answers and participant suggestions do
  not grant citizen eligibility, create a CivicCase or imply municipal approval.
  Synthetic staging credentials and receipts stay separate from real adoption.
- German is the primary UI language. Use shared design tokens. Web uses
  Tailwind; Expo uses `StyleSheet.create()` and `useTheme()`. A NativeWind
  migration requires explicit user authorization because the previous attempt
  broke the mobile app.
- Runtime model/provider choices belong in the existing configuration seam.
  Agent-working guidance is not an instruction to migrate the product's model.
- Use each app's environment examples; never commit keys or private operational
  receipts. The hosted Supabase project registered in `.mcp.json` is operated
  through its Supabase MCP. Self-hosted staging infrastructure is owned by the
  separate staging-operations repository and its reviewed runbooks.

## Read when relevant

- Mobile: [apps/expo/CLAUDE.md](apps/expo/CLAUDE.md).
- Contracts: [shared addresses and ABIs](packages/blockchain/src/index.ts) and
  [deployment manifests](contracts/governor-contract/deployments/). Preserve
  legacy references needed to read historical proposals.
- Coordinator/threshold keys: [ceremony](docs/SHAMIR_CEREMONY.md) and
  [MACI operations](docs/MACI_SHAMIR_OPERATIONS.md), including production lessons,
  before changing coordinator scripts or handling key material.
- Direct messages: [XMTP integration state](docs/XMTP_INTEGRATION_STATE.md).
- CI automation: [workflow catalog](docs/CI_AUTOMATION.md).
- Contributor setup: [onboarding](docs/CONTRIBUTOR_ONBOARDING.md).
- Architecture backlog: [roadmap](docs/ROADMAP_AND_DEFERRED.md).
