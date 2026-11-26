# Issue Tracking & App Versioning — Design Document

> **Status:** Approved

## 1. Intent & Why

Provide a lightweight, mobile-friendly workflow for the user to log issues (found by themselves or reported verbally by their mother), investigate and resolve them with Antigravity by issue number (`"let's look at issue #N"`), and verify at a glance which deployed PWA version is running on her phone.

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Track all bugs, features, and polish items in GitHub Issues (`abhikmp/mom-expense-tracker`) using clean labels (`bug`, `feature`, `polish` and `Urgent`, `High`, `Medium`, `Low`).
- Provide `.github/ISSUE_TEMPLATE/` forms (`bug.yml`, `feature.yml`, `polish.yml`, `config.yml`) for fast capture with pre-applied type labels and priority selection.
- Maintain clean Semantic Versioning (`MAJOR.MINOR.PATCH`), starting at `1.0.0`, with `package.json` as the single source of truth.
- Display the current app version quietly at the bottom of **Manage & Settings** (`ManageView.tsx`).
- Document the issue workflow and release/versioning rules in `AGENTS.md` so future Antigravity sessions follow them automatically.

### Non-Goals
- No in-app bug-reporting form or mom-facing GitHub/Notion UI.
- No commit SHA or build timestamp noise appended to the displayed version string.

### Anti-Goals
- Cluttering **Manage & Settings** with prominent release banners or technical build metadata.
- Duplicating the version number manually across multiple files instead of deriving it from `package.json`.

## 3. Approaches Considered

| Approach | How It Works | Trade-offs | Verdict |
|---|---|---|---|
| **1. Notion Tracker + Notion MCP** | Keep Notion database with tags/priorities and Notion MCP. | Fast mobile entry; already connected; disconnected from commits, PRs, and releases. | Not selected |
| **2. GitHub Issues + GitHub MCP + Clean SemVer in UI (Selected)** | GitHub Issues with Issue Forms & labels, connected via GitHub MCP, paired with `package.json` SemVer injected at build time into `ManageView`. | Keeps issues, PRs (`Fixes #N`), git tags, and GitHub Releases in one place. Requires checking/creating labels in GitHub once. | **Selected** |

## 4. Design Details

1. **GitHub Issue Templates (`.github/ISSUE_TEMPLATE/`):**
   - `bug.yml` (`labels: ["bug"]`): Priority dropdown (`Urgent`, `High`, `Medium`, `Low`), *What happened*, *What you expected*, optional *App version (from Manage & Settings)* input.
   - `feature.yml` (`labels: ["feature"]`): Priority dropdown, *What & Why*, *Behavior / Notes*.
   - `polish.yml` (`labels: ["polish"]`): Priority dropdown, *What feels rough / could be cleaner*.
   - `config.yml`: `blank_issues_enabled: true` so ad-hoc 5-second issues still work on mobile.
   - Note: GitHub Issue Form `dropdown` values are rendered in the issue body (GitHub YAML forms don't automatically convert dropdown selections to labels without an Action), while the type label (`bug`, `feature`, `polish`) is applied automatically; priority labels (`Urgent`, `High`, `Medium`, `Low`) can be applied manually or via Antigravity triage (`issue_write`).
2. **Issue Handling Loop:**
   - Reporter logs issue → asks Antigravity *"let's look at issue #N"* → Antigravity calls `issue_read`, implements/tests fix, references `Fixes #N` in commits/PRs, and closes with a brief resolution summary once shipped.
3. **Clean SemVer (`1.0.0` initial live release):**
   - `package.json` `"version"` set to `"1.0.0"`.
   - `vite.config.ts` injects `__APP_VERSION__` via `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` (read from `package.json`), declared in `src/vite-env.d.ts`.
   - `ManageView.tsx` renders a quiet muted footer caption (`Version {__APP_VERSION__}`, e.g. `Version 1.0.0`) below the `Backup & Restore (.json)` card inside `.phone-scroll`.
   - Bump conventions: `PATCH` (`1.0.x`) for `bug` fixes, `MINOR` (`1.x.0`) for `feature` / `polish` releases, `MAJOR` (`x.0.0`) for major overhauls or breaking backup/schema changes; tag `vX.Y.Z` on `main` when releasing.
4. **Repository Guidelines (`AGENTS.md`):**
   - Record the issue labels, `"issue #N"` MCP workflow, and SemVer bump/tagging rules.
