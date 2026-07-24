# Contributing to Roebel App

Thank you for your interest in contributing! This project is an open-source civic technology blueprint, and we welcome contributions from everyone.

## Git Workflow — Trunk-Based Development

We use **trunk-based development**: `main` is always deployable.

- **Small changes** (single file, bug fix, docs): commit directly to `main`
- **Larger work** (new feature, multi-app changes, risky refactors): create a short-lived branch → open a PR → let CI pass → merge
- **Branch naming**: `feat/description`, `fix/description`, `docs/description`, `chore/description`
- **Delete branches** after merge — no long-lived branches

### When to Use a PR

- Changes span multiple apps (`apps/web` + `apps/expo`)
- Touching blockchain contracts or shared packages
- Anything you'd want CI to validate before it hits `main`
- When you want a clear record of what changed and why

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/roebel.git`
3. Install dependencies: `pnpm install`
4. Create a feature branch: `git checkout -b feat/your-feature`
5. Make your changes
6. Push and open a Pull Request

## Testing against staging

You don't need your own backend to test. There's a **shared staging environment** —
open **[stage.roebel.app](https://stage.roebel.app)** for zero-setup clickthrough,
or run the app locally against the staging backend with just the staging Supabase URL +
anon key. See **[docs/FORKING_GUIDE.md](docs/FORKING_GUIDE.md)**. Staging shares the live
Gnosis contracts read-only, so everything except live on-chain governance writes is fully
testable.

## Development

```bash
pnpm dev:web    # Start Next.js web app
pnpm dev:expo   # Start Expo mobile app
pnpm lint       # Lint all packages
pnpm build      # Build all packages
```

## Dependency Changes

- Add and remove dependencies with pnpm from the workspace root, using
  `--filter <package>` when the dependency belongs to a specific app.
- Run `pnpm dedupe` after dependency changes.
- Commit the single root `pnpm-lock.yaml`; do not create lockfiles inside
  individual workspace apps.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(web): add proposal voting page
fix(expo): resolve camera permission crash
docs: update deployment guide
chore(deps): upgrade Expo SDK to 55
style(tokens): update navy-500 to match Figma
refactor(blockchain): extract MACI voting hook
```

Scope should be one of: `web`, `expo`, `blockchain`, `contracts`, `config`, `tokens`, `docs`

## Pull Request Checklist

- [ ] TypeScript strict mode passes
- [ ] ESLint passes (`pnpm lint`)
- [ ] Works on web (localhost:3000)
- [ ] Works on iOS simulator (if UI change)
- [ ] Works on Android emulator (if UI change)
- [ ] Matches Figma design (if UI change)
- [ ] No hardcoded API keys or secrets
- [ ] German strings used for user-facing text

## Code Style

- **TypeScript** everywhere (strict mode)
- **pnpm** as package manager (not npm/yarn)
- **Web styling**: Tailwind CSS utility classes
- **Mobile styling**: `StyleSheet.create()` + `useTheme()` hook (not NativeWind)
- Functional components only, explicit Props interfaces
- Import from shared packages using `@roebel/` aliases

## Reporting Issues

- Use GitHub Issues
- Include reproduction steps
- Label appropriately: `bug`, `feature`, `docs`, `good-first-issue`

## Code of Conduct

Be respectful, constructive, and inclusive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).

## CI/CD

Every push to `main` and every PR triggers automated checks:

- **Lint** — `pnpm lint` across all apps
- **Typecheck** — `pnpm typecheck` across all apps
- **Build** — `pnpm build` to verify nothing is broken

When changes to `apps/expo/` are merged to `main`, an OTA update is automatically published to the **preview** channel via EAS Update. Production updates (`pnpm update:production`) are done manually after testing.

Native builds (new SDK, new native modules) are triggered manually via GitHub Actions.

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for version management. When making a notable change:

1. Run `pnpm changeset` and follow the prompts
2. Commit the generated changeset file with your PR
3. When merged, a "Version Packages" PR is auto-created with version bumps and changelog updates

## License

By contributing, you agree that your contributions will be licensed under AGPL-3.0.
