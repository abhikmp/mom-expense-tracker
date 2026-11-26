# Issue Tracking & App Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up GitHub Issue templates and repo guidelines for issue handling, and surface the app's clean SemVer (`1.0.0`) from `package.json` quietly at the bottom of Manage & Settings.

**Architecture:** `package.json` serves as the single source of truth for the app version, injected into the Vite/Vitest build as `__APP_VERSION__` via `vite.config.ts` and rendered as a subtle footer line inside `ManageView`. GitHub Issue Forms in `.github/ISSUE_TEMPLATE/` standardize mobile and desktop issue capture with type labels (`bug`, `feature`, `polish`) and priority dropdowns (`Urgent`, `High`, `Medium`, `Low`), while `AGENTS.md` documents the `"issue #N"` workflow and SemVer release rules.

**Tech Stack:** TypeScript, React 19, Vite 6, Vitest, GitHub Issue Forms (YAML)

**Spec:** [2026-11-26-issues-and-versioning-design.md](../specs/2026-11-26-issues-and-versioning-design.md)

## Global Constraints

- Single source of truth for version: `"version"` in `package.json`, starting at `"1.0.0"`.
- Clean SemVer string only (`Version 1.0.0`) — no commit SHA or build timestamp in the UI.
- Quiet placement at the bottom of `ManageView` inside `.phone-scroll` below `#sec-backup`, using existing theme tokens (`--color-muted-foreground`).
- Issue type labels: `bug`, `feature`, `polish`.
- Priority options/labels: `Urgent`, `High`, `Medium`, `Low` (no `P0 -` prefix).
- Blank issues remain enabled (`blank_issues_enabled: true`) for quick mobile capture.
- Keep zero runtime external network requests; `tsc -b`, `npm test`, and `npm run build` must all pass.

## Review Focus

- Vitest runs against `vite.config.ts`: `__APP_VERSION__` must be defined in `vite.config.ts` so component tests rendering `ManageView` receive the real `package.json` version without mocking.
- TypeScript project-references build (`tsc -b`): `tsconfig.node.json` must allow importing `package.json` (`resolveJsonModule: true`) and `src/vite-env.d.ts` must declare `__APP_VERSION__: string` so `tsc -b` passes cleanly.
- Mobile bottom-nav clearance: `.app-version` sits inside `.phone-scroll` (which already pads above `.android-bottom-nav`) so it is never obscured on 360px phones or desktop frames.
- GitHub Issue Form syntax: each `.yml` template must declare `name`, `description`, `labels`, and valid `body` blocks with `Urgent`, `High`, `Medium`, `Low` priority options.
- SemVer discipline: `tests/scaffold.test.ts` pins `package.json` `version` to `^\d+\.\d+\.\d+$` so accidental malformed strings fail CI.

---

### Task 1: Expose SemVer (`1.0.0`) from `package.json` and Render Footer in `ManageView`

**Files:**
- Modify: `package.json:4`
- Modify: `tsconfig.node.json`
- Modify: `vite.config.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/styles/app.css`
- Modify: `src/views/ManageView.tsx:630-635`
- Test: `tests/components/ManageView.test.tsx`

**Interfaces:**
- Produces: global build-time constant `__APP_VERSION__: string` (declared in `src/vite-env.d.ts`, defined in `vite.config.ts` from `package.json`).

- [ ] **Step 1: Write the failing test in `tests/components/ManageView.test.tsx`**

Append a test inside `describe('ManageView & AppShell', ...)` importing `pkg` (or reading `package.json` via `node:fs`) and asserting that `ManageView` renders `Version ${pkg.version}` quietly at the bottom of the page:

```tsx
  it('displays the current app version at the bottom of Manage & Settings', async () => {
    const dbName = nextDbName();
    render(
      <AppProvider dbName={dbName}>
        <ManageHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Version 1.0.0')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ManageView.test.tsx -t "displays the current app version"`
Expected: FAIL because `Version 1.0.0` is not rendered and `__APP_VERSION__` / `1.0.0` are not yet wired.

- [ ] **Step 3: Bump `package.json` version and wire `__APP_VERSION__` in Vite + TypeScript**

1. In `package.json`, change `"version": "0.0.1"` to `"version": "1.0.0"`.
2. In `tsconfig.node.json`, add `"resolveJsonModule": true` under `"compilerOptions"`.
3. In `vite.config.ts`, import `pkg from './package.json'` and add:
   ```ts
   define: {
     __APP_VERSION__: JSON.stringify(pkg.version),
   },
   ```
4. In `src/vite-env.d.ts`, add:
   ```ts
   declare const __APP_VERSION__: string;
   ```

- [ ] **Step 4: Render quiet version footer in `ManageView.tsx` and style `.app-version` in `src/styles/app.css`**

1. In `src/styles/app.css`, add `.app-version` using `--color-muted-foreground` (centered, `12px`, `font-weight: 500`, subtle top/bottom spacing `margin: 4px 0 0; text-align: center;`).
2. In `src/views/ManageView.tsx`, right after the closing `</section>` of `#sec-backup` (still inside `.phone-scroll`), render:
   ```tsx
   <p className="app-version num">Version {__APP_VERSION__}</p>
   ```

- [ ] **Step 5: Run tests, typecheck, and build to verify pass**

Run: `npm test && npm run build`
Expected: All Vitest suites pass, `tsc -b` reports 0 errors, and `vite build` succeeds.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json tsconfig.node.json vite.config.ts src/vite-env.d.ts src/styles/app.css src/views/ManageView.tsx tests/components/ManageView.test.tsx
git commit -m "feat: surface SemVer app version in Manage & Settings"
```

---

### Task 2: Add GitHub Issue Templates, Scaffold Assertions, and Workflow Docs (`AGENTS.md`)

**Files:**
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/ISSUE_TEMPLATE/polish.yml`
- Create: `AGENTS.md`
- Test: `tests/scaffold.test.ts`

**Interfaces:**
- Consumes: `package.json` (`"version"` SemVer string) and `.github/ISSUE_TEMPLATE/*.yml`.

- [ ] **Step 1: Write the failing test in `tests/scaffold.test.ts`**

Add tests verifying that `package.json` uses valid SemVer (`^\d+\.\d+\.\d+$`) and that `.github/ISSUE_TEMPLATE/config.yml`, `bug.yml`, `feature.yml`, and `polish.yml` exist with the expected labels (`bug`, `feature`, `polish`) and priority choices (`Urgent`, `High`, `Medium`, `Low`):

```ts
  it('uses valid SemVer in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('includes GitHub issue templates with expected labels and priorities', () => {
    const templateDir = path.resolve(process.cwd(), '.github/ISSUE_TEMPLATE');
    const config = fs.readFileSync(path.join(templateDir, 'config.yml'), 'utf8');
    expect(config).toContain('blank_issues_enabled: true');

    for (const label of ['bug', 'feature', 'polish'] as const) {
      const content = fs.readFileSync(path.join(templateDir, `${label}.yml`), 'utf8');
      expect(content).toContain(`labels: ["${label}"]`);
      for (const priority of ['Urgent', 'High', 'Medium', 'Low']) {
        expect(content).toContain(`- ${priority}`);
      }
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scaffold.test.ts`
Expected: FAIL because `.github/ISSUE_TEMPLATE/` files do not exist yet.

- [ ] **Step 3: Create `.github/ISSUE_TEMPLATE/` files (`config.yml`, `bug.yml`, `feature.yml`, `polish.yml`)**

1. `config.yml`: `blank_issues_enabled: true`
2. `bug.yml`: `name: Bug report`, `description: Something isn't working`, `labels: ["bug"]`, fields:
   - `dropdown` (`id: priority`, `label: Priority`, `options: [Urgent, High, Medium, Low]`, `default: 1`, `required: true`)
   - `textarea` (`id: what_happened`, `label: What happened?`, `required: true`)
   - `textarea` (`id: expected`, `label: What did you expect?`, `required: false`)
   - `input` (`id: version`, `label: App version (from Manage & Settings)`, `placeholder: e.g. 1.0.0`, `required: false`)
3. `feature.yml`: `name: Feature request`, `description: New capability or enhancement`, `labels: ["feature"]`, fields:
   - `dropdown` (`id: priority`, `label: Priority`, `options: [Urgent, High, Medium, Low]`, `default: 2`, `required: true`)
   - `textarea` (`id: summary`, `label: What do you want to add and why?`, `required: true`)
   - `textarea` (`id: notes`, `label: Behavior / Notes`, `required: false`)
4. `polish.yml`: `name: Polish / UI tweak`, `description: Visual, copy, or ergonomics improvement`, `labels: ["polish"]`, fields:
   - `dropdown` (`id: priority`, `label: Priority`, `options: [Urgent, High, Medium, Low]`, `default: 2`, `required: true`)
   - `textarea` (`id: details`, `label: What feels rough or could be cleaner?`, `required: true`)

- [ ] **Step 4: Create `AGENTS.md` documenting issue workflow and SemVer policy**

Document concisely:
- Repo (`abhikmp/mom-expense-tracker`) uses GitHub Issues via GitHub MCP (`issue_read`, `issue_write`, `list_issues`).
- Labels: Type (`bug`, `feature`, `polish`) and Priority (`Urgent`, `High`, `Medium`, `Low`).
- `"let's look at issue #N"` workflow: read via `issue_read`, triage/apply priority label if missing, fix on branch or PR with `Fixes #N`, verify `npm test && npm run build`, and close with a short resolution comment.
- SemVer rules (`package.json` is source of truth): `PATCH` (`1.0.x`) for bugs, `MINOR` (`1.x.0`) for features/polish, `MAJOR` (`x.0.0`) for major/breaking backup schema changes; create git tag `vX.Y.Z` on `main` when shipping a release.

- [ ] **Step 5: Run full verification**

Run: `npm test && npm run build`
Expected: All tests pass, `tsc -b` passes, `vite build` succeeds.

- [ ] **Step 6: Commit Task 2**

```bash
git add .github/ISSUE_TEMPLATE/ AGENTS.md tests/scaffold.test.ts
git commit -m "chore: add GitHub issue templates and versioning workflow docs"
```
