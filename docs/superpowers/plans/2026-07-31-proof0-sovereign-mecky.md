# Proof 0 — Sovereign Mecky Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip Röbel's `ai.selfHosted` to `true` honestly: a rented EU GPU box serves an open model + embeddings, the node's LiteLLM gateway routes every Mecky call under a manifest-declared egress policy, Mecky answers town-document questions from a sovereign RAG corpus, and `netizen doctor` proves it live.

**Architecture:** The gateway (LiteLLM + its config + virtual keys) lives on the existing Röbel node box; a new GPU box (Hetzner GEX44) is a dumb, replaceable model server (vLLM + TEI behind Caddy/TLS, firewalled to the node). Both are rendered from the manifest by `netizen render` and deployed by `netizen up` — nothing hand-wired (the "everything into the installer" rule). RAG corpus lives in Supabase pgvector; both Mecky surfaces (web route, expo client) talk only to the gateway.

**Tech Stack:** zod (NSP-8), vitest, LiteLLM (`ghcr.io/berriai/litellm`), vLLM (`vllm/vllm-openai`), TEI (`text-embeddings-inference:cpu`) with BAAI/bge-m3 (1024-dim), Caddy, Supabase pgvector, Vercel AI SDK (`@ai-sdk/openai-compatible`), Expo.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-31-sovereign-ai-product-design.md` (§4.2 tiers, §5 NSP-8 extensions, §9 Proof 0, §10 honesty).
- Two repos: **N** = `/Users/maxbrych/Documents/privat/side_projects/netizen_labs`, **R** = `/Users/maxbrych/Documents/privat/side_projects/DAO_test`. Every task names its repo.
- **Parallel sessions are active in BOTH repos** (Accounts/signer plane touches `packages/protocol`). Always `git pull --rebase` before push; commit with **explicit pathspecs only**, never `git add .`.
- pnpm only. All UI text German. Supabase operations via the Supabase MCP (never raw CLI). Never commit secrets; `.env.example` placeholders only.
- The user runs `eas update` himself — expo tasks end at commit+push.
- Repo R has ~431 pre-existing tsc errors (untyped Supabase client) — do not chase them; verify expo changes by running, not by tsc.
- Copy rule (public Netizen copy only): no em-dashes, "Onchain" one word.
- Model roles in the manifest: non-pinned values are LiteLLM provider-prefixed ids (`anthropic/claude-sonnet-5`); pinned roles' backend model is `ai.sovereignty.model` (a HuggingFace id). The `image` role is NOT routed through the gateway (stays on the kie.ai path, `lib/images/kie.ts`).

---

### Task 0: Operator prerequisites (USER-RUN — gates Tasks A5, B1–B5)

No code. The human operator must:

- [ ] Rent **Hetzner GEX44** (RTX 4000 SFF Ada 20 GB, €232.30/mo + €114 setup), Ubuntu 24.04, same Hetzner project as the node box.
- [ ] DNS: `A gpu.roebel.app → <GEX44 IP>` and `A ai.roebel.app → <node box IP 178.105.19.80>`.
- [ ] Hetzner Cloud Firewall on the GEX44: allow tcp/80 + tcp/443 from anywhere (ACME + gateway; vLLM itself is additionally key-protected), allow tcp/22 from operator IP.
- [ ] Append to the **node box** `.env`: `LITELLM_MASTER_KEY=<openssl rand -hex 32>`, `VLLM_API_KEY=<openssl rand -hex 32>`, `ANTHROPIC_API_KEY=<existing key>`.
- [ ] Create the **GPU box** `.env` (path `/opt/netizen/roebel-ai/.env` after first `up --ai-host` — the executor deploys bundle `<id>-ai` under `/opt/netizen/`): `VLLM_API_KEY=<same value>`.

---

## Phase A — repo N: the sovereign AI plane in the installer

### Task A1: NSP-8 schema — `corpus`, `sovereignty.pinnedRoles`

**Files:**
- Modify: `packages/protocol/src/manifest.ts` (the `Ai` object, near line 247)
- Test: `packages/protocol/test/manifest.test.ts`

**Interfaces:**
- Produces: `Ai.corpus?: Array<{id: string; description: string; visibility: "internal"|"members"|"public"|"sellable-as-answers"}>`, `Ai.sovereignty.pinnedRoles?: string[]` (must be a subset of `keys(ai.models)`), consumed by A2 (render) and A4 (doctor).

- [ ] **Step 1: Write the failing tests** (append to `packages/protocol/test/manifest.test.ts`, following that file's existing describe/it style):

```ts
describe("NSP-8 corpus + pinnedRoles", () => {
  const base = {
    // reuse the file's existing minimal-valid-manifest fixture; spread and extend:
    ai: {
      gateway: "litellm",
      selfHosted: true,
      gpuHost: "gpu.example.org",
      models: { chat: "anthropic/claude-sonnet-5", "sovereign-chat": "pinned", embed: "pinned" },
      sovereignty: {
        tier: "eu-gpu",
        model: "utter-project/EuroLLM-9B-Instruct",
        dataEgressPolicy: "citizen-linked-pinned-local",
        pinnedRoles: ["sovereign-chat", "embed"],
      },
      corpus: [
        { id: "ratsprotokolle", description: "Protokolle der Stadtvertretung", visibility: "public" },
      ],
    },
  };

  it("accepts corpus entries and pinnedRoles that reference declared roles", () => {
    expect(() => parseManifest({ ...minimalManifest, ...base })).not.toThrow();
  });

  it("rejects a pinnedRole that is not a declared model role", () => {
    const bad = structuredClone(base);
    bad.ai.sovereignty.pinnedRoles = ["sovereign-chat", "ghost-role"];
    expect(() => parseManifest({ ...minimalManifest, ...bad })).toThrow(/pinnedRoles/);
  });

  it("rejects an unknown corpus visibility", () => {
    const bad = structuredClone(base);
    (bad.ai.corpus[0] as any).visibility = "secret";
    expect(() => parseManifest({ ...minimalManifest, ...bad })).toThrow();
  });
});
```

(Use the fixture/parse helper names the test file actually exports — read its top 30 lines first and keep its conventions; the assertions above are the contract.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/protocol && pnpm vitest run test/manifest.test.ts -t "NSP-8 corpus"`
Expected: FAIL (unknown keys stripped or refine missing).

- [ ] **Step 3: Implement** — inside the `Ai` z.object, add:

```ts
  corpus: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/, "corpus id must be a lowercase slug"),
        description: z.string().min(1),
        /** Manifest-declared visibility class (spec §5.2): naming a corpus here IS the decision about who may query it. */
        visibility: z.enum(["internal", "members", "public", "sellable-as-answers"]),
      }),
    )
    .optional(),
```

and extend `sovereignty` with:

```ts
      /** Roles that MUST resolve to node-controlled backends. Render maps them to the gpuHost; doctor refuses selfHosted without them. */
      pinnedRoles: z.array(z.string()).optional(),
```

then wrap `Ai` with the cross-field check:

```ts
const Ai = z
  .object({ /* …existing fields… */ })
  .superRefine((ai, ctx) => {
    const roles = Object.keys(ai.models ?? {});
    for (const r of ai.sovereignty?.pinnedRoles ?? [])
      if (!roles.includes(r))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `pinnedRoles: "${r}" is not a declared model role` });
  });
```

- [ ] **Step 4: Run to verify pass**: same command, Expected: PASS. Also run the full file: `pnpm vitest run test/manifest.test.ts` — no regressions.
- [ ] **Step 5: Commit** (pathspecs, rebase first):

```bash
git pull --rebase
git add packages/protocol/src/manifest.ts packages/protocol/test/manifest.test.ts
git commit -m "feat(protocol): NSP-8 grows corpus declarations and pinned roles — the egress policy becomes checkable"
git push
```

### Task A2: Gateway render — real LiteLLM config, DB-backed keys, Caddy vhost

**Files:**
- Modify: `packages/cli/src/render.ts` (`renderLiteLlmConfig` at ~1578; litellm compose block at ~748; the node Caddyfile renderer; the node bootstrap script renderer)
- Test: `packages/cli/test/render.test.ts`

**Interfaces:**
- Consumes: A1's `pinnedRoles`, `corpus`.
- Produces: rendered `ai/litellm.yaml` where pinned chat roles → `hosted_vllm/<sovereignty.model>` at `https://<gpuHost>/v1`, the `embed` role → `openai/bge-m3` at `https://<gpuHost>/embed/v1`, other roles pass through; `general_settings.master_key`; litellm service with `DATABASE_URL` (virtual keys); `ai.<domain>` Caddy vhost.

- [ ] **Step 1: Failing tests** (append to `packages/cli/test/render.test.ts`, reusing its manifest fixture pattern with the A1 `ai` block):

```ts
describe("sovereign AI gateway render", () => {
  it("maps pinned roles to the gpuHost and leaves frontier roles pass-through", () => {
    const files = render(aiManifest); // the suite's existing render entry point
    const y = files["ai/litellm.yaml"];
    expect(y).toContain("model_name: sovereign-chat");
    expect(y).toContain("model: hosted_vllm/utter-project/EuroLLM-9B-Instruct");
    expect(y).toContain("api_base: https://gpu.example.org/v1");
    expect(y).toContain("api_key: os.environ/VLLM_API_KEY");
    expect(y).toContain("model_name: embed");
    expect(y).toContain("api_base: https://gpu.example.org/embed/v1");
    expect(y).toContain("model: anthropic/claude-sonnet-5");
    expect(y).toContain("master_key: os.environ/LITELLM_MASTER_KEY");
    expect(y).not.toContain("model_name: image"); // image stays on the kie path
  });
  it("gives litellm a database for virtual keys and a public vhost", () => {
    const files = render(aiManifest);
    expect(files["docker-compose.yml"]).toMatch(/litellm:[\s\S]*DATABASE_URL/);
    expect(files["Caddyfile"]).toMatch(/ai\.example\.org[\s\S]*reverse_proxy litellm:4000/);
  });
});
```

- [ ] **Step 2: Verify FAIL**: `cd packages/cli && pnpm vitest run test/render.test.ts -t "sovereign AI"`.
- [ ] **Step 3: Implement.** Replace `renderLiteLlmConfig`:

```ts
export function renderLiteLlmConfig(m: NetizenManifest): string {
  const pinned = new Set(m.ai?.sovereignty?.pinnedRoles ?? []);
  const gpu = m.ai?.gpuHost;
  const served = m.ai?.sovereignty?.model;
  const entries = Object.entries(m.ai?.models ?? {})
    .filter(([role]) => role !== "image") // image generation stays on the kie.ai path — not gateway-routed yet
    .map(([role, model]) => {
      if (pinned.has(role) && role === "embed")
        return `  - model_name: ${role}\n    litellm_params:\n      model: openai/bge-m3\n      api_base: https://${gpu}/embed/v1\n      api_key: none`;
      if (pinned.has(role))
        return `  - model_name: ${role}\n    litellm_params:\n      model: hosted_vllm/${served}\n      api_base: https://${gpu}/v1\n      api_key: os.environ/VLLM_API_KEY`;
      return `  - model_name: ${role}\n    litellm_params:\n      model: ${model}`;
    })
    .join("\n");
  const tier = m.ai?.sovereignty?.tier ?? "unset";
  const policy = m.ai?.sovereignty?.dataEgressPolicy ?? "unset";
  return `# Generated by \`netizen render\` — AI gateway for node "${m.id}".
# Sovereignty tier: ${tier} · data-egress policy: ${policy}
# Pinned roles (must not egress): ${[...pinned].join(", ") || "none"}
# API keys come from ./.env (never this file).
model_list:
${entries || "  []"}
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
`;
}
```

In the compose block (~750), extend the litellm service:

```yaml
    environment:
      DATABASE_URL: "postgres://postgres:${POSTGRES_PASSWORD}@postgres/litellm"
    depends_on: [postgres]
```

(keep `env_file`, volume, command, `expose: ["4000"]`; if the manifest has AI but no other postgres consumer, the existing `needsPostgres` logic must also count `m.ai?.selfHosted` — adjust it). In the node Caddyfile renderer, add alongside the existing vhost blocks, gated on `m.ai?.selfHosted`:

```
ai.{domain} {
  reverse_proxy litellm:4000
}
```

In the node bootstrap script renderer, after postgres is up, add (gated the same way): `docker compose exec -T postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='litellm'" | grep -q 1 || docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE litellm"`.

- [ ] **Step 4: Verify PASS** + full `pnpm vitest run test/render.test.ts` — no regressions.
- [ ] **Step 5: Commit**: `git pull --rebase && git add packages/cli/src/render.ts packages/cli/test/render.test.ts && git commit -m "feat(cli): the gateway becomes real — pinned roles route to the GPU host, keys get a database, ai.<domain> goes live" && git push`

### Task A3: The GPU-box bundle + `netizen up --ai-host`

**Files:**
- Modify: `packages/cli/src/render.ts` (new `renderAiGpuBundle`, wired into the render output map ~1879), `packages/cli/src/cli.ts` (`up` case, ~line 120)
- Test: `packages/cli/test/render.test.ts`

**Interfaces:**
- Produces: files `ai-gpu/docker-compose.yml`, `ai-gpu/Caddyfile`, `ai-gpu/bootstrap.sh`, `ai-gpu/.env.example` in the render bundle; CLI flag `--ai-host user@ip` that applies `<bundle>/ai-gpu` over ssh via the existing `applyOverSsh(dir, id, {host, identity})`.

- [ ] **Step 1: Failing test:**

```ts
it("renders a self-contained GPU-box bundle when ai.selfHosted", () => {
  const files = render(aiManifest);
  const c = files["ai-gpu/docker-compose.yml"];
  expect(c).toContain("vllm/vllm-openai");
  expect(c).toContain("--model utter-project/EuroLLM-9B-Instruct");
  expect(c).toContain("--quantization fp8");
  expect(c).toContain("text-embeddings-inference");
  expect(c).toContain("BAAI/bge-m3");
  expect(files["ai-gpu/Caddyfile"]).toMatch(/gpu\.example\.org[\s\S]*handle_path \/embed\/\*/);
  expect(files["ai-gpu/bootstrap.sh"]).toContain("nvidia-container-toolkit");
});
```

- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** `renderAiGpuBundle(m)` returning the three files + `.env.example`, added to the output map only when `m.ai?.selfHosted && m.ai.gpuHost`:

`ai-gpu/docker-compose.yml`:

```yaml
# Generated by `netizen render` — sovereign model server for node "${m.id}".
# This box is deliberately dumb and replaceable: models in, tokens out.
# The gateway, keys and policy live on the node box. Spec §4.2: rail-replaceable.
services:
  vllm:
    image: vllm/vllm-openai:latest   # pin the digest after first pull
    restart: unless-stopped
    ipc: host
    command: >
      --model ${m.ai.sovereignty.model}
      --quantization fp8
      --max-model-len 16384
      --gpu-memory-utilization 0.90
      --api-key \${VLLM_API_KEY}
    env_file: ["./.env"]
    volumes: ["hf_cache:/root/.cache/huggingface"]
    deploy:
      resources:
        reservations:
          devices: [{ driver: nvidia, count: all, capabilities: [gpu] }]
    expose: ["8000"]
  tei:
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-latest
    restart: unless-stopped
    command: ["--model-id", "BAAI/bge-m3"]
    volumes: ["tei_cache:/data"]
    expose: ["80"]
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy_data:/data"]
volumes: { hf_cache: {}, tei_cache: {}, caddy_data: {} }
```

`ai-gpu/Caddyfile`:

```
${m.ai.gpuHost} {
  handle_path /embed/* {
    reverse_proxy tei:80
  }
  reverse_proxy vllm:8000
}
```

`ai-gpu/bootstrap.sh` (mirror the main bootstrap's idempotent style): install Docker if missing, then `curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey`-based install of `nvidia-container-toolkit` + `nvidia-ctk runtime configure --runtime=docker && systemctl restart docker` (guarded by `command -v nvidia-ctk ||`), require `.env` to exist with `VLLM_API_KEY` (exit 1 with message if placeholder), then `docker compose up -d`.

`ai-gpu/.env.example`: `VLLM_API_KEY=replace-me`.

In `cli.ts` `up`: parse `--ai-host`; when present, after (or instead of, if `--host` omitted) the main apply: `applyOverSsh(join(dir, "ai-gpu"), m.id + "-ai", { host: aiHost, identity: flag("--identity") })`; update the usage strings to mention `[--ai-host user@ip]`.

- [ ] **Step 4: Verify PASS** + full render suite.
- [ ] **Step 5: Commit**: `git pull --rebase && git add packages/cli/src/render.ts packages/cli/src/cli.ts packages/cli/test/render.test.ts && git commit -m "feat(cli): the GPU box joins the installer — vLLM+TEI bundle rendered from the manifest, applied with --ai-host" && git push`

### Task A4: Doctor — the AI layer earns its green

**Files:**
- Modify: `packages/cli/src/doctor.ts` (AI scoring ~116–124, warnings ~157), `packages/cli/src/cli.ts` (doctor case: `--live` flag)
- Test: `packages/cli/test/doctor.test.ts`

**Interfaces:**
- Consumes: A1 fields. Produces: static rules (below) + `doctorLive(m): Promise<string[]>` returning failure strings, called only under `--live`.

- [ ] **Step 1: Failing tests:**

```ts
describe("doctor: sovereign AI", () => {
  it("refuses selfHosted without a gpuHost and pinned roles", () => {
    const r = doctor(manifestWith({ ai: { gateway: "litellm", selfHosted: true, models: { chat: "anthropic/claude-sonnet-5" } } }));
    expect(r.errors.join()).toMatch(/selfHosted.*gpuHost/);
    expect(r.errors.join()).toMatch(/pinnedRoles/);
  });
  it("keeps the egress warning when not self-hosted, drops it when it is", () => {
    expect(doctor(nonSelfHostedAiManifest).warnings.join()).toMatch(/egress off-node/);
    expect(doctor(fullAiManifest).warnings.join()).not.toMatch(/egress off-node/);
  });
});
```

- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement.** Static: when `ai.selfHosted === true`, push errors if `!ai.gpuHost` ("selfHosted requires gpuHost — a gateway with nothing local behind it is not sovereign") or `!ai.sovereignty?.pinnedRoles?.length`. Keep the sovereign note but extend it: `gateway on the node (${tier}); pinned local: ${pinnedRoles.join(", ")}`. Add `doctorLive(m)` (exported for tests, fetch injectable): GET `https://ai.<domain>/health/liveliness` expect 200; POST `https://ai.<domain>/v1/chat/completions` with `{model: pinnedChatRole, messages:[{role:"user",content:"Antworte mit OK"}], max_tokens: 4}` and `Authorization: Bearer $LITELLM_MASTER_KEY` expect 200 and `response.model` containing the served model name; POST `/v1/embeddings` with `{model:"embed", input:"probe"}` expect a 1024-length vector. Each failure is one plain-language string. Wire `--live` in `cli.ts`.
- [ ] **Step 4: Verify PASS** + full doctor suite.
- [ ] **Step 5: Commit**: `git pull --rebase && git add packages/cli/src/doctor.ts packages/cli/src/cli.ts packages/cli/test/doctor.test.ts && git commit -m "feat(cli): doctor stops taking selfHosted on faith — static shape rules plus --live gateway probes" && git push`

### Task A5: Flip the Röbel manifest (gated on Task 0 + A1–A4 + first deploy)

**Files:**
- Modify: `packages/protocol/examples/roebel.netizen.json` (the `ai` block)
- Modify: `packages/cli/test/doctor.test.ts` — the "egress warning present when not self-hosted" test currently uses the roebel example manifest as its non-selfHosted fixture; the flip breaks it. Swap that test to an inline non-selfHosted fixture in the same step as the manifest edit.

- [ ] **Step 1:** Update the block:

```json
"ai": {
  "gateway": "litellm",
  "selfHosted": true,
  "gatewayHost": "ai.roebel.app",
  "gpuHost": "gpu.roebel.app",
  "models": {
    "reason": "anthropic/claude-opus-4-8",
    "chat": "anthropic/claude-sonnet-5",
    "classify": "anthropic/claude-haiku-4-5",
    "image": "nano-banana-2-lite",
    "sovereign-chat": "pinned",
    "embed": "pinned"
  },
  "sovereignty": {
    "tier": "eu-gpu",
    "model": "utter-project/EuroLLM-9B-Instruct",
    "dataEgressPolicy": "citizen-linked-pinned-local",
    "pinnedRoles": ["sovereign-chat", "embed"]
  },
  "corpus": [
    { "id": "ratsprotokolle", "description": "Protokolle der Stadtvertretung Röbel/Müritz", "visibility": "public" },
    { "id": "satzungen", "description": "Satzungen und Ordnungen der Stadt", "visibility": "public" }
  ],
  "mcp": { "toolBus": "https://www.roebel.app/api/roebel/mcp" },
  "contextGraph": true
}
```

- [ ] **Step 2: Render + static doctor**: `pnpm --filter @netizen-labs/cli exec netizen render packages/protocol/examples/roebel.netizen.json && … netizen doctor …` — render clean, doctor: no AI errors, egress warning gone.
- [ ] **Step 3: Deploy (operator, with user's ssh key):** `netizen up <manifest> --host <node> --ai-host root@<gex44-ip>`; first vLLM start downloads ~18 GB of weights — wait, then `netizen doctor <manifest> --live` → all AI probes green. **If fp8 quantization fails on the Ada card** (vLLM error at startup): fall back by editing the rendered compose to `--quantization awq` IF a community AWQ of EuroLLM-9B-Instruct exists on HF; otherwise switch `sovereignty.model` to `google/gemma-3-12b-it` (documented sovereignty trade, spec §4.2) and re-render. Record whichever happened in the commit message.
- [ ] **Step 4: Generate the two virtual keys** (operator, on the node box):

```bash
curl -sX POST https://ai.roebel.app/key/generate -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" -d '{"key_alias":"vercel-web","models":["chat","reason","classify","sovereign-chat","embed"]}'
curl -sX POST https://ai.roebel.app/key/generate -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" -d '{"key_alias":"expo-client","models":["chat","sovereign-chat","embed"]}'
```

Store: first key → Vercel env `LITELLM_API_KEY`; second → EAS env `EXPO_PUBLIC_AI_GATEWAY_KEY`.

- [ ] **Step 5: Commit**: `git pull --rebase && git add packages/protocol/examples/roebel.netizen.json && git commit -m "feat(node): Röbel ai.selfHosted goes true — EuroLLM-9B pinned local, the egress warning retires for real" && git push`

---

## Phase B — repo R: corpus, RAG, and both Mecky surfaces

### Task B1: pgvector corpus schema (Supabase MCP)

**Files:**
- Create: `supabase/migrations/20260801_town_documents_rag.sql`

**Interfaces:**
- Produces: tables `town_documents`, `town_document_chunks`; RPC `match_town_documents(query_embedding float8[], match_count int) → (chunk_id uuid, document_title text, doc_date date, content text, similarity float)` — consumed by B2, B3, B4.

- [ ] **Step 1: Write the migration:**

```sql
create extension if not exists vector;

create table town_documents (
  id uuid primary key default gen_random_uuid(),
  corpus_id text not null,            -- matches ai.corpus[].id in the node manifest
  title text not null,
  source_file text not null,
  doc_date date,
  visibility text not null default 'public' check (visibility in ('internal','members','public')),
  content_md text not null,
  created_at timestamptz not null default now(),
  unique (corpus_id, source_file)
);

create table town_document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references town_documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1024) not null,    -- BAAI/bge-m3
  unique (document_id, chunk_index)
);

create index town_document_chunks_embedding_idx
  on town_document_chunks using hnsw (embedding vector_cosine_ops);

alter table town_documents enable row level security;
alter table town_document_chunks enable row level security;
create policy "public docs readable" on town_documents for select using (visibility = 'public');
create policy "public chunks readable" on town_document_chunks for select
  using (exists (select 1 from town_documents d where d.id = document_id and d.visibility = 'public'));

create or replace function match_town_documents(query_embedding float8[], match_count int default 5)
returns table (chunk_id uuid, document_title text, doc_date date, content text, similarity float)
language sql stable security definer set search_path = public as $$
  select c.id, d.title, d.doc_date, c.content,
         1 - (c.embedding <=> (query_embedding::vector(1024))) as similarity
  from town_document_chunks c
  join town_documents d on d.id = c.document_id
  where d.visibility = 'public'
  order by c.embedding <=> (query_embedding::vector(1024))
  limit match_count;
$$;
grant execute on function match_town_documents to anon, authenticated;
```

- [ ] **Step 2: Apply via the Supabase MCP** (`apply_migration` on project `wwbeqhkslxdxhktqzqti`).
- [ ] **Step 3: Verify:** MCP SQL `select proname from pg_proc where proname='match_town_documents';` returns one row; `select count(*) from town_documents;` returns 0.
- [ ] **Step 4: Commit**: `git pull --rebase && git add supabase/migrations/20260801_town_documents_rag.sql && git commit -m "feat(db): the town record becomes retrievable — pgvector corpus tables and cosine match RPC" && git push`

### Task B2: Ingest script

**Files:**
- Create: `apps/web/scripts/ingest-town-docs.mjs`

**Interfaces:**
- Consumes: B1 tables, the gateway's `embed` role. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LITELLM_BASE_URL` (`https://ai.roebel.app`), `LITELLM_API_KEY`.
- Produces: CLI `node apps/web/scripts/ingest-town-docs.mjs <dir> --corpus ratsprotokolle [--dry-run]` ingesting `.md`/`.txt` files (PDF→md conversion happens outside; filename convention `YYYY-MM-DD_titel.md` sets `doc_date`+`title`).

- [ ] **Step 1: Write it:**

```js
#!/usr/bin/env node
// Ingest town documents (.md/.txt) into the sovereign RAG corpus.
// Chunks ~1200 chars with 200 overlap on paragraph boundaries; embeds via the
// node gateway's pinned `embed` role, so document text never leaves EU infra.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, extname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const [dir, ...rest] = process.argv.slice(2);
const corpus = rest[rest.indexOf("--corpus") + 1];
const dryRun = rest.includes("--dry-run");
if (!dir || !corpus) { console.error("usage: ingest-town-docs.mjs <dir> --corpus <id> [--dry-run]"); process.exit(1); }
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LITELLM_BASE_URL, LITELLM_API_KEY } = process.env;
if (!dryRun && !(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && LITELLM_BASE_URL && LITELLM_API_KEY)) {
  console.error("missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LITELLM_BASE_URL, LITELLM_API_KEY"); process.exit(1);
}

function chunk(text, size = 1200, overlap = 200) {
  const paras = text.split(/\n\s*\n/); const out = []; let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size && cur) { out.push(cur.trim()); cur = cur.slice(-overlap) + "\n\n" + p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function embed(texts) {
  const r = await fetch(`${LITELLM_BASE_URL}/v1/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${LITELLM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "embed", input: texts }),
  });
  if (!r.ok) throw new Error(`embed failed: ${r.status} ${await r.text()}`);
  return (await r.json()).data.map((d) => d.embedding);
}

const files = readdirSync(dir).filter((f) => [".md", ".txt"].includes(extname(f)));
console.log(`${files.length} files in ${dir} → corpus "${corpus}"${dryRun ? " (dry run)" : ""}`);
const supabase = dryRun ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

for (const f of files) {
  const content = readFileSync(join(dir, f), "utf8");
  const m = basename(f, extname(f)).match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
  const doc_date = m?.[1] ?? null;
  const title = (m?.[2] ?? basename(f, extname(f))).replaceAll("-", " ");
  const chunks = chunk(content);
  console.log(`  ${f}: "${title}" (${doc_date ?? "no date"}) → ${chunks.length} chunks`);
  if (dryRun) continue;
  const { data: doc, error: e1 } = await supabase
    .from("town_documents")
    .upsert({ corpus_id: corpus, title, source_file: f, doc_date, visibility: "public", content_md: content }, { onConflict: "corpus_id,source_file" })
    .select().single();
  if (e1) throw e1;
  await supabase.from("town_document_chunks").delete().eq("document_id", doc.id);
  for (let i = 0; i < chunks.length; i += 16) {
    const batch = chunks.slice(i, i + 16);
    const embeddings = await embed(batch);
    const rows = batch.map((content, j) => ({ document_id: doc.id, chunk_index: i + j, content, embedding: embeddings[j] }));
    const { error: e2 } = await supabase.from("town_document_chunks").insert(rows);
    if (e2) throw e2;
  }
}
console.log("done.");
```

- [ ] **Step 2: Dry-run test:** create `/tmp/corpus-test/2026-01-15_test-protokoll.md` with three paragraphs; `node apps/web/scripts/ingest-town-docs.mjs /tmp/corpus-test --corpus ratsprotokolle --dry-run` → prints 1 file, ≥1 chunk, exits 0.
- [ ] **Step 3: Real run** (needs Task A5 gateway live + envs): ingest the operator-supplied document set; verify via Supabase MCP: `select count(*) from town_document_chunks;` > 0, and `select title from town_documents limit 3;` looks right.
- [ ] **Step 4: Commit**: `git pull --rebase && git add apps/web/scripts/ingest-town-docs.mjs && git commit -m "feat(web): town documents flow into the sovereign corpus — chunked, embedded on-node, upserted idempotently" && git push`

### Task B3: Web Mecky goes through the gateway, with RAG

**Files:**
- Create: `apps/web/src/lib/mecky/town-rag.ts`
- Modify: `apps/web/src/app/api/chat/mecky/route.ts`
- Modify: `apps/web/package.json` (add `@ai-sdk/openai-compatible`)

**Interfaces:**
- Consumes: B1 RPC, gateway env (`LITELLM_BASE_URL`, `LITELLM_API_KEY` on Vercel).
- Produces: `retrieveTownContext(question: string): Promise<{context: string; hits: number}>`.

- [ ] **Step 1:** `cd apps/web && pnpm add @ai-sdk/openai-compatible`
- [ ] **Step 2:** `town-rag.ts`:

```ts
// RAG over the sovereign town corpus. Embedding + retrieval both stay on
// node-controlled infrastructure (gateway "embed" role → TEI on the GPU box).
const GW = process.env.LITELLM_BASE_URL;
const KEY = process.env.LITELLM_API_KEY;

export async function retrieveTownContext(question: string): Promise<{ context: string; hits: number }> {
  if (!GW || !KEY) return { context: "", hits: 0 };
  const er = await fetch(`${GW}/v1/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "embed", input: question }),
  });
  if (!er.ok) return { context: "", hits: 0 };
  const embedding: number[] = (await er.json()).data[0].embedding;
  const sr = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/match_town_documents`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query_embedding: embedding, match_count: 5 }),
  });
  if (!sr.ok) return { context: "", hits: 0 };
  const rows: { document_title: string; doc_date: string | null; content: string; similarity: number }[] = await sr.json();
  const good = rows.filter((r) => r.similarity > 0.4);
  const context = good
    .map((r) => `[${r.document_title}${r.doc_date ? `, ${r.doc_date}` : ""}]\n${r.content}`)
    .join("\n\n---\n\n");
  return { context, hits: good.length };
}
```

- [ ] **Step 3:** In `route.ts`: build a gateway provider and select the model; keep the direct-Anthropic path as fallback when the gateway env is unset:

```ts
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { retrieveTownContext } from "@/lib/mecky/town-rag";

const gateway = process.env.LITELLM_BASE_URL
  ? createOpenAICompatible({
      name: "netizen-gateway",
      baseURL: `${process.env.LITELLM_BASE_URL}/v1`,
      apiKey: process.env.LITELLM_API_KEY,
    })
  : null;
```

and inside `POST`, after computing `systemPrompt`:

```ts
  const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user");
  const question = typeof lastUser?.content === "string" ? lastUser.content : "";
  const { context, hits } = question ? await retrieveTownContext(question) : { context: "", hits: 0 };
  const system = hits
    ? `${systemPrompt}\n\nAMTLICHE DOKUMENTE (zitiere die Quelle in eckigen Klammern, erfinde nichts über sie hinaus):\n${context}`
    : systemPrompt;
  // Town-document answers are served by the pinned local model; everything else
  // stays on the frontier "chat" role — the egress policy in action.
  const model = gateway ? gateway(hits ? "sovereign-chat" : "chat") : anthropic("claude-haiku-4-5-20251001");

  const result = streamText({ model, system, messages, maxOutputTokens: 1024 });
  return result.toUIMessageStreamResponse();
```

(Remove the now-unused old `model:` line; keep everything else in the file as is.)

- [ ] **Step 4: Verify locally:** `cd apps/web && pnpm dev`, then

```bash
curl -sN localhost:3000/api/chat/mecky -H 'Content-Type: application/json' \
  -d '{"mode":"citizen","messages":[{"role":"user","content":"Was steht im Testprotokoll vom Januar?"}]}' | head -20
```

Expected: streamed German answer citing `[test protokoll, 2026-01-15]`. Then a non-town question ("Empfiehl mir ein Restaurant") streams normally (frontier path). With `LITELLM_BASE_URL` unset, both still work (fallback path).
- [ ] **Step 5: Commit**: `git pull --rebase && git add apps/web/src/lib/mecky/town-rag.ts apps/web/src/app/api/chat/mecky/route.ts apps/web/package.json pnpm-lock.yaml && git commit -m "feat(web): Mecky reads the town record — sovereign RAG answers via the node gateway, frontier only where policy allows" && git push`
- [ ] **Step 6 (operator):** set `LITELLM_BASE_URL` + `LITELLM_API_KEY` in Vercel env and redeploy.

### Task B4: Expo Mecky drops the embedded Anthropic key

**Files:**
- Modify: `apps/expo/lib/services/anthropic-chat.ts` (lines ~35, ~44, ~298–306)
- Modify: `apps/expo/lib/tools/mecky-tools.ts` (add `search_town_documents` tool, following the file's existing tool-definition pattern)
- Modify: `apps/expo/.env.example`

**Interfaces:**
- Consumes: gateway `/v1/messages` (Anthropic-format passthrough), `/v1/embeddings`, B1 RPC via the existing supabase client import used by the other tools in `mecky-tools.ts`.

- [ ] **Step 1:** In `anthropic-chat.ts`: replace the hardcoded base URL and key:

```ts
private baseUrl = `${process.env.EXPO_PUBLIC_AI_GATEWAY_URL ?? "https://ai.roebel.app"}/v1/messages`;
```

default model `"claude-sonnet-4-6"` → `"chat"` (both occurrences, ~44 and ~306), and the key lookup (~298): `process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY` → `process.env.EXPO_PUBLIC_AI_GATEWAY_KEY` with the error message updated to name the new var. **The raw Anthropic key leaves the client bundle — that is the security win of this task; the gateway key is a scoped, revocable LiteLLM virtual key.**
- [ ] **Step 2:** In `mecky-tools.ts`, add (matching the file's existing input-schema/execute shape exactly — read one existing tool first):

```ts
// Sucht in den amtlichen Dokumenten der Stadt (Ratsprotokolle, Satzungen).
// Embedding läuft über das Node-Gateway (pinned local), Suche über Supabase RPC.
export const searchTownDocuments = {
  name: "search_town_documents",
  description:
    "Durchsucht amtliche Dokumente der Stadt Röbel (Ratsprotokolle, Satzungen, Haushalt). Nutze dieses Tool bei Fragen zu Beschlüssen, Regeln oder städtischen Entscheidungen.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Die Suchfrage auf Deutsch" } },
    required: ["query"],
  },
  execute: async (input: { query: string }) => {
    const gw = process.env.EXPO_PUBLIC_AI_GATEWAY_URL ?? "https://ai.roebel.app";
    const key = process.env.EXPO_PUBLIC_AI_GATEWAY_KEY ?? "";
    const er = await fetch(`${gw}/v1/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "embed", input: input.query }),
    });
    if (!er.ok) return "Dokumentensuche derzeit nicht verfügbar.";
    const embedding = (await er.json()).data[0].embedding;
    const { data, error } = await supabase.rpc("match_town_documents", {
      query_embedding: embedding,
      match_count: 5,
    });
    if (error || !data?.length) return "Keine passenden Dokumente gefunden.";
    return data
      .map((r: { document_title: string; doc_date: string | null; content: string }) =>
        `[${r.document_title}${r.doc_date ? `, ${r.doc_date}` : ""}]\n${r.content}`)
      .join("\n\n---\n\n");
  },
};
```

and register it wherever the file exports its tool list (the array/map the other 11 tools are in), importing `supabase` the same way the neighbouring tools do.
- [ ] **Step 3:** `.env.example`: remove `EXPO_PUBLIC_ANTHROPIC_API_KEY`, add `EXPO_PUBLIC_AI_GATEWAY_URL=https://ai.roebel.app` and `EXPO_PUBLIC_AI_GATEWAY_KEY=sk-...`.
- [ ] **Step 4: Verify by running** (not tsc — pre-existing error noise): `cd apps/expo && pnpm start`, open Mecky, ask "Was wurde zuletzt im Stadtrat beschlossen?" → tool fires, cited German answer streams; ask a restaurant question → normal frontier-routed answer.
- [ ] **Step 5: Commit** (user runs `eas update` himself): `git pull --rebase && git add apps/expo/lib/services/anthropic-chat.ts apps/expo/lib/tools/mecky-tools.ts apps/expo/.env.example && git commit -m "feat(expo): Mecky speaks through the node gateway — the embedded Anthropic key retires, town documents become a tool" && git push`

### Task B5: Eval, docs, and the honesty flip

**Files:**
- Create: `docs/SOVEREIGN_AI_OPERATIONS.md`
- Create: `scripts/town-corpus/eval-questions.md`
- Modify: `docs/STATE_OF_THE_NETIZEN_STACK.md` (AI/sovereignty section)

- [ ] **Step 1: Eval template** `scripts/town-corpus/eval-questions.md`: table with columns *Frage / erwartete Quelle / Antwort korrekt? (j/n) / Notiz* and 10 rows the **operator fills with real questions** after ingesting the real Ratsprotokolle (the plan cannot know their content). Header states the acceptance rule: **≥7/10 answers grounded and correct on `sovereign-chat`; below that, escalate: try `google/gemma-3-12b-it`, then GEX131 + EuroLLM-22B (spec §4.2 upgrade path)** — record the outcome in this file and commit it.
- [ ] **Step 2: Runbook** `docs/SOVEREIGN_AI_OPERATIONS.md` (~1 page): the two boxes and their roles; where each key lives (master key = node `.env` only; virtual keys per consumer, revoke via `POST /key/delete`); how to re-render/redeploy (`netizen render` + `up --host … --ai-host …`); how to re-ingest the corpus; `doctor --live` as the health check; the fp8→awq→model-swap fallback ladder; what to do when the GPU box dies (it is stateless: re-provision, re-run `up --ai-host`, weights re-download — the corpus and keys never lived there).
- [ ] **Step 3:** Update `docs/STATE_OF_THE_NETIZEN_STACK.md`: the AI layer is self-hosted as of the deploy date; Mecky routes through the gateway; corpus contents and visibility; the doctor caveat about `ai.selfHosted:false` is retired. (STATE docs change in the same change as the code — repo rule.)
- [ ] **Step 4: Commit**: `git pull --rebase && git add docs/SOVEREIGN_AI_OPERATIONS.md scripts/town-corpus/eval-questions.md docs/STATE_OF_THE_NETIZEN_STACK.md && git commit -m "docs: Sovereign Mecky is operated, evaluated, and honestly described — Proof 0 closes" && git push`
- [ ] **Step 5: Final acceptance check (the Proof 0 definition of done):** `netizen doctor <roebel manifest> --live` fully green; a Ratsprotokoll question in the live app answers with citation from `sovereign-chat`; the Anthropic key is absent from the expo bundle; eval sheet committed with ≥7/10 or a recorded escalation.
- [ ] **Step 6: Record the deliberate deferrals** in `docs/ROADMAP_AND_DEFERRED.md`: (a) the spec §5.2/§10 "doctor verifies `ai.corpus` declaration matches deployment" check — trigger: Phase B tables live + doctor gains a Supabase probe; (b) `ai.rail` schema block — trigger: Proof 1 (shared rail exists); (c) a declarable third-party embed endpoint (embed is currently shape-coupled to the ai-gpu bundle's `/embed/v1` convention) — trigger: Proof 1 rail-replaceability check. Also note in the spec §5.2 that the shipped visibility enum adds `public` (needed for Ratsprotokolle) to the spec's three classes.
