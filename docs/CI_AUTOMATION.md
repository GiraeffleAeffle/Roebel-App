# Repo automation agents

AI/automation agents wired into CI. All run on **stable GitHub Actions** (no
preview tooling). Each is model-agnostic: bump the `model:` / `claude-model:`
line to upgrade to a newer model later.

## Agents

| Workflow | Trigger | What it does |
|---|---|---|
| [`security-review.yml`](../.github/workflows/security-review.yml) | Every same-repo PR + weekly (Mon 06:00 UTC) | Diff-aware security review on PRs ([claude-code-security-review](https://github.com/anthropics/claude-code-security-review)); weekly full-repo sweep opens a `security-audit` issue on findings. |
| [`supabase-advisors.yml`](../.github/workflows/supabase-advisors.yml) | Weekly (Mon 07:00 UTC) | Pulls Supabase security + performance advisor lints (RLS gaps, `search_path`, exposed extensions) via the Management API; opens/updates a `supabase-advisor` issue. |
| [`release-notes.yml`](../.github/workflows/release-notes.yml) | GitHub release published | Rewrites the release body into resident-friendly **German + English** notes (complements Changesets changelogs). |
| [`pr-triage.yml`](../.github/workflows/pr-triage.yml) | PR opened/updated | Path labels (web/expo/contracts/supabase/...) + an AI summary & risk checklist comment. |
| [`dependabot.yml`](../.github/dependabot.yml) | Weekly | Grouped dependency update PRs (pnpm workspace + contracts) and Actions bumps. |

## Required secrets

Add under **Settings → Secrets and variables → Actions**:

| Secret | Used by | Where to get it |
|---|---|---|
| `CLAUDE_API_KEY` | security PR review | [console.anthropic.com](https://console.anthropic.com) |
| `ANTHROPIC_API_KEY` | weekly audit, release notes, PR summary | same key as above |
| `SUPABASE_ACCESS_TOKEN` | Supabase advisors | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |

Optional variable: `SUPABASE_PROJECT_REF` (defaults to the project ref baked
into the workflow).

## Manual hardening (one-time, GitHub UI)

- **Dependabot security updates → assign to AI agent**: Settings → Code
  security → Dependabot, enable agent remediation.
- **Secret scanning + push protection**: Settings → Code security → enable both
  (the build pipes Stripe / Supabase service-role / Irys keys).

## Security note — prompt injection

Fork PRs never receive secrets, so the security PR review and the AI summary are
guarded to **same-repo PRs only**. The path-labeler is fork-safe (it executes no
PR code). Review external contributions manually before re-running agents on
them via `workflow_dispatch`.
