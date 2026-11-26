# Mom's Expense & Bank Account Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable, offline-first Android-phone-only PWA expense and bank account tracker for Mom using local `IndexedDB` storage, integer-paise math, Soft Cards UI (Light & Dark themes), `.csv` Share-sheet export, and `.json` backup/restore.

**Architecture:** A Vite + React + TypeScript single-page PWA centered in a `430px` phone shell with pure domain modules (`money`, `dates`, `calculations`, `validation`), an `idb`-backed `IndexedDB` persistence layer, a React context store, and five screens (`Home`, `Record`, `BankHistory`, `AllTransactions`, `Manage`). All account balances are derived dynamically from `startingBalancePaise + netTransactionsPaise` so edits, deletes, and transfers never drift.

**Tech Stack:** Vite, React 19, TypeScript, `idb`, `vite-plugin-pwa` (Workbox), `@fontsource/ibm-plex-sans`, `@phosphor-icons/react`, Vitest, `@testing-library/react`, `fake-indexeddb`.

**Spec:** [docs/superpowers/specs/2026-11-26-mom-expense-tracker-design.md](../specs/2026-11-26-mom-expense-tracker-design.md) and [docs/superpowers/specs/ui-reference.html](../specs/ui-reference.html)

## Global Constraints

- **Target device & layout:** Android phone-only PWA layout; `max-width: 430px` centered frame on `>= 480px`, full-bleed `100dvh` on phones; `60px` Top App Bar (`20px` `<h1>`), `16px` gutters, `48dp+` touch targets (`>= 8px` spacing), `56×30px` bottom-nav active pill, `env(safe-area-inset-*)` support.
- **Language & currency:** English UI; Indian Rupees (`₹` / `INR`) with `en-IN` digit grouping, allowing decimal paise inputs while hiding `.00` on whole-rupee display.
- **Monetary integrity:** Store and compute all monetary amounts (`startingBalancePaise`, `amountPaise`) as integer paise (`Math.round(rupees * 100)`); convert to/from decimal rupees strictly at input, display, and `.csv` export boundaries.
- **Offline & zero network calls:** Zero runtime external network requests; bundle `@fontsource/ibm-plex-sans` (weights `400, 500, 600, 700`) and `@phosphor-icons/react` locally; silent `navigator.storage?.persist?.()` on startup; Workbox precaching via `vite-plugin-pwa`.
- **PWA identity & deploy:** Name `"Mom's Expense Tracker"`, short name `"Expenses"`, `display: "standalone"`, Vite `base: './'` for static HTTPS hosting.
- **First-run purity:** Start with zero bank accounts and zero sample/demo transactions; show a clean prompt to add the first bank account.
- **Visual tokens & motion:** Match CSS tokens, colors, radii (`20px` card, `14px` control, `999px` chips), tabular-nums (`font-variant-numeric: tabular-nums`), `13px–14px` metadata floor (`12px` pill floor), `0ms` tab switches, `140ms` `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`) `scale(0.97)` press states, `200ms` centered dialogs (`scale(0.96) -> 1`), hover media query gating, and `prefers-reduced-motion: reduce`.
- **Windows CLI note:** On this host, PowerShell restricts `npm.ps1`; run npm/npx commands via `npm.cmd` and `npx.cmd`.

## Review Focus

- **Local timezone vs UTC date off-by-one (`YYYY-MM-DD`):** In IST (`+05:30`), `toISOString().slice(0, 10)` shifts backward by a day before 05:30 AM; `getTodayLocalISO()` must use local calendar year/month/day (tested in Task 2).
- **Archived accounts & hidden categories during edits/exports:** Editing a historical entry on an archived account or hidden category must keep that account/category selectable and preserve its name in rows and `.csv` exports without forcing reassignment (tested in Tasks 4 & 7).
- **Switching transaction type in Edit dialog:** Changing `Expense` to `Deposit` or `Transfer` must clear `categoryId`, update `direction`, and normalize `mode` if the previous mode does not belong to the new type's mode list (tested in Task 7).
- **Corrupt or inconsistent JSON backup restore:** Invalid JSON, wrong `schemaVersion`, non-integer paise, negative `amountPaise`, or missing referenced `accountId` must be rejected with a clear error message and leave existing `IndexedDB` data untouched (tested in Tasks 2 & 3).
- **Android Share sheet cancellation (`AbortError`) vs unsupported fallback:** Cancelling the native share sheet (`AbortError`) must not trigger a duplicate download or error toast; non-abort share failures or missing `navigator.canShare` must fall back cleanly to browser file downloads (tested in Task 4).

---

## File Structure

```text
mom-expense-tracker/
  package.json
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  vite.config.ts
  index.html
  public/icons/
    icon-192.png
    icon-512.png
    apple-touch-icon.png
  src/
    main.tsx
    App.tsx
    styles/
      tokens.css
      app.css
    domain/
      types.ts
      money.ts
      dates.ts
      calculations.ts
      validation.ts
    storage/
      db.ts
    export/
      csv.ts
      backup.ts
    state/
      AppContext.tsx
    components/
      TopBar.tsx
      BottomNav.tsx
      Banners.tsx
      TransactionRow.tsx
      EditTransactionDialog.tsx
      ConfirmDialogs.tsx
    views/
      HomeView.tsx
      BankHistoryView.tsx
      RecordView.tsx
      AllTransactionsView.tsx
      ManageView.tsx
  tests/
    setup.ts
    domain/{money,dates,calculations,validation}.test.ts
    storage/db.test.ts
    export/{csv,backup}.test.ts
    components/{HomeAndBankFlow,RecordView,AllTransactionsAndEdit,ManageView}.test.tsx
```

---

### Task 1: Project Scaffold, PWA Configuration & Soft Cards Styles

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png`
- Create: `src/domain/types.ts`
- Create: `src/styles/tokens.css`, `src/styles/app.css`
- Create: `tests/setup.ts`, `tests/scaffold.test.ts`

**Interfaces:**
- Produces in `src/domain/types.ts`:
  - `TransactionType = 'expense' | 'deposit' | 'transfer'`
  - `TransactionDirection = 'outgoing' | 'incoming'`
  - `ThemeMode = 'light' | 'dark'`
  - `ViewId = 'home' | 'record' | 'bank-tx' | 'all' | 'manage'`
  - `BankAccount`, `Category`, `Transaction`, `AppSettings`, `FilterState`, `BackupPayload`
- Produces in `src/styles/tokens.css` & `src/styles/app.css`: exact CSS custom properties and layout/component classes from `docs/superpowers/specs/ui-reference.html` (lines 11–475).

- [ ] **Step 1: Write `package.json` and TypeScript/Vite configs**

Create `package.json` with dependencies (`react`, `react-dom`, `idb`, `@fontsource/ibm-plex-sans`, `@phosphor-icons/react`) and devDependencies (`vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`, `typescript`, `@types/react`, `@types/react-dom`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `fake-indexeddb`). Configure scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"test": "vitest run"`, `"test:watch": "vitest"`.

Configure `vite.config.ts` with `base: './'`, `react()`, `VitePWA` (`registerType: 'autoUpdate'`, `includeAssets: ['icons/*.png']`, manifest `{ name: "Mom's Expense Tracker", short_name: "Expenses", start_url: "./", scope: "./", display: "standalone", background_color: "#F8FAFC", theme_color: "#0F172A", icons: [...] }`, `workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'] }`), and Vitest config (`environment: 'jsdom'`, `setupFiles: ['./tests/setup.ts']`).

- [ ] **Step 2: Install dependencies and generate local PWA PNG icons**

Run `npm.cmd install` and generate clean monochrome navy (`#0F172A`) / white `₹` or wallet geometric PNG icons at `public/icons/icon-192.png` (192×192), `public/icons/icon-512.png` (512×512), and `public/icons/apple-touch-icon.png` (180×180) using a small Node script (deleted after generating, or inline one-off via `node -e`) using Node's built-in `zlib` so there are zero external asset downloads.

- [ ] **Step 3: Create `index.html`, `src/domain/types.ts`, `src/styles/tokens.css`, `src/styles/app.css`, and `tests/setup.ts`**

- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`, `<meta name="theme-color" content="#F8FAFC" />`, `<title>Mom's Expense Tracker</title>`, link to `icons/apple-touch-icon.png`, zero Google Fonts `<link>` tags.
- `src/domain/types.ts`: define `BankAccount`, `Category`, `Transaction`, `AppSettings`, `FilterState`, `BackupPayload`, `DEFAULT_CATEGORIES`, `DEFAULT_SETTINGS`.
- `src/styles/tokens.css` & `src/styles/app.css`: port all CSS tokens and component rules directly from `docs/superpowers/specs/ui-reference.html` lines 11–475.
- `tests/setup.ts`: import `@testing-library/jest-dom/vitest` and `fake-indexeddb/auto`.

- [ ] **Step 4: Write failing scaffold smoke test `tests/scaffold.test.ts`**

Assert `DEFAULT_CATEGORIES` has the 6 exact names (`Groceries`, `Bills`, `Medical`, `Household`, `Travel`, `Other`) all with `hidden: false`, `DEFAULT_SETTINGS` has `expensePaymentModes: ['GPay', 'Cash', 'Card']`, `transferPaymentModes: ['GPay', 'Cash', 'Cheque']`, `depositModes: ['Cash', 'Cheque']`, and `index.html` contains no `https://` URLs.

- [ ] **Step 5: Run test to verify and commit**

Run: `npx.cmd vitest run tests/scaffold.test.ts`
Expected: PASS (after Step 3 is in place; if run before Step 3, FAIL with missing module).

```bash
git add package.json package-lock.json tsconfig*.json vite.config.ts index.html public/ src/domain/types.ts src/styles/ tests/
git commit -m "chore: scaffold Vite React PWA with Soft Cards design tokens"
```

---

### Task 2: Domain Math, Dates, Calculations & Validation

**Files:**
- Create: `src/domain/money.ts`, `src/domain/dates.ts`, `src/domain/calculations.ts`, `src/domain/validation.ts`
- Test: `tests/domain/money.test.ts`, `tests/domain/dates.test.ts`, `tests/domain/calculations.test.ts`, `tests/domain/validation.test.ts`

**Interfaces:**
- Consumes: `src/domain/types.ts` (`BankAccount`, `Category`, `Transaction`, `FilterState`, `BackupPayload`, `AppSettings`)
- Produces:
  - `money.ts`:
    - `parseRupeesToPaise(raw: string): number | null`
    - `formatRupees(paise: number, opts?: { signed?: boolean }): string`
    - `formatDecimalRupeesPlain(paise: number): string`
  - `dates.ts`:
    - `getTodayLocalISO(now?: Date): string`
    - `shiftLocalDateISO(iso: string, deltaDays: number): string`
    - `formatDateShort(iso: string, todayIso?: string): string`
    - `formatMonthTitle(ym: string): string`
    - `shiftMonth(ym: string, delta: number): string`
    - `getCurrentMonthYM(now?: Date): string`
  - `calculations.ts`:
    - `computeNetTransactionsPaise(accountId: string, transactions: Transaction[]): number`
    - `computeAccountBalancePaise(account: BankAccount, transactions: Transaction[]): number`
    - `computeAdjustedStartingBalancePaise(desiredBalancePaise: number, accountId: string, transactions: Transaction[]): number`
    - `computeTotalActiveBalancePaise(accounts: BankAccount[], transactions: Transaction[]): number`
    - `computeMonthlyCategorySpending(ym: string, transactions: Transaction[], categories: Category[]): { totalPaise: number; rows: Array<{ categoryId: string; name: string; amountPaise: number; sharePct: number }> }`
    - `getSortedTransactions(transactions: Transaction[]): Transaction[]`
    - `filterTransactions(transactions: Transaction[], filters: FilterState): Transaction[]`
    - `isBackupReminderDue(settings: AppSettings, accounts: BankAccount[], transactions: Transaction[], now?: Date): { due: boolean; daysSince: number }`
  - `validation.ts`:
    - `validateTransactionAmount(raw: string): { valid: true; paise: number } | { valid: false; error: string }`
    - `validateBackupPayload(raw: unknown): { valid: true; payload: BackupPayload } | { valid: false; error: string }`
    - `slugifyAccountName(name: string): string`

- [ ] **Step 1: Write failing tests for `money.ts` and `dates.ts`**

In `tests/domain/money.test.ts`:
- `parseRupeesToPaise("1,250.50") === 125050`, `parseRupeesToPaise("0") === 0`, `parseRupeesToPaise("45.5") === 4550`, `parseRupeesToPaise("12.345") === null`, `parseRupeesToPaise("-10") === null`, `parseRupeesToPaise("") === null`, `parseRupeesToPaise("0.1") + parseRupeesToPaise("0.2") === 30` (zero float drift).
- `formatRupees(125000) === "₹1,25,000"` (hides `.00`, uses `en-IN` grouping), `formatRupees(124050) === "₹1,240.50"`, `formatRupees(-48500, { signed: true }) === "-₹485"`, `formatRupees(800000, { signed: true }) === "+₹8,000"`, `formatRupees(-500) === "-₹5"`.
- `formatDecimalRupeesPlain(4550) === "45.50"`.

In `tests/domain/dates.test.ts`:
- Review Focus test: `getTodayLocalISO(new Date(2026, 10, 26, 0, 15)) === "2026-11-26"` (local calendar date, not UTC previous day).
- `formatDateShort("2026-11-26", "2026-11-26") === "Today"`, `formatDateShort("2026-11-25", "2026-11-26") === "Yesterday"`, `formatDateShort("2026-11-10", "2026-11-26") === "10 Nov"`, `formatDateShort("2025-12-01", "2026-11-26") === "1 Dec 2025"`.
- `shiftMonth("2026-01", -1) === "2025-12"`, `shiftMonth("2026-11", 2) === "2027-01"`.

- [ ] **Step 2: Run money & date tests to verify they fail**

Run: `npx.cmd vitest run tests/domain/money.test.ts tests/domain/dates.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/domain/money.ts` and `src/domain/dates.ts`**

Match exact formatting rules from `ui-reference.html` lines 539–581, substituting local calendar date helpers for `TODAY`.

- [ ] **Step 4: Run money & date tests to verify they pass**

Run: `npx.cmd vitest run tests/domain/money.test.ts tests/domain/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for `calculations.ts` and `validation.ts`**

In `tests/domain/calculations.test.ts`:
- `computeAccountBalancePaise` adds `deposit` + `transfer/incoming` and subtracts `expense` + `transfer/outgoing`.
- `computeTotalActiveBalancePaise` excludes `archived: true` accounts.
- `computeAdjustedStartingBalancePaise(desired, accId, txs)` yields `startingBalancePaise` such that `computeAccountBalancePaise` equals `desired` even when resulting `startingBalancePaise` is negative.
- `computeMonthlyCategorySpending` aggregates ONLY `expense` transactions for `ym`, strictly excludes `deposit` and `transfer` (both incoming & outgoing), resolves renamed/hidden category names, and sorts descending by `amountPaise`.
- `filterTransactions` filters by `fromDate`, `toDate`, `typeKey` (`expense`, `deposit`, `transfer-outgoing`, `transfer-incoming`), and `categoryId` (restricting to expenses when `categoryId !== 'all'`).
- `isBackupReminderDue`: returns `due: false` when `accounts` has 0 active accounts; returns `due: true` when `changesSinceLastBackup >= 25` OR when `>= 30` days since `lastBackupOrExportAt` (or oldest transaction `createdAt` if never backed up).

In `tests/domain/validation.test.ts`:
- `validateTransactionAmount("0")` fails with `"Please enter an amount greater than ₹0."`; `validateTransactionAmount("45.50")` returns `{ valid: true, paise: 4550 }`.
- Review Focus tests for `validateBackupPayload`: rejects non-object, wrong `schemaVersion`, missing arrays, negative `amountPaise`, non-integer `startingBalancePaise` (`12.5`), unknown `accountId` in a transaction, invalid `type`; accepts valid payload with optional `expensePaymentModes` / `transferPaymentModes`.

- [ ] **Step 6: Run calculation & validation tests to verify they fail**

Run: `npx.cmd vitest run tests/domain/calculations.test.ts tests/domain/validation.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 7: Implement `src/domain/calculations.ts` and `src/domain/validation.ts`**

- [ ] **Step 8: Run all domain tests and commit**

Run: `npx.cmd vitest run tests/domain/`
Expected: PASS across all 4 test files.

```bash
git add src/domain/ tests/domain/
git commit -m "feat: add paise math, local date, balance calculation, and validation modules"
```

---

### Task 3: IndexedDB Persistence Layer (`idb`)

**Files:**
- Create: `src/storage/db.ts`
- Test: `tests/storage/db.test.ts`

**Interfaces:**
- Consumes: `src/domain/types.ts`, `src/domain/validation.ts` (`validateBackupPayload`)
- Produces in `src/storage/db.ts`:
  - `openAppDb(dbName?: string): Promise<IDBPDatabase<MomExpenseDbSchema>>`
  - `loadAppState(db): Promise<{ accounts: BankAccount[]; categories: Category[]; transactions: Transaction[]; settings: AppSettings }>`
  - `createTransactionAtomic(db, tx: Transaction): Promise<AppSettings>`
  - `updateTransactionAtomic(db, tx: Transaction): Promise<AppSettings>`
  - `deleteTransactionAtomic(db, txId: string): Promise<AppSettings>`
  - `saveAccount(db, account: BankAccount, updateLastUsed?: boolean): Promise<void>`
  - `saveCategory(db, category: Category): Promise<void>`
  - `saveSettings(db, patch: Partial<AppSettings>): Promise<AppSettings>`
  - `markBackupOrExportCompleted(db, exportedAtIso: string): Promise<AppSettings>`
  - `restoreBackupAtomic(db, payload: BackupPayload): Promise<{ accounts: BankAccount[]; categories: Category[]; transactions: Transaction[]; settings: AppSettings }>`

- [ ] **Step 1: Write failing persistence tests in `tests/storage/db.test.ts`**

Test against `fake-indexeddb`:
- `loadAppState` on fresh DB seeds 0 accounts, 0 transactions, the 6 `DEFAULT_CATEGORIES`, and `DEFAULT_SETTINGS`.
- `createTransactionAtomic` stores the transaction, updates `settings.lastUsedAccountId` to `tx.accountId`, and increments `settings.changesSinceLastBackup`.
- `updateTransactionAtomic` and `deleteTransactionAtomic` modify/remove the record and increment `changesSinceLastBackup`.
- `saveAccount` creates, renames, adjusts `startingBalancePaise`, and toggles `archived`.
- `saveCategory` creates, renames, and toggles `hidden` while preserving `id`.
- `saveSettings` persists `theme`, `expensePaymentModes`, and `transferPaymentModes`.
- `markBackupOrExportCompleted` resets `changesSinceLastBackup` to `0` and sets `lastBackupOrExportAt`.
- `restoreBackupAtomic` replaces all accounts, categories, transactions, and custom payment modes, resets `changesSinceLastBackup` to `0`, and updates `lastUsedAccountId` to first active restored account (or `null`).

- [ ] **Step 2: Run `db.test.ts` to verify it fails**

Run: `npx.cmd vitest run tests/storage/db.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/storage/db.ts`**

Use `openDB` from `idb` with object stores `accounts` (`keyPath: 'id'`), `categories` (`keyPath: 'id'`), `transactions` (`keyPath: 'id'`, indexes `by-date`, `by-account`), and `settings` (`keyPath: 'key'` storing `'app'` record). Wrap multi-store mutations (`createTransactionAtomic`, `updateTransactionAtomic`, `deleteTransactionAtomic`, `restoreBackupAtomic`) in single `readwrite` transactions across affected stores.

- [ ] **Step 4: Run `db.test.ts` to verify it passes and commit**

Run: `npx.cmd vitest run tests/storage/db.test.ts`
Expected: PASS.

```bash
git add src/storage/db.ts tests/storage/db.test.ts
git commit -m "feat: implement atomic IndexedDB persistence layer with idb"
```

---

### Task 4: CSV Export, Android Share Sheet & JSON Backup

**Files:**
- Create: `src/export/csv.ts`, `src/export/backup.ts`
- Test: `tests/export/csv.test.ts`, `tests/export/backup.test.ts`

**Interfaces:**
- Consumes: `src/domain/types.ts`, `src/domain/money.ts` (`formatDecimalRupeesPlain`), `src/domain/calculations.ts` (`computeAccountBalancePaise`), `src/domain/dates.ts` (`getTodayLocalISO`), `src/domain/validation.ts` (`slugifyAccountName`)
- Produces:
  - `csv.ts`:
    - `csvCell(val: unknown): string`
    - `buildTransactionsCsv(txList: Transaction[], accounts: BankAccount[], categories: Category[]): string`
    - `buildBalancesCsv(accounts: BankAccount[], transactions: Transaction[], asOfDate: string): string`
    - `exportCsvFiles(params: { transactions: Transaction[]; allTransactions: Transaction[]; accounts: BankAccount[]; categories: Category[]; scope: 'all' | 'filtered' | 'bank'; bankName?: string; todayIso?: string }): Promise<{ method: 'share' | 'download' | 'cancelled'; files: [string, string] }>`
  - `backup.ts`:
    - `buildBackupPayload(params: { accounts: BankAccount[]; categories: Category[]; transactions: Transaction[]; settings: AppSettings; exportedAt?: string }): BackupPayload`
    - `downloadJsonBackup(payload: BackupPayload, todayIso?: string): string`

- [ ] **Step 1: Write failing tests in `tests/export/csv.test.ts` and `tests/export/backup.test.ts`**

In `tests/export/csv.test.ts`:
- `buildTransactionsCsv` starts with `"\uFEFF"`, uses `"\r\n"`, has exact header `Date,Type,Direction,Account,Category,Mode,Amount,Signed Amount,Note`, formats decimal rupees (`45.50`), leaves `Category` empty for `deposit`/`transfer`, preserves archived account name and hidden category name, and quotes notes containing commas, quotes, or newlines.
- `buildBalancesCsv` starts with `"\uFEFF"`, has exact header `Account,Status,Starting Balance,Current Balance,As Of Date`, marks archived accounts `"Archived"` and active `"Active"`, and computes `Current Balance` from `allTransactions`.
- `exportCsvFiles` filenames:
  - `scope: 'all'` -> `transactions-2026-11-26.csv` + `bank-balances-2026-11-26.csv`
  - `scope: 'filtered'` -> `transactions-filtered-2026-11-26.csv`
  - `scope: 'bank', bankName: 'SBI Savings'` -> `transactions-sbi-savings-filtered-2026-11-26.csv`
- Review Focus tests for sharing:
  - When `navigator.canShare` returns `true`, calls `navigator.share({ files })` with 2 `File` objects and returns `{ method: 'share', ... }` without triggering `<a>.click()`.
  - When `navigator.share` rejects with `DOMException('AbortError')`, returns `{ method: 'cancelled', ... }` without triggering download fallback.
  - When `navigator.share` is unavailable or rejects with non-AbortError, falls back to Blob URL `<a>.click()` downloads and returns `{ method: 'download', ... }`.

In `tests/export/backup.test.ts`:
- `buildBackupPayload` includes `_note` mentioning `'Paise'`, `schemaVersion: 1`, `exportedAt`, `accounts`, `categories`, `expensePaymentModes`, `transferPaymentModes`, `transactions`.

- [ ] **Step 2: Run export tests to verify they fail**

Run: `npx.cmd vitest run tests/export/`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/export/csv.ts` and `src/export/backup.ts`**

- [ ] **Step 4: Run export tests to verify they pass and commit**

Run: `npx.cmd vitest run tests/export/`
Expected: PASS.

```bash
git add src/export/ tests/export/
git commit -m "feat: add UTF-8 BOM CSV export with Share API fallback and JSON backup"
```

---

### Task 5: App State Context, Shell Navigation & Shared Components

**Files:**
- Create: `src/state/AppContext.tsx`
- Create: `src/components/TopBar.tsx`, `src/components/BottomNav.tsx`, `src/components/Banners.tsx`, `src/components/TransactionRow.tsx`, `src/components/ConfirmDialogs.tsx`
- Test: `tests/components/ShellAndBanners.test.tsx`

**Interfaces:**
- Consumes: `src/domain/*`, `src/storage/db.ts`, `src/export/*`, `@phosphor-icons/react`
- Produces in `src/state/AppContext.tsx`:
  - `AppProvider({ dbName?, children })`
  - `useApp()`: exposes `loading`, `accounts`, `categories`, `transactions`, `settings`, `view`, `selectedBankId`, `selectedMonth`, `filters`, `manageJumpTarget`, `saveBanner`, `statusToast`, `backupDismissed`, plus typed action methods:
    - Navigation & UI: `navigate(view, opts?)`, `openBankHistory(bankId)`, `openRecordForBank(bankId)`, `toggleTheme()`, `setSelectedMonth(ym)`, `setFilters(patch)`, `resetFilters()`, `dismissSaveBanner()`, `dismissToast()`, `dismissBackupReminder()`
    - Transactions: `recordTransaction(input)`, `updateTransaction(tx)`, `deleteTransaction(txId)`
    - Accounts & Categories & Modes: `addAccount(name, startingBalancePaise)`, `renameAccount(id, name)`, `adjustAccountBalance(id, desiredBalancePaise)`, `setAccountArchived(id, archived)`, `addCategory(name)`, `renameCategory(id, name)`, `setCategoryHidden(id, hidden)`, `addCustomPaymentMode(txType: 'expense' | 'transfer', mode: string)`
    - Export & Backup: `exportCsv(scope: 'all' | 'filtered' | 'bank', txList: Transaction[], bankName?: string)`, `downloadBackup()`, `restoreBackup(payload: BackupPayload)`
- Produces components:
  - `TopBar({ title, showBack?, onBack?, rightAction? })`
  - `BottomNav({ currentView, onSelectHome, onSelectRecord })`
  - `Banners()`
  - `TransactionRow({ tx, hideAccount?, onSelect })`
  - `ArchiveConfirmDialog`, `RestoreConfirmDialog`

- [ ] **Step 1: Write failing tests in `tests/components/ShellAndBanners.test.tsx`**

Test:
- `BottomNav` marks `Home` `aria-current="page"` when `currentView` is `'home'` or `'bank-tx'`, and marks `Record` `aria-current="page"` when `'record'`.
- `TopBar` renders `<h1>` with title, optional `←` button (`aria-label="Back to Home"`), and Light/Dark theme toggle button that flips `document.documentElement.getAttribute('data-theme')`.
- `TransactionRow` renders green `+₹...` with `Deposit` pill for deposit, `Transfer In` / `Transfer Out` with `Incoming` / `Outgoing` pill for transfers, category name for expense, and hides account name when `hideAccount` is true.

- [ ] **Step 2: Run shell tests to verify they fail**

Run: `npx.cmd vitest run tests/components/ShellAndBanners.test.tsx`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `AppContext.tsx` and the 5 shared components**

Ensure `AppProvider` syncs `document.documentElement.setAttribute('data-theme', settings.theme)` and `<meta name="theme-color">` (`#F8FAFC` light / `#0B0F17` dark), uses `@phosphor-icons/react` outline icons (`House`, `PlusCircle`, `SlidersHorizontal`, `Moon`, `Sun`, `ArrowLeft`, `CaretLeft`, `CaretRight`, `ShareNetwork`, `Check`, `Warning`), and updates `lastBackupOrExportAt` / `changesSinceLastBackup` on non-cancelled exports and backups.

- [ ] **Step 4: Run shell tests to verify they pass and commit**

Run: `npx.cmd vitest run tests/components/ShellAndBanners.test.tsx`
Expected: PASS.

```bash
git add src/state/AppContext.tsx src/components/TopBar.tsx src/components/BottomNav.tsx src/components/Banners.tsx src/components/TransactionRow.tsx src/components/ConfirmDialogs.tsx tests/components/ShellAndBanners.test.tsx
git commit -m "feat: add AppContext state provider, Android shell chrome, and shared components"
```

---

### Task 6: Home & Bank Account History Views

**Files:**
- Create: `src/views/HomeView.tsx`, `src/views/BankHistoryView.tsx`
- Test: `tests/components/HomeAndBankFlow.test.tsx`

**Interfaces:**
- Consumes: `useApp()`, `TopBar`, `Banners`, `TransactionRow`, `EditTransactionDialog` (wired via callback `onEditTx(id)`)
- Produces:
  - `HomeView({ onEditTx: (id: string) => void })`
  - `BankHistoryView({ onEditTx: (id: string) => void })`

- [ ] **Step 1: Write failing tests in `tests/components/HomeAndBankFlow.test.tsx`**

Test against `AppProvider` with a unique `dbName` per test:
- First-run state with 0 accounts renders `"No bank accounts added yet"` and `"+ Add Your First Bank Account"` button (and NO sample accounts/balances).
- With 2 active accounts + 1 archived account:
  - `HomeView` renders `Total Balance` equal to the sum of active accounts only, lists only active accounts, and does NOT render an Export button on `Home`.
  - `"Where You Spent Most"` defaults to current month, switches month on Previous/Next button clicks, and aggregates ONLY `Expense` transactions (ignoring `Deposit` and `Transfer` amounts).
  - `"Last 10 Transactions"` renders at most 10 entries newest-first and includes `"Show All →"`.
- Tapping an active account row opens `BankHistoryView` for that account showing its `Current Balance`, entry count, `"+ Record"` button, `"Export (N)"` button in TopBar, and only that bank's transactions; tapping `"+ Record"` navigates to `Record` pre-selected to that bank.

- [ ] **Step 2: Run Home & Bank tests to verify they fail**

Run: `npx.cmd vitest run tests/components/HomeAndBankFlow.test.tsx`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/views/HomeView.tsx` and `src/views/BankHistoryView.tsx`**

Match exact layout, headings, button labels, and classes (`card-flush`, `balance-hero num`, `account-row-btn`, `spend-track`, `spend-fill-lead`) from `docs/superpowers/specs/ui-reference.html` lines 723–815.

- [ ] **Step 4: Run Home & Bank tests to verify they pass and commit**

Run: `npx.cmd vitest run tests/components/HomeAndBankFlow.test.tsx`
Expected: PASS.

```bash
git add src/views/HomeView.tsx src/views/BankHistoryView.tsx tests/components/HomeAndBankFlow.test.tsx
git commit -m "feat: implement Home dashboard and Bank Account History views"
```

---

### Task 7: Record View, All Transactions View & Edit Transaction Dialog

**Files:**
- Create: `src/views/RecordView.tsx`, `src/views/AllTransactionsView.tsx`, `src/components/EditTransactionDialog.tsx`
- Test: `tests/components/RecordView.test.tsx`, `tests/components/AllTransactionsAndEdit.test.tsx`

**Interfaces:**
- Consumes: `useApp()`, `TopBar`, `Banners`, `TransactionRow`, `validateTransactionAmount`, `getTodayLocalISO`
- Produces:
  - `RecordView({ preselectedAccountId?: string | null })`
  - `AllTransactionsView({ onEditTx: (id: string) => void })`
  - `EditTransactionDialog({ txId: string | null; onClose: () => void })`

- [ ] **Step 1: Write failing tests in `tests/components/RecordView.test.tsx` and `tests/components/AllTransactionsAndEdit.test.tsx`**

In `tests/components/RecordView.test.tsx`:
- With zero active accounts, displays `"Add a bank account first"` prompt.
- 3-way toggle (`Expense`, `Deposit`, `Transfer`):
  - `Expense` shows Category pills + Expense Payment Mode pills (`GPay` default, `Cash`, `Card`, `+ Add New`).
  - `Deposit` hides Category pills and shows Mode of Deposit (`Cash` default, `Cheque`).
  - `Transfer` shows `Outgoing (−)` / `Incoming (+)` sub-toggle and Transfer Payment Mode pills (`GPay` default, `Cash`, `Cheque`, `+ Add New`).
- Clicking `+ Add New` and saving `"NetBanking"` persists `"NetBanking"` in settings and selects it.
- Submitting empty/zero amount shows `"Please enter an amount greater than ₹0."` without saving.
- Submitting valid `Expense` saves to `IndexedDB`, updates bank balance immediately, returns to `Home`, and displays the confirmation banner with `"+ Add another"`.

In `tests/components/AllTransactionsAndEdit.test.tsx`:
- Filters by Date range (`From Date` / `To Date`), `Type`, and `Category` (including hidden categories), updates `Showing X of Y entries` and `Export (X)`, and `Clear` resets all filters.
- Review Focus tests for `EditTransactionDialog`:
  - Editing a historical transaction belonging to an archived account and hidden category preserves both in the `<select>` dropdowns and updates amount/note cleanly.
  - Changing Type from `Expense` (`Card`) to `Deposit` hides Category, updates Mode options to `Cash`/`Cheque`, clears `categoryId`, sets `direction: 'incoming'`, and saves valid `mode: 'Cash'`.
  - Clicking `Delete` opens `"Delete Transaction?"` confirmation (`Keep Entry` / `Delete Entry`), and confirming removes the entry and updates the bank balance.

- [ ] **Step 2: Run Record & AllTransactions tests to verify they fail**

Run: `npx.cmd vitest run tests/components/RecordView.test.tsx tests/components/AllTransactionsAndEdit.test.tsx`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `RecordView.tsx`, `AllTransactionsView.tsx`, and `EditTransactionDialog.tsx`**

Ensure Escape key and backdrop clicks close `EditTransactionDialog` (and its nested Delete confirmation), and pre-selected bank account from `BankHistoryView` overrides `lastUsedAccountId` cleanly for that entry.

- [ ] **Step 4: Run Record & AllTransactions tests to verify they pass and commit**

Run: `npx.cmd vitest run tests/components/RecordView.test.tsx tests/components/AllTransactionsAndEdit.test.tsx`
Expected: PASS.

```bash
git add src/views/RecordView.tsx src/views/AllTransactionsView.tsx src/components/EditTransactionDialog.tsx tests/components/RecordView.test.tsx tests/components/AllTransactionsAndEdit.test.tsx
git commit -m "feat: implement Record form, All Transactions filters, and Edit/Delete dialog"
```

---

### Task 8: Manage & Settings View, App Wiring & Offline Verification

**Files:**
- Create: `src/views/ManageView.tsx`, `src/App.tsx`, `src/main.tsx`
- Test: `tests/components/ManageView.test.tsx`

**Interfaces:**
- Consumes: All views (`HomeView`, `BankHistoryView`, `RecordView`, `AllTransactionsView`, `ManageView`), `AppProvider`, `TopBar`, `BottomNav`, `EditTransactionDialog`, `ConfirmDialogs`
- Produces: Complete runnable PWA entry point (`src/main.tsx` importing `@fontsource/ibm-plex-sans/400.css`, `500.css`, `600.css`, `700.css`, `./styles/tokens.css`, `./styles/app.css`, calling `navigator.storage?.persist?.()`, and registering PWA SW).

- [ ] **Step 1: Write failing tests in `tests/components/ManageView.test.tsx`**

Test:
- Appearance toggle switches theme between Light and Dark and persists across reloads.
- Bank Accounts section: Add account (`ICICI Bank`, `0` or `5000.50`), Rename account, Adjust Balance (computes `startingBalancePaise = desired - net`), Archive zero-balance account immediately, and Archive non-zero-balance account opens `"Archive Account With Balance?"` confirmation dialog before archiving.
- Expense Categories section: Add category, Rename category (updates transaction labels automatically), Hide/Show category (hidden category disappears from `Record` chips while remaining on existing entries).
- Export All (`.csv`) button invokes full export.
- JSON Backup & Restore: `Download Backup` generates JSON backup; uploading valid `.json` file opens `"Restore Backup?"` confirmation with exact counts before replacing IDB state; uploading invalid `.json` shows error toast without wiping data.

- [ ] **Step 2: Run ManageView tests to verify they fail**

Run: `npx.cmd vitest run tests/components/ManageView.test.tsx`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/views/ManageView.tsx`, `src/App.tsx`, and `src/main.tsx`**

Wire `App.tsx` with `.phone-frame`, active view rendering (`HomeView`, `RecordView`, `BankHistoryView`, `AllTransactionsView`, `ManageView`), `BottomNav`, `EditTransactionDialog`, and `manageJumpTarget` scrolling (`#sec-accounts`, `#sec-backup`). In `main.tsx`, import local `@fontsource/ibm-plex-sans` weights `400`, `500`, `600`, `700`, call `navigator.storage?.persist?.().catch(() => {})`, and register `virtual:pwa-register` (`registerSW({ immediate: true })` guarded so tests/non-PWA environments don't break).

- [ ] **Step 4: Run full test suite, TypeScript check, production build & offline asset audit**

Run:
1. `npm.cmd test` — Expected: all unit and component test suites PASS.
2. `npx.cmd tsc --noEmit` — Expected: 0 TypeScript errors.
3. `npm.cmd run build` — Expected: clean `dist/` output containing `index.html`, `manifest.webmanifest`, `sw.js`, bundled `ibm-plex-sans` `.woff2` fonts, and relative `./` asset paths (`Select-String -Path dist\index.html -Pattern "https?://"` returns no matches).

- [ ] **Step 5: Commit**

```bash
git add src/views/ManageView.tsx src/App.tsx src/main.tsx tests/components/ManageView.test.tsx
git commit -m "feat: implement Manage & Settings view and wire offline PWA shell"
```

---

## Self-Review Checklist (Verified Against Spec & UI Reference)

- **Spec coverage:** Every section of `docs/superpowers/specs/2026-11-26-mom-expense-tracker-design.md` (§2 Goals, §3 Constraints, §5 Navigation, Home, Bank Account History, Record, All Transactions, Manage/Settings, Data Model, Export Format, §6 Tech Stack & Soft Cards UI) maps to Tasks 1–8.
- **UI fidelity:** Exact tokens, radii, touch target minimums, tabular numerals, Soft Cards Unified Balances + Ledger rows, Month Switcher, Mode pills + inline `+ Add New`, and centered dialogs match `docs/superpowers/specs/ui-reference.html`.
- **Type & signature consistency:** `BankAccount`, `Category`, `Transaction`, `AppSettings`, `FilterState`, `BackupPayload`, and domain/storage/export functions share identical names and signatures across all task `Interfaces` blocks.
- **Review Focus coverage:** All 5 failure modes (local IST date, archived/hidden preservation, edit type-switch mode/category normalization, corrupt backup rejection, `AbortError` share cancellation) have explicit tests in Tasks 2, 3, 4, and 7.
