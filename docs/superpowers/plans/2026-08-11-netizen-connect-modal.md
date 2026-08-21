# Netizen Connect Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Netizen-branded Connect surface for Ortis dashboard sign-in — a button that opens a method picker when signed out and an account menu when signed in, shipped as a reusable package.

**Architecture:** A new `@netizen-labs/connect-react` package holds the button, the responsive modal (bottom sheet on mobile, centered modal on desktop), a method registry and a token-driven theme. It is a *launcher*: it picks a method and starts the existing OIDC flow with a hint; the keystone still authenticates. Every visual value is a theme token so a future visual editor is additive rather than a rewrite.

**Tech Stack:** React 19.2.4, Next 16.2.7, TypeScript 5, vitest 4 + jsdom + @testing-library/react, Tailwind v4 (Ortis only — the package itself ships plain CSS custom properties).

**Spec:** [`docs/superpowers/specs/2026-08-11-netizen-connect-modal-design.md`](../specs/2026-08-11-netizen-connect-modal-design.md) (in the DAO_test repo).

## Global Constraints

- **Two repos.** Tasks 1–5 are in **netizen_labs** (`~/Documents/privat/side_projects/netizen/netizen_labs`, main at `7828068` or later). Task 6 is in **DAO_test** (`~/Documents/privat/side_projects/DAO_test`). Each task states its repo.
- **Pathspec-only commits.** Never `git add -A` or `git add .`. Multiple sessions commit to these repos concurrently. Run `git log --oneline -3` and `git status` in the target repo before every task.
- **Do not touch another session's territory:** `apps/ortis/app/(operator)/**`, `apps/ortis/components/operator/**`, `packages/ortis-operator/**`, `packages/router/**`, `packages/agent-watcher/**`. Never delete the `netizen_labs-autar-router` or `netizen_labs-ortis-operator` worktrees or their branches.
- **The `Session` shape must not change.** `{ memberId, orgId, displayName, email, roles }`. Another session's `components/operator/currentOperator.ts` reads `readSession()` and must keep compiling untouched.
- **All new files and routes in English.** German only for text a person reads. Do NOT rename existing German routes (`/rechnungen`, `/einladung`, `/unterschreiben`).
- **No hardcoded colour values in the package.** Every colour comes from a theme token. This is enforced by a test in Task 1.
- **No vendor branding and no vendor SDK** in the package. thirdweb stays an implementation detail inside the keystone.
- **Never validate an enum by `indexOf`.** `indexOf` returns `-1` for unknown values, and `-1` compares as valid in range checks — a fail-open default wearing a fail-closed shape. Use explicit `Map`/`Set` membership. (A sibling package shipped this exact bug: an unrecognised classification routed sensitive data to the cheapest endpoint.)
- **Do not deploy.** Done means committed. Do not push unless the controller says so.

---

## File Structure

**netizen_labs — `packages/connect-react/` (new)**

| File | Responsibility | Task |
|---|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts` | Package scaffold, following `packages/ui` + `apps/web` conventions | 1 |
| `src/theme.ts` | `ConnectTheme` type, `DEFAULT_THEME`, `themeToCssVars()` | 1 |
| `src/branding.ts` | `loadTheme(url, fetchImpl?)` — fetch a theme, fall back to the default | 1 |
| `src/methods.ts` | `ConnectMethod`, the registry, and tenant→keystone hint mapping | 2 |
| `src/ConnectModal.tsx` | Responsive shell: sheet <640px, modal ≥640px; focus trap, Esc, backdrop | 3 |
| `src/ConnectButton.tsx` | Signed-out trigger + signed-in account menu | 4 |
| `src/index.ts` | Public surface | 1, grown per task |
| `styles.css` | Token-driven CSS, imported by consumers | 3 |

**netizen_labs — existing files**

| File | Change | Task |
|---|---|---|
| `packages/ortis-core/src/domain.ts` | Widen `loginMethods` union with three `social-*` values | 2 |
| `apps/ortis/package.json`, `next.config.ts` | Add the dep + `transpilePackages` entry | 5 |
| `apps/ortis/app/login/page.tsx` | Host the modal | 5 |
| `apps/ortis/app/api/auth/login/route.ts` | Accept and validate `method` | 5 |

**DAO_test — `apps/roebel-id/`**

| File | Change | Task |
|---|---|---|
| `src/oidc/provider.ts` | Declare `netizen_method` in `extraParams` | 6 |
| `src/interaction/router.ts` | Read the param, pass to the login page | 6 |
| `src/interaction/login-page.ts` | Pre-select the named method | 6 |

---

### Task 1: Package scaffold and the theme contract

**Repo:** netizen_labs

**Files:**
- Create: `packages/connect-react/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/theme.ts`, `src/index.ts`, `test/theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ConnectTheme { version: 1; tokens: ConnectTokens; logo?: string; copy: { title: string; subtitle?: string }; layout: 'sheet' | 'modal' | 'auto' }`
  - `interface ConnectTokens { surface, onSurface, accent, onAccent, muted, line, radius, font: string }`
  - `const DEFAULT_THEME: ConnectTheme`
  - `function themeToCssVars(theme: ConnectTheme): Record<string, string>` — returns `{ '--nc-surface': ..., '--nc-on-surface': ..., ... }`

- [ ] **Step 1: Create the package scaffold**

`packages/connect-react/package.json` — mirrors `packages/ui` (source exports, no build step; Next transpiles it) plus a test runner:

```json
{
  "name": "@netizen-labs/connect-react",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./styles.css"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^29.1.1",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "typescript": "^5",
    "vitest": "^4.1.8"
  }
}
```

Versions match `apps/web/package.json` deliberately — a different range here would install a second copy of the same library into the workspace.

`packages/connect-react/tsconfig.json` — copy `packages/ui/tsconfig.json` verbatim, then set `"jsx": "react-jsx"` in `compilerOptions` if it is not already there.

`packages/connect-react/vitest.setup.ts` — later tasks assert with `toBeInTheDocument()` and `toHaveAttribute()`, which are jest-dom matchers and do not exist in vitest core. Without this file those tests fail with "not a function", which looks like a component bug and is not one:

```ts
import "@testing-library/jest-dom/vitest";
```

`packages/connect-react/vitest.config.ts` — the jsdom pattern already used by `apps/web`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
});
```

- [ ] **Step 2: Write the failing test**

Create `packages/connect-react/test/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_THEME, themeToCssVars } from "../src/theme";

describe("themeToCssVars", () => {
  it("maps every token to a --nc- custom property", () => {
    const vars = themeToCssVars(DEFAULT_THEME);
    expect(vars["--nc-surface"]).toBe(DEFAULT_THEME.tokens.surface);
    expect(vars["--nc-on-surface"]).toBe(DEFAULT_THEME.tokens.onSurface);
    expect(vars["--nc-accent"]).toBe(DEFAULT_THEME.tokens.accent);
    expect(vars["--nc-on-accent"]).toBe(DEFAULT_THEME.tokens.onAccent);
    expect(vars["--nc-radius"]).toBe(DEFAULT_THEME.tokens.radius);
  });

  it("emits one variable per token and nothing else", () => {
    const vars = themeToCssVars(DEFAULT_THEME);
    expect(Object.keys(vars)).toHaveLength(Object.keys(DEFAULT_THEME.tokens).length);
  });
});

describe("no hardcoded colours", () => {
  // A visual editor is a stated future product. It is only cheap if EVERY visual value is a
  // token the component reads. This test is the guard: a hex literal or rgb()/hsl() call
  // anywhere outside theme.ts means the editor cannot change it, and nobody would notice
  // until the editor was built.
  it("has no colour literals outside theme.ts", () => {
    const src = join(__dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of readdirSync(src)) {
      if (file === "theme.ts") continue;
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = readFileSync(join(src, file), "utf8");
      if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/netizen/netizen_labs && pnpm --filter @netizen-labs/connect-react test`
Expected: FAIL — `../src/theme` does not exist.

- [ ] **Step 4: Write the implementation**

Create `packages/connect-react/src/theme.ts`:

```ts
/**
 * The Connect surface's entire visual contract.
 *
 * Every colour, radius and font the modal renders comes from here and is applied as a CSS
 * custom property. Nothing visual is hardcoded in a component. That rule exists so a future
 * visual editor is purely additive: it writes this same JSON and the component changes not
 * at all. Retrofitting an editor onto baked-in styling is a rewrite.
 *
 * Tokens are SEMANTIC and paired (surface/onSurface, accent/onAccent) rather than
 * per-element. Arbitrary per-element colours reliably produce unreadable modals; pairing each
 * surface with its own foreground keeps "brand it however you like" true while making an
 * unreadable result hard to express, and gives an editor a contrast rule to validate.
 */
export interface ConnectTokens {
  /** Modal background. */
  surface: string;
  /** Text and icons on `surface`. */
  onSurface: string;
  /** Primary action background. */
  accent: string;
  /** Text on `accent`. */
  onAccent: string;
  /** Secondary text. */
  muted: string;
  /** Borders and dividers. */
  line: string;
  /** Corner radius, as a CSS length (e.g. "8px"). */
  radius: string;
  /** Font stack. */
  font: string;
}

export interface ConnectTheme {
  /** Present so a later editor migrates stored themes rather than guessing. */
  version: 1;
  tokens: ConnectTokens;
  /** URL or data URI. */
  logo?: string;
  /** German — this is text a person reads. */
  copy: { title: string; subtitle?: string };
  layout: "sheet" | "modal" | "auto";
}

/** Ortis' default look: the neutral black-and-white product surface. */
export const DEFAULT_THEME: ConnectTheme = {
  version: 1,
  tokens: {
    surface: "#ffffff",
    onSurface: "#111111",
    accent: "#111111",
    onAccent: "#ffffff",
    muted: "#6b7280",
    line: "#e5e7eb",
    radius: "8px",
    font: "Inter, system-ui, sans-serif",
  },
  copy: { title: "Anmelden", subtitle: "Wählen Sie, wie Sie sich anmelden möchten." },
  layout: "auto",
};

/** camelCase token name -> `--nc-kebab-case` custom property. */
export function themeToCssVars(theme: ConnectTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.tokens)) {
    const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    vars[`--nc-${kebab}`] = value;
  }
  return vars;
}
```

Create `packages/connect-react/src/index.ts`:

```ts
export { DEFAULT_THEME, themeToCssVars } from "./theme.js";
export type { ConnectTheme, ConnectTokens } from "./theme.js";
```

- [ ] **Step 5: Add the branding loader**

The theme has to be able to come from somewhere other than the default, or the seam is notional. Add the test to `test/theme.test.ts`:

```ts
import { loadTheme } from "../src/branding";

describe("loadTheme", () => {
  it("returns the fetched theme when the document is well formed", async () => {
    const served = { ...DEFAULT_THEME, copy: { title: "Anmelden bei Ortis" } };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(served), { status: 200 })) as typeof fetch;
    const theme = await loadTheme("https://id.example/.well-known/netizen-branding", fetchImpl);
    expect(theme.copy.title).toBe("Anmelden bei Ortis");
  });

  it("falls back to the default when the fetch fails", async () => {
    // A branding endpoint being down must never leave a person staring at an unstyled
    // modal — the look degrades, the login does not.
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect(await loadTheme("https://id.example/x", fetchImpl)).toBe(DEFAULT_THEME);
  });

  it("falls back on a non-2xx response", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    expect(await loadTheme("https://id.example/x", fetchImpl)).toBe(DEFAULT_THEME);
  });

  it("falls back when the body is not a theme", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ hello: "world" }), { status: 200 })) as typeof fetch;
    expect(await loadTheme("https://id.example/x", fetchImpl)).toBe(DEFAULT_THEME);
  });
});
```

Create `packages/connect-react/src/branding.ts`:

```ts
import { DEFAULT_THEME, type ConnectTheme } from "./theme.js";

/** Structural check: anything that fails it is treated as absent rather than trusted. The
 *  document is served by a host we do not control from this package's point of view, and a
 *  half-valid theme renders worse than the default. */
function isTheme(value: unknown): value is ConnectTheme {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Partial<ConnectTheme>;
  return t.version === 1 && typeof t.tokens === "object" && t.tokens !== null && typeof t.copy?.title === "string";
}

/**
 * Fetch a theme document, falling back to `DEFAULT_THEME` on any failure — network error,
 * non-2xx, unparseable body, or a body that is not a theme.
 *
 * Never throws. A branding endpoint being unavailable must degrade the look and never block
 * a login; the modal is the only way in.
 */
export async function loadTheme(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectTheme> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return DEFAULT_THEME;
    const body: unknown = await res.json();
    return isTheme(body) ? body : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
```

Append to `src/index.ts`:

```ts
export { loadTheme } from "./branding.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/connect-react test`
Expected: PASS (8 tests).

- [ ] **Step 7: Install and typecheck**

Run:
```bash
cd ~/Documents/privat/side_projects/netizen/netizen_labs
pnpm install
pnpm --filter @netizen-labs/connect-react typecheck
```
Expected: install succeeds and adds the new workspace package; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/connect-react/package.json packages/connect-react/tsconfig.json packages/connect-react/vitest.config.ts packages/connect-react/vitest.setup.ts packages/connect-react/src/theme.ts packages/connect-react/src/branding.ts packages/connect-react/src/index.ts packages/connect-react/test/theme.test.ts pnpm-lock.yaml
git commit -m "feat(connect): package scaffold, theme contract, and branding loader"
```

---

### Task 2: Method registry and the tenant↔keystone mapping

**Repo:** netizen_labs

**Files:**
- Create: `packages/connect-react/src/methods.ts`, `packages/connect-react/test/methods.test.ts`
- Modify: `packages/ortis-core/src/domain.ts:45`
- Modify: `packages/connect-react/src/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `type MethodKind = 'redirect' | 'qr' | 'inline'`
  - `interface ConnectMethod { id: string; label: string; kind: MethodKind; hint?: string }`
  - `const METHODS: ReadonlyMap<string, ConnectMethod>`
  - `function resolveMethods(ids: readonly string[]): ConnectMethod[]` — unknown ids dropped
  - `function hintFor(id: string): string | undefined`

**Why this task is delicate:** Ortis and the keystone name login methods with two DIFFERENT closed vocabularies. Ortis stores `"email-otp" | "qr-app-connect"`; the keystone's strategies are `email`, `google`, `apple`, `facebook`, `phone`. A silent mis-mapping sends a person to the wrong provider, so the mapping is a table test.

- [ ] **Step 1: Write the failing test**

Create `packages/connect-react/test/methods.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { METHODS, resolveMethods, hintFor } from "../src/methods";

describe("the tenant -> keystone mapping", () => {
  // Two different closed vocabularies. Getting a row wrong sends a user to the wrong
  // provider, and nothing else in the system would catch it.
  it.each([
    ["email-otp", "redirect", "email"],
    ["qr-app-connect", "qr", undefined],
    ["social-google", "redirect", "google"],
    ["social-apple", "redirect", "apple"],
    ["social-facebook", "redirect", "facebook"],
  ])("%s is %s with hint %s", (id, kind, hint) => {
    const m = METHODS.get(id);
    expect(m).toBeDefined();
    expect(m!.kind).toBe(kind);
    expect(m!.hint).toBe(hint);
  });

  it("gives the QR method no hint — it never redirects", () => {
    expect(hintFor("qr-app-connect")).toBeUndefined();
  });
});

describe("resolveMethods", () => {
  it("keeps configured order", () => {
    expect(resolveMethods(["social-google", "email-otp"]).map((m) => m.id)).toEqual([
      "social-google",
      "email-otp",
    ]);
  });

  it("drops unknown ids instead of rendering a dead button", () => {
    expect(resolveMethods(["email-otp", "carrier-pigeon"]).map((m) => m.id)).toEqual([
      "email-otp",
    ]);
  });

  it("returns empty for an empty config rather than inventing a default", () => {
    expect(resolveMethods([])).toEqual([]);
  });
});

describe("hintFor", () => {
  it("is undefined for an unknown id — never a sentinel", () => {
    // Membership check, never indexOf: indexOf returns -1 for unknown values and -1 passes
    // range comparisons, which is a fail-open default wearing a fail-closed shape.
    expect(hintFor("carrier-pigeon")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/connect-react test`
Expected: FAIL — `../src/methods` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/connect-react/src/methods.ts`:

```ts
/**
 * The method registry, and the one place Ortis' vocabulary meets the keystone's.
 *
 * Ortis stores login methods as `email-otp` / `qr-app-connect` / `social-*`
 * (`OrgSettings.identity.loginMethods`). The keystone's login page speaks thirdweb
 * strategies: `email`, `google`, `apple`, `facebook`, `phone`. These are two different closed
 * vocabularies and this table is the only translation between them.
 */
export type MethodKind = "redirect" | "qr" | "inline";

export interface ConnectMethod {
  /** The tenant-config id, as stored in `OrgSettings.identity.loginMethods`. */
  id: string;
  /** German — a person reads this. */
  label: string;
  kind: MethodKind;
  /** The keystone's own name for this method, sent as the authorize hint.
   *  Absent for methods that never redirect. */
  hint?: string;
}

const ENTRIES: readonly ConnectMethod[] = [
  { id: "email-otp", label: "Mit E-Mail anmelden", kind: "redirect", hint: "email" },
  { id: "social-google", label: "Mit Google anmelden", kind: "redirect", hint: "google" },
  { id: "social-apple", label: "Mit Apple anmelden", kind: "redirect", hint: "apple" },
  { id: "social-facebook", label: "Mit Facebook anmelden", kind: "redirect", hint: "facebook" },
  // Handled inside the modal; there is no keystone page for it, so no hint.
  { id: "qr-app-connect", label: "Mit Ihrer Community-App anmelden", kind: "qr" },
];

export const METHODS: ReadonlyMap<string, ConnectMethod> = new Map(
  ENTRIES.map((m) => [m.id, m]),
);

/**
 * Configured ids -> renderable methods, preserving the tenant's order.
 *
 * Unknown ids are DROPPED rather than rendered: a button that cannot start a login is worse
 * than an absent one. Map membership, never `indexOf` — `indexOf` returns -1 for unknown
 * values and -1 survives range checks, which is how a fail-open default disguises itself.
 */
export function resolveMethods(ids: readonly string[]): ConnectMethod[] {
  const out: ConnectMethod[] = [];
  for (const id of ids) {
    const m = METHODS.get(id);
    if (m) out.push(m);
  }
  return out;
}

/** The keystone hint for a tenant method id, or undefined when there is none. */
export function hintFor(id: string): string | undefined {
  return METHODS.get(id)?.hint;
}
```

Append to `packages/connect-react/src/index.ts`:

```ts
export { METHODS, resolveMethods, hintFor } from "./methods.js";
export type { ConnectMethod, MethodKind } from "./methods.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netizen-labs/connect-react test`
Expected: PASS.

- [ ] **Step 5: Widen the Ortis tenant union**

In `packages/ortis-core/src/domain.ts`, line 45 currently reads:

```ts
    loginMethods?: Array<"email-otp" | "qr-app-connect">;
```

Replace it with:

```ts
    /** Which sign-in methods this tenant offers. Rendered by the Connect modal in the order
     *  given. The `social-*` values map to keystone strategies — see
     *  `@netizen-labs/connect-react`'s method registry, which is the only translation
     *  between this vocabulary and the keystone's. */
    loginMethods?: Array<
      | "email-otp"
      | "qr-app-connect"
      | "social-google"
      | "social-apple"
      | "social-facebook"
    >;
```

This is additive: every stored settings value remains valid, and the seeded pilot tenant keeps `["email-otp", "qr-app-connect"]` unchanged.

- [ ] **Step 6: Verify nothing downstream broke**

Run:
```bash
pnpm --filter @netizen-labs/ortis-core typecheck
pnpm --filter @netizen-labs/connect-react test
```
Expected: both clean. `ortis-core`'s test suite needs Postgres; if it is unavailable, the typecheck is the gate — say so in your report rather than claiming the suite passed.

- [ ] **Step 7: Commit**

```bash
git add packages/connect-react/src/methods.ts packages/connect-react/src/index.ts packages/connect-react/test/methods.test.ts packages/ortis-core/src/domain.ts
git commit -m "feat(connect): method registry and the tenant-to-keystone mapping"
```

---

### Task 3: The responsive modal shell

**Repo:** netizen_labs

**Files:**
- Create: `packages/connect-react/src/ConnectModal.tsx`, `packages/connect-react/styles.css`, `packages/connect-react/test/ConnectModal.test.tsx`
- Modify: `packages/connect-react/src/index.ts`

**Interfaces:**
- Consumes: `ConnectTheme`, `themeToCssVars`, `DEFAULT_THEME` (Task 1); `ConnectMethod` (Task 2).
- Produces:
  ```ts
  interface ConnectModalProps {
    open: boolean;
    onClose: () => void;
    methods: ConnectMethod[];
    onSelect: (method: ConnectMethod) => void;
    theme?: ConnectTheme;
    contextLine?: string;
  }
  function ConnectModal(props: ConnectModalProps): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/connect-react/test/ConnectModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectModal } from "../src/ConnectModal";
import { resolveMethods } from "../src/methods";

const methods = resolveMethods(["email-otp", "social-google"]);

describe("ConnectModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConnectModal open={false} onClose={() => {}} methods={methods} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders exactly the configured methods, in order", () => {
    render(<ConnectModal open onClose={() => {}} methods={methods} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button", { name: /anmelden/i });
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Mit E-Mail anmelden",
      "Mit Google anmelden",
    ]);
  });

  it("shows a single method without inventing others", () => {
    render(
      <ConnectModal open onClose={() => {}} methods={resolveMethods(["email-otp"])} onSelect={() => {}} />,
    );
    expect(screen.getAllByRole("button", { name: /anmelden/i })).toHaveLength(1);
  });

  it("passes the chosen method back", () => {
    const onSelect = vi.fn();
    render(<ConnectModal open onClose={() => {}} methods={methods} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Mit Google anmelden" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "social-google" }));
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ConnectModal open onClose={onClose} methods={methods} onSelect={() => {}} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click but not on a click inside the panel", () => {
    const onClose = vi.fn();
    render(<ConnectModal open onClose={onClose} methods={methods} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("nc-panel"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("nc-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is a labelled dialog", () => {
    render(<ConnectModal open onClose={() => {}} methods={methods} onSelect={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });

  it("applies theme tokens as custom properties", () => {
    render(<ConnectModal open onClose={() => {}} methods={methods} onSelect={() => {}} />);
    expect(screen.getByTestId("nc-panel").style.getPropertyValue("--nc-surface")).toBe("#ffffff");
  });

  it("shows the context line only when given", () => {
    const { rerender } = render(
      <ConnectModal open onClose={() => {}} methods={methods} onSelect={() => {}} />,
    );
    expect(screen.queryByTestId("nc-context")).toBeNull();
    rerender(
      <ConnectModal open onClose={() => {}} methods={methods} onSelect={() => {}} contextLine="Amt Röbel-Müritz" />,
    );
    expect(screen.getByTestId("nc-context")).toHaveTextContent("Amt Röbel-Müritz");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/connect-react test`
Expected: FAIL — `../src/ConnectModal` does not exist.

- [ ] **Step 3: Write the stylesheet**

Create `packages/connect-react/styles.css`. **Responsiveness is a CSS media query, not JavaScript** — a JS breakpoint would render the wrong variant on the server and flicker on hydration:

```css
/* Netizen Connect. Every value here reads a --nc-* custom property set from the theme;
   nothing visual is decided in this file. Bottom sheet on narrow screens, centred modal
   at 640px and up — a media query, so server and client agree on first paint. */

.nc-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 40%);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;
}

.nc-panel {
  background: var(--nc-surface);
  color: var(--nc-on-surface);
  font-family: var(--nc-font);
  border-top-left-radius: var(--nc-radius);
  border-top-right-radius: var(--nc-radius);
  width: 100%;
  max-width: 32rem;
  padding: 1.5rem;
  max-height: 90vh;
  overflow-y: auto;
}

.nc-title { font-size: 1.25rem; font-weight: 600; margin: 0; }
.nc-subtitle, .nc-context { color: var(--nc-muted); font-size: 0.875rem; margin: 0.25rem 0 0; }
.nc-methods { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1.5rem; }

.nc-method {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.875rem 1rem;
  border: 1px solid var(--nc-line);
  border-radius: var(--nc-radius);
  background: var(--nc-surface);
  color: var(--nc-on-surface);
  font: inherit;
  cursor: pointer;
  /* 44px minimum touch target — this is a sheet on phones. */
  min-height: 2.75rem;
}
.nc-method:hover { border-color: var(--nc-on-surface); }
.nc-method--primary { background: var(--nc-accent); color: var(--nc-on-accent); border-color: var(--nc-accent); }

@media (min-width: 640px) {
  .nc-backdrop { align-items: center; }
  .nc-panel { border-radius: var(--nc-radius); }
}
```

- [ ] **Step 4: Write the component**

Create `packages/connect-react/src/ConnectModal.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef } from "react";
import { DEFAULT_THEME, themeToCssVars, type ConnectTheme } from "./theme.js";
import type { ConnectMethod } from "./methods.js";

export interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
  /** Already resolved from tenant config — the modal renders exactly these, in order. */
  methods: ConnectMethod[];
  onSelect: (method: ConnectMethod) => void;
  theme?: ConnectTheme;
  /** Optional line under the title, e.g. the Amt's name. */
  contextLine?: string;
}

export function ConnectModal({
  open,
  onClose,
  methods,
  onSelect,
  theme = DEFAULT_THEME,
  contextLine,
}: ConnectModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes from anywhere, including before focus has entered the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock background scroll while open, and restore exactly what was there before —
  // assigning "" would clobber a page that had set its own overflow.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the panel so a keyboard user is inside the dialog, not behind it.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="nc-backdrop"
      data-testid="nc-backdrop"
      onClick={onClose}
      style={themeToCssVars(theme) as React.CSSProperties}
    >
      <div
        ref={panelRef}
        className="nc-panel"
        data-testid="nc-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // A click inside the panel must not reach the backdrop's close handler.
        onClick={(e) => e.stopPropagation()}
        style={themeToCssVars(theme) as React.CSSProperties}
      >
        <h2 className="nc-title" id={titleId}>
          {theme.copy.title}
        </h2>
        {theme.copy.subtitle && <p className="nc-subtitle">{theme.copy.subtitle}</p>}
        {contextLine && (
          <p className="nc-context" data-testid="nc-context">
            {contextLine}
          </p>
        )}

        <div className="nc-methods">
          {methods.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={i === 0 ? "nc-method nc-method--primary" : "nc-method"}
              onClick={() => onSelect(m)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Append to `src/index.ts`:

```ts
export { ConnectModal } from "./ConnectModal.js";
export type { ConnectModalProps } from "./ConnectModal.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/connect-react test && pnpm --filter @netizen-labs/connect-react typecheck`
Expected: PASS, typecheck clean. The no-hardcoded-colour test from Task 1 must still pass — `ConnectModal.tsx` contains no colour literals (the one `rgb()` lives in `styles.css`, which that test does not scan, and is a backdrop scrim rather than a brandable surface).

- [ ] **Step 6: Commit**

```bash
git add packages/connect-react/src/ConnectModal.tsx packages/connect-react/styles.css packages/connect-react/src/index.ts packages/connect-react/test/ConnectModal.test.tsx
git commit -m "feat(connect): responsive modal shell — sheet on mobile, modal on desktop"
```

---

### Task 4: ConnectButton and the account menu

**Repo:** netizen_labs

**Files:**
- Create: `packages/connect-react/src/ConnectButton.tsx`, `packages/connect-react/test/ConnectButton.test.tsx`
- Modify: `packages/connect-react/src/index.ts`, `packages/connect-react/styles.css`

**Interfaces:**
- Consumes: `ConnectModal` (Task 3), `ConnectMethod` (Task 2), `ConnectTheme` (Task 1).
- Produces:
  ```ts
  interface ConnectAccount { displayName: string; orgName?: string; roles?: string[] }
  interface ConnectButtonProps {
    account: ConnectAccount | null;   // null = signed out
    methods: ConnectMethod[];
    onSelect: (method: ConnectMethod) => void;
    onSignOut: () => void;
    theme?: ConnectTheme;
    contextLine?: string;
  }
  function ConnectButton(props: ConnectButtonProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/connect-react/test/ConnectButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectButton } from "../src/ConnectButton";
import { resolveMethods } from "../src/methods";

const methods = resolveMethods(["email-otp"]);
const noop = () => {};

describe("signed out", () => {
  it("shows the sign-in trigger and opens the modal", () => {
    render(<ConnectButton account={null} methods={methods} onSelect={noop} onSignOut={noop} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("passes the chosen method up and closes", () => {
    const onSelect = vi.fn();
    render(<ConnectButton account={null} methods={methods} onSelect={onSelect} onSignOut={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    fireEvent.click(screen.getByRole("button", { name: "Mit E-Mail anmelden" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "email-otp" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("signed in", () => {
  const account = { displayName: "M. Brych", orgName: "Amt Röbel-Müritz", roles: ["Bürgermeister"] };

  it("shows the person, not a sign-in trigger", () => {
    render(<ConnectButton account={account} methods={methods} onSelect={noop} onSignOut={noop} />);
    expect(screen.getByRole("button", { name: /M\. Brych/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anmelden" })).toBeNull();
  });

  it("opens a menu with org, roles and sign out", () => {
    const onSignOut = vi.fn();
    render(<ConnectButton account={account} methods={methods} onSelect={noop} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole("button", { name: /M\. Brych/ }));
    expect(screen.getByText("Amt Röbel-Müritz")).toBeInTheDocument();
    expect(screen.getByText("Bürgermeister")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it("never opens the sign-in modal while signed in", () => {
    render(<ConnectButton account={account} methods={methods} onSelect={noop} onSignOut={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /M\. Brych/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("copes with a person who has no roles", () => {
    render(
      <ConnectButton
        account={{ displayName: "K. Ohne" }}
        methods={methods}
        onSelect={noop}
        onSignOut={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /K\. Ohne/ }));
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netizen-labs/connect-react test`
Expected: FAIL — `../src/ConnectButton` does not exist.

- [ ] **Step 3: Write the component**

Create `packages/connect-react/src/ConnectButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ConnectModal } from "./ConnectModal.js";
import { DEFAULT_THEME, themeToCssVars, type ConnectTheme } from "./theme.js";
import type { ConnectMethod } from "./methods.js";

/** What the surface knows about the signed-in person. Deliberately a plain shape rather than
 *  a session type: this package must not depend on any host app's session model. */
export interface ConnectAccount {
  displayName: string;
  orgName?: string;
  roles?: string[];
}

export interface ConnectButtonProps {
  /** `null` means signed out. */
  account: ConnectAccount | null;
  methods: ConnectMethod[];
  onSelect: (method: ConnectMethod) => void;
  onSignOut: () => void;
  theme?: ConnectTheme;
  contextLine?: string;
}

export function ConnectButton({
  account,
  methods,
  onSelect,
  onSignOut,
  theme = DEFAULT_THEME,
  contextLine,
}: ConnectButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const vars = themeToCssVars(theme) as React.CSSProperties;

  if (account) {
    return (
      <div className="nc-account" style={vars}>
        <button
          type="button"
          className="nc-account-trigger"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {account.displayName}
        </button>
        {menuOpen && (
          <div className="nc-menu" role="menu">
            {account.orgName && <p className="nc-menu-org">{account.orgName}</p>}
            {account.roles?.length ? (
              <p className="nc-menu-roles">{account.roles.join(", ")}</p>
            ) : null}
            <button type="button" className="nc-method" onClick={onSignOut}>
              Abmelden
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="nc-method nc-method--primary nc-trigger"
        style={vars}
        onClick={() => setModalOpen(true)}
      >
        Anmelden
      </button>
      <ConnectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        methods={methods}
        theme={theme}
        contextLine={contextLine}
        onSelect={(m) => {
          // Close first: the caller navigates, and a modal left open flashes over the
          // redirect on slow connections.
          setModalOpen(false);
          onSelect(m);
        }}
      />
    </>
  );
}
```

Append to `styles.css`:

```css
.nc-trigger { width: auto; display: inline-block; }
.nc-account { position: relative; display: inline-block; font-family: var(--nc-font); }
.nc-account-trigger {
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--nc-line);
  border-radius: var(--nc-radius);
  background: var(--nc-surface);
  color: var(--nc-on-surface);
  font: inherit;
  cursor: pointer;
  min-height: 2.75rem;
}
.nc-menu {
  position: absolute;
  right: 0;
  margin-top: 0.25rem;
  min-width: 14rem;
  padding: 1rem;
  background: var(--nc-surface);
  color: var(--nc-on-surface);
  border: 1px solid var(--nc-line);
  border-radius: var(--nc-radius);
  z-index: 50;
}
.nc-menu-org { margin: 0; font-weight: 600; }
.nc-menu-roles { margin: 0.25rem 0 0.75rem; color: var(--nc-muted); font-size: 0.875rem; }
```

Append to `src/index.ts`:

```ts
export { ConnectButton } from "./ConnectButton.js";
export type { ConnectButtonProps, ConnectAccount } from "./ConnectButton.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netizen-labs/connect-react test && pnpm --filter @netizen-labs/connect-react typecheck`
Expected: PASS (all tests from Tasks 1–4), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/connect-react/src/ConnectButton.tsx packages/connect-react/src/index.ts packages/connect-react/styles.css packages/connect-react/test/ConnectButton.test.tsx
git commit -m "feat(connect): ConnectButton with signed-in account menu"
```

---

### Task 5: Wire it into Ortis, with a local end-to-end path

**Repo:** netizen_labs

**Files:**
- Modify: `apps/ortis/package.json`, `apps/ortis/next.config.ts`, `apps/ortis/app/login/page.tsx`, `apps/ortis/app/api/auth/login/route.ts`
- Create: `apps/ortis/components/LoginConnect.tsx`, `apps/ortis/test/login-method.test.ts`

**Interfaces:**
- Consumes: `ConnectButton`, `ConnectModal`, `resolveMethods`, `hintFor`, `DEFAULT_THEME`.
- Produces: `/api/auth/login?method=<id>` forwards a validated keystone hint.

**Territory:** do NOT touch `app/(operator)/**` or `components/operator/**` — another session owns them. Put the new component at `apps/ortis/components/LoginConnect.tsx`, outside `components/operator/`.

- [ ] **Step 1: Write the failing test**

Create `apps/ortis/test/login-method.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildAuthorizeUrl } from "../lib/oidc";

// Ortis' scope assertion lives in test/oidc.test.ts; this file covers the method hint only.
describe("buildAuthorizeUrl with a method hint", () => {
  beforeAll(() => {
    process.env.OIDC_ISSUER = "https://id.ortis.app";
    process.env.OIDC_CLIENT_ID = "ortis";
    process.env.OIDC_CLIENT_SECRET = "test-secret";
    process.env.ORTIS_BASE_URL = "https://app.ortis.app";
    process.env.SESSION_SECRET = "test-session-secret";
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          authorization_endpoint: "https://id.ortis.app/auth",
          token_endpoint: "https://id.ortis.app/token",
          jwks_uri: "https://id.ortis.app/jwks",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
  });

  it("forwards a known method as netizen_method", async () => {
    const { url } = await buildAuthorizeUrl("email");
    expect(new URL(url).searchParams.get("netizen_method")).toBe("email");
  });

  it("omits the param entirely when no method is given", async () => {
    const { url } = await buildAuthorizeUrl();
    expect(new URL(url).searchParams.has("netizen_method")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/netizen/netizen_labs && pnpm --filter @netizen-labs/ortis test`
Expected: FAIL — `buildAuthorizeUrl` takes no argument yet.

- [ ] **Step 3: Add the dependency**

In `apps/ortis/package.json`, add to `dependencies` (keep alphabetical order with the existing `@netizen-labs/*` entries):

```json
    "@netizen-labs/connect-react": "workspace:*",
```

In `apps/ortis/next.config.ts`, extend the existing array:

```ts
  transpilePackages: [
    "@netizen-labs/ortis-core",
    "@netizen-labs/ortis-operator",
    "@netizen-labs/connect-react",
  ],
```

Then run `pnpm install` from the repo root.

- [ ] **Step 4: Thread the hint through**

In `apps/ortis/lib/oidc.ts`, change `buildAuthorizeUrl` to accept an optional keystone hint and set the param only when present:

```ts
export async function buildAuthorizeUrl(methodHint?: string): Promise<AuthStart> {
```

and immediately before `return { url: url.toString(), state, nonce, codeVerifier };` add:

```ts
  // Display preference only: it tells the keystone which method to show first. It never
  // affects which methods are permitted, and an unknown value is simply ignored there.
  if (methodHint) url.searchParams.set("netizen_method", methodHint);
```

In `apps/ortis/app/api/auth/login/route.ts`, read and validate the incoming method:

```ts
import { hintFor } from "@netizen-labs/connect-react";
```

and inside the handler, replacing the existing `buildAuthorizeUrl()` call:

```ts
  // Map the tenant method id to the keystone's own name. `hintFor` is a Map lookup that
  // returns undefined for anything unknown — never a sentinel index — so an unrecognised
  // value degrades to "no hint" (the keystone shows all methods) rather than being echoed.
  const methodHint = hintFor(req.nextUrl.searchParams.get("method") ?? "");
  const { url, state, nonce, codeVerifier } = await buildAuthorizeUrl(methodHint);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @netizen-labs/ortis test`
Expected: PASS — both new tests plus the existing scope test.

- [ ] **Step 6: Build the login client component**

Create `apps/ortis/components/LoginConnect.tsx`:

```tsx
"use client";

import { ConnectModal, resolveMethods, type ConnectMethod } from "@netizen-labs/connect-react";
import "@netizen-labs/connect-react/styles.css";
import { useState } from "react";

/** The Connect surface on /login. The page stays a server component and passes the tenant's
 *  configured method ids down; this component owns only the open/closed state and the
 *  navigation that starts a login. */
export function LoginConnect({
  methodIds,
  contextLine,
}: {
  methodIds: string[];
  contextLine?: string;
}) {
  const [open, setOpen] = useState(false);
  const methods = resolveMethods(methodIds);

  const start = (m: ConnectMethod) => {
    if (m.kind === "qr") return; // QR is not yet activated; the modal shows it as informational.
    window.location.href = `/api/auth/login?method=${encodeURIComponent(m.id)}`;
  };

  return (
    <>
      <button
        type="button"
        className="bg-ink px-5 py-3 text-sm font-medium text-paper"
        onClick={() => setOpen(true)}
      >
        Anmeldung starten
      </button>
      <ConnectModal
        open={open}
        onClose={() => setOpen(false)}
        methods={methods}
        contextLine={contextLine}
        onSelect={(m) => {
          setOpen(false);
          start(m);
        }}
      />
    </>
  );
}
```

- [ ] **Step 7: Host it on the login page**

In `apps/ortis/app/login/page.tsx`:

1. Add the import: `import { LoginConnect } from "@/components/LoginConnect";`
2. Replace the two method `<section>` blocks (the `qr-app-connect` block and the `email-otp` block, together with the `<div className="mt-10 grid ...">` wrapper around them) with:

```tsx
      <div className="mt-10">
        <LoginConnect methodIds={methods} contextLine={contextLine ?? undefined} />
      </div>
```

**Leave everything else on that page exactly as it is** — the `FEHLER` map and its rendering, `ladeMandantenkonfiguration`, the redirect when a session exists, and the dev-mode member list. Those are the error states and the local test path; removing any of them breaks a working flow.

- [ ] **Step 8: Verify the local end-to-end path — no keystone required**

This is the path to exercise the modal without redeploying anything:

```bash
cd ~/Documents/privat/side_projects/netizen/netizen_labs/apps/ortis
ORTIS_DEV_AUTH=1 pnpm dev
```

`ORTIS_DEV_AUTH=1` supplies a default `SESSION_SECRET` and makes OIDC optional (`lib/env.ts`), and `/api/auth/dev` creates a real session from the seeded member list. Open `http://localhost:3040/login` and confirm:

1. "Anmeldung starten" opens the modal; on a narrow window it is a bottom sheet, at ≥640px a centred dialog.
2. It lists exactly the tenant's configured methods.
3. Escape and a backdrop click close it; a click inside does not.
4. The dev member list still renders below and still signs you in — that is the fully functional local login.

Record what you observed in your report. If the seeded tenant lists only `email-otp` and `qr-app-connect`, that is correct — social appears once a tenant's settings include the `social-*` ids.

- [ ] **Step 9: Run the full checks**

Run:
```bash
cd ~/Documents/privat/side_projects/netizen/netizen_labs
pnpm --filter @netizen-labs/ortis test
pnpm --filter @netizen-labs/ortis typecheck
pnpm --filter @netizen-labs/connect-react test
```
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/ortis/package.json apps/ortis/next.config.ts apps/ortis/lib/oidc.ts apps/ortis/app/api/auth/login/route.ts apps/ortis/app/login/page.tsx apps/ortis/components/LoginConnect.tsx apps/ortis/test/login-method.test.ts pnpm-lock.yaml
git commit -m "feat(ortis): the Connect modal is the login surface"
```

---

### Task 6: Keystone method hint — DIFFERENT REPO

**Repo:** **DAO_test** (`~/Documents/privat/side_projects/DAO_test`) — not netizen_labs.

**Files:**
- Modify: `apps/roebel-id/src/oidc/provider.ts`, `apps/roebel-id/src/interaction/router.ts`, `apps/roebel-id/src/interaction/login-page.ts`
- Test: `apps/roebel-id/test/login-page.test.ts`

**Interfaces:**
- Consumes: the param name `netizen_method` sent by Task 5.
- Produces: the keystone login page pre-selects one method.

**Test framework here is vitest** (`pnpm test` from `apps/roebel-id`), unlike netizen_labs' packages.

**What this achieves, and what it does not.** It turns the keystone's method picker into a single-method confirm. It does NOT make sign-in zero-click: auto-triggering a social login on page load needs a popup, popups need a user gesture, and the redirect from Ortis severs the gesture that began with the click in the modal. One click in the modal, one confirm on the keystone.

**The hint is a display preference, never an authorization input.** It must not change which methods are permitted, and an unrecognised value must fall back to showing everything rather than failing the login.

- [ ] **Step 1: Write the failing test**

Add to `apps/roebel-id/test/login-page.test.ts` (match the file's existing imports and helpers):

```ts
  it('shows only the named method when a hint is given', () => {
    const html = renderLoginPage('uid-1', 'client-id', 100, { preset: 'ortis' }, 'google')
    expect(html).toContain('data-s="google"')
    expect(html).not.toContain('data-s="apple"')
    expect(html).not.toContain('data-s="facebook"')
  })

  it('shows the email form focused when the hint is email', () => {
    const html = renderLoginPage('uid-1', 'client-id', 100, { preset: 'ortis' }, 'email')
    expect(html).toContain('id="email"')
    expect(html).not.toContain('data-s="google"')
  })

  it('falls back to every method for an unknown hint — a bad hint must never block a login', () => {
    const html = renderLoginPage('uid-1', 'client-id', 100, { preset: 'ortis' }, 'carrier-pigeon')
    expect(html).toContain('data-s="google"')
    expect(html).toContain('id="email"')
  })

  it('renders exactly as before when no hint is given', () => {
    const withNo = renderLoginPage('uid-1', 'client-id', 100, { preset: 'ortis' })
    const withUndef = renderLoginPage('uid-1', 'client-id', 100, { preset: 'ortis' }, undefined)
    expect(withNo).toBe(withUndef)
    expect(withNo).toContain('data-s="google"')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/privat/side_projects/DAO_test/apps/roebel-id && pnpm vitest run test/login-page.test.ts`
Expected: FAIL — `renderLoginPage` takes no fifth argument.

- [ ] **Step 3: Declare the parameter on the provider**

In `apps/roebel-id/src/oidc/provider.ts`, add to the `Configuration` object (a sibling of `claims` and `scopes`):

```ts
    /** A display preference forwarded by a Connect surface: which login method to show first.
     *  oidc-provider drops undeclared authorize params, so it must be declared to survive to
     *  the interaction. It is NEVER an authorization input — see login-page.ts. */
    extraParams: ['netizen_method'],
```

- [ ] **Step 4: Pass it to the login page**

In `apps/roebel-id/src/interaction/router.ts`, where the login page is rendered, read the param and forward it. It arrives as `details.params.netizen_method`; read it defensively since any client may send anything:

```ts
      const methodHint =
        typeof details.params.netizen_method === 'string' ? details.params.netizen_method : undefined
```

and pass `methodHint` as the fifth argument to `renderLoginPage(...)`.

- [ ] **Step 5: Pre-select in the page**

In `apps/roebel-id/src/interaction/login-page.ts`, extend the signature:

```ts
export function renderLoginPage(
  uid: string,
  thirdwebClientId: string,
  chainId: number,
  branding: BrandingConfig,
  methodHint?: string,
): string {
```

Add, above the returned template:

```ts
// The keystone's own method names. Membership check, never indexOf — indexOf returns -1 for
// unknown values and -1 survives range comparisons, which is a fail-open default wearing a
// fail-closed shape. An unknown hint yields `undefined`, i.e. show everything.
const KNOWN_METHODS = new Set(['email', 'google', 'apple', 'facebook', 'phone'])
const selected = methodHint && KNOWN_METHODS.has(methodHint) ? methodHint : undefined
const showSocial = (s: string) => !selected || selected === s
const showEmail = !selected || selected === 'email'
```

Then guard each social button and the email block. Each `<button class="oauth" data-s="X">` line becomes conditional on `showSocial('X')`, and the email input/step markup on `showEmail`. Use the same string-concatenation style the file already uses; do not restructure the template.

**Do not change the `<script>` block's behaviour.** It wires every strategy generically from `data-s`; hiding a button is enough, and touching the script risks the SIWE flow.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ~/Documents/privat/side_projects/DAO_test/apps/roebel-id && pnpm test && pnpm build`
Expected: PASS — all 83 pre-existing tests plus the 4 new ones, typecheck clean. The golden-file test asserting the `roebel` preset renders byte-for-byte must still pass: with no hint, output is unchanged.

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/privat/side_projects/DAO_test
git add apps/roebel-id/src/oidc/provider.ts apps/roebel-id/src/interaction/router.ts apps/roebel-id/src/interaction/login-page.ts apps/roebel-id/test/login-page.test.ts
git commit -m "feat(roebel-id): a Connect surface can name which login method to show"
```

---

## Definition of done

- `pnpm --filter @netizen-labs/connect-react test` and `typecheck` pass, including the branding fallback cases (a down endpoint degrades the look, never the login).
- `pnpm --filter @netizen-labs/ortis test` and `typecheck` pass, including the pre-existing `netizen` scope assertion.
- `apps/roebel-id`: 83 pre-existing tests plus the new ones pass; `pnpm build` clean.
- The local path in Task 5 Step 8 was actually run and observed, with findings recorded.
- No file under `app/(operator)/`, `components/operator/`, `packages/ortis-operator/`, `packages/router/` or `packages/agent-watcher/` was modified.
- No colour literal exists in `packages/connect-react/src/` outside `theme.ts`.

## Deploy gate (operator step — not part of this plan)

`id.ortis.app` must be redeployed from the current keystone before Ortis sign-in works against production **at all** — `apps/ortis` already requests the `netizen` scope, and the deployed keystone does not serve it yet, so a real login fails `invalid_scope`. Task 6's hint should ride the same deploy. Until then, the local `ORTIS_DEV_AUTH=1` path is the way to exercise this work.

## Follow-ups (not in scope)

- The visual editor that writes `ConnectTheme` JSON.
- **Wiring** the theme source: `loadTheme()` ships and is tested (Task 1), but Ortis passes no theme yet, so the modal renders `DEFAULT_THEME`. Reading a stored theme from `identity.branding.theme`, or fetching `/.well-known/netizen-branding` at request time, is a small follow-up now that the loader and the fallback exist.
- The Netizen Account panel — Ortis cannot reach a signer until it is a node.
- QR app-connect activation; `kind: 'qr'` currently renders informationally and starts nothing.
- WalletConnect, phone, and "Netizen Login" — new registry rows.
- Operator console wiring, by agreement with the session that owns it.
- The React Native bottom sheet.
