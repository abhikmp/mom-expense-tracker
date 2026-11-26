# Repository Guidelines

## Issue Tracking (`abhikmp/mom-expense-tracker`)

- Issues are tracked in **GitHub Issues** using the templates in `.github/ISSUE_TEMPLATE/`.
- **Issue Types (GitHub native `type`):** `Bug`, `Feature`, `Task`
- **Labels:**
  - `ui/ux` — UI/UX tweaks (paired with issue type `Feature`)
  - **Priority:** `Urgent`, `High`, `Medium`, `Low`
- **Workflow when asked *"let's look at issue #N"*:**
  1. Read the issue via GitHub MCP (`issue_read`) or `gh issue view N` including title, body, type, labels, and comments.
  2. Fix or implement the change with tests (`npm test`) and build verification (`npm run build`).
  3. Reference `Fixes #N` in commits/PRs (or close via `gh issue close N` / GitHub with a short summary of what resolved it).

## Versioning & Releases (Clean SemVer)

- `package.json` `"version"` is the single source of truth, injected into the app as `__APP_VERSION__` (`vite.config.ts`) and shown at the bottom of **Manage & Settings** (`Version X.Y.Z`).
- **Bump rules:**
  - `PATCH` (`1.0.x`): bug fixes
  - `MINOR` (`1.x.0`): features or UI/UX tweaks
  - `MAJOR` (`x.0.0`): major overhauls or breaking backup/schema changes
- When shipping a release on `main`, bump `package.json` `"version"` and create a matching git tag (`vX.Y.Z`) / GitHub Release.
