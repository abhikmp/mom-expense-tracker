# App PIN Lock & Sensitive Data Protection — Design Document

> **Status:** Approved
> **Issue:** [#4 — Password protection for the app](https://github.com/abhikmp/mom-expense-tracker/issues/4)
> **Interactive Prototype:** [pin-lock-prototype.html](pin-lock-prototype.html)

## 1. Intent & Why

Protect Mom's Expense Tracker against casual snooping when someone picks up the phone, without adding friction to her most frequent action: logging a quick expense. Whole-app startup locking is intentionally left to Android's native App Lock for users who want it; inside the app, **Record** stays immediately usable while balances, spending breakdowns, transaction history, account management, and exports stay hidden behind a 4–6 digit PIN.

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Keep opening the app and recording transactions (**Expense**, **Deposit**, **Transfer**) completely frictionless with zero PIN prompt.
- Hide all sensitive financial information (balances, monthly spending breakdown, recent transactions, full/bank histories, and CSV/JSON exports) when a PIN is enabled and the session is locked.
- Unlock all protected views and actions together for the session after entering a **4–6 digit numeric PIN**.
- Automatically re-lock only when the user leaves the app (on app close/reload, or after being in the background for **more than 1 minute**), plus a manual **Lock** button in the top bar when unlocked.
- Support self-service PIN recovery via a **Master Password** (≥ 8 characters) set during initial PIN setup.
- Preserve 100% of existing IndexedDB data across PWA updates; existing installs with no PIN configured remain unlocked and unchanged until PIN Lock is set up in **Manage & Settings**.

### Non-Goals
- Encrypting IndexedDB records at rest (incompatible with reading bank account names and writing new transactions from **Record** while locked).
- Full-app startup lock screen blocking **Record** on launch.
- Biometric/WebAuthn unlock or cloud/email password reset.
- A separate "Change Master Password" flow in **Manage & Settings** (turning off PIN clears both PIN and Master Password; re-enabling sets them fresh).

### Anti-Goals
- Forcing a PIN setup modal on existing users after updating.
- Showing `(₹ balance)` chips inside **Record** or transaction counts / backup reminders on **Home** while locked.
- Storing plaintext PINs or Master Passwords in IndexedDB, `localStorage`, or JSON backups.

## 3. Approaches Considered

| Approach | How It Works | Trade-offs | Verdict |
|---|---|---|---|
| **A. Dedicated `security` IndexedDB store (`DB_VERSION = 2`) + Web Crypto PBKDF2 hashes + `AppContext` lock state** | Adds an isolated `security` object store in `src/storage/db.ts` storing salted PBKDF2-SHA256 hashes for PIN and Master Password. `AppContext` manages `hasPin`, `isUnlocked`, background timestamp, and failed-attempt cooldown; views mask/gate sensitive sections when locked. | Cleanly separated from `AppSettings` and `BackupPayload`, preserves existing `dbName`-isolated test architecture, and upgrades v1 → v2 additively without touching existing data. | **Selected** |
| **B. Store PIN & Master Password fields inside `AppSettings` (`settings` store)** | Adds optional credential fields to `AppSettings` (`DB_VERSION = 1`). | Avoids DB version bump, but mixes security credentials into general settings read/written on every transaction (`createTransactionAtomic`) and risks accidental coupling with backups. | Not selected |
| **C. Store credentials in `localStorage` with a separate `SecurityProvider`** | Reads/writes hashes synchronously in `localStorage`. | Splits persistence across two storage APIs (`IndexedDB` + `localStorage`) and complicates `dbName`-isolated unit/component testing. | Not selected |
| *Dropped: Encrypting IndexedDB with the PIN* | Encrypts accounts and transactions at rest using a PIN-derived key. | Directly breaks frictionless **Record** entry without unlocking, since account names must be read and transactions written while locked. | Dropped |

## 4. Architecture & Data Design

### 4.1 IndexedDB Schema & Upgrade (`src/storage/db.ts`)
- Bump `DB_VERSION` from `1` to `2`.
- In `upgrade(db)`:
  - Keep existing `accounts`, `categories`, `transactions`, and `settings` stores untouched.
  - Create a `security` object store (`{ keyPath: 'key' }`) if `!db.objectStoreNames.contains('security')`.
- Store a single record under key `'lock'`:
  - `key: 'lock'`
  - `pinHash`: salted PBKDF2-SHA256 hash + salt (and iteration/algorithm metadata)
  - `masterPasswordHash`: salted PBKDF2-SHA256 hash + salt
  - `updatedAt`: ISO timestamp
- `hasPin` is `true` if and only if a valid `'lock'` record exists in `security`.
- **Backups (`src/export/backup.ts` & `restoreBackupAtomic`):**
  - `BackupPayload` never exports `security` records.
  - `restoreBackupAtomic` does **not** clear or overwrite the `security` store when restoring data, so the device's PIN remains active and restoring on another device does not carry over an old PIN.

### 4.2 Credential Hashing & Validation
- Use Web Crypto (`crypto.subtle` PBKDF2 with SHA-256 and a random 16-byte salt per secret) to hash and verify both the PIN and Master Password.
- **PIN rules:** Numeric digits only, 4 to 6 digits (`^\d{4,6}$`).
- **Master Password rules:** Any characters, minimum length 8 (`value.length >= 8`; no character-class restrictions).
- **Input UI:** Use masked numeric text inputs (`type="password"`, `inputMode="numeric"`, `pattern="[0-9]*"`, `autoComplete="off"`) using the device's built-in numeric keyboard with an explicit submit button (**Unlock** / **Save** / **Continue**). Master Password inputs use standard text password inputs with a show/hide toggle.

## 5. Lock Lifecycle & Session Rules

1. **Startup state:**
   - If `hasPin === false`, the app is unlocked (`isLocked = false`) with no lock UI.
   - If `hasPin === true`, the app always starts locked (`isLocked = true`) on initial load or page reload.
2. **Unlocking:**
   - Entering the correct PIN sets `isUnlocked = true` for the entire app session (unlocking Home balances, spending, recent transactions, Bank History, All Transactions, and Manage & Settings together) and reveals the screen immediately **without** showing an `"Unlocked for this session"` toast banner.
3. **Re-locking triggers (when `hasPin === true` and `isUnlocked === true`):**
   - **Manual Lock:** Tapping the **Lock** button in the top bar (shown when `hasPin && isUnlocked`) immediately locks (`isUnlocked = false`).
   - **App close / reload:** Session state resets to locked on fresh load.
   - **Backgrounded > 1 minute:** Track `backgroundedAt` using `visibilitychange` (`document.visibilityState === 'hidden'`) and `pagehide`. When the app becomes visible again, if `backgroundedAt !== null` and `Date.now() - backgroundedAt > 60_000`, lock immediately; otherwise clear `backgroundedAt` and stay unlocked.
   - **No active-use idle timer:** Staying inside the app never auto-locks regardless of inactivity.
4. **Cleanup when locking (`lockApp`):**
   - Close any open `EditTransactionDialog` (`editingTxId = null`) and any sensitive confirmation dialogs (`ArchiveConfirmDialog`, `RestoreConfirmDialog`).
   - Clear any pending delete-undo state (`lastDeletedTx`) so deleted entry details cannot be restored or seen while locked.
   - If currently on `'bank-tx'` or `'all'`, navigate to `'home'` and clear `selectedBankId`.
   - If on `'record'` or `'manage'` or `'home'`, remain on the current view in its locked/masked presentation.

## 6. Screen-by-Screen Behavior (When `isLocked === true`)

- **Default landing screen:** App continues to land on **Home** on startup.
- **Home (`HomeView.tsx` & `Banners.tsx`):**
  - **Banners:** Hide the backup reminder banner (`isBackupReminderDue`) while locked so entry counts and backup prompts are not exposed.
  - **Content:** Replace **Total and Bank Account Balances**, **Where You Spent Most**, and **Last 10 Transactions** with a single locked card explaining that financial details are hidden, with one **Unlock** button that opens the Unlock modal.
  - Bottom navigation (**Home** | **Record**) and top-bar **Manage** + Theme toggle remain accessible.
- **Record (`RecordView.tsx` & `AppContext.tsx`):**
  - Opens and submits normally without prompting for a PIN.
  - Bank account selector chips display **only the account name** (omitting the `(₹ balance)` suffix shown when unlocked).
  - **Post-save behavior when locked:** Saving a transaction keeps the user on **Record** (does not navigate to **Home**), resets the entry form, and shows the **2-second** save confirmation banner (`Saved ...`). When unlocked, existing post-save navigation to **Home** is unchanged.
- **Bank History (`BankHistoryView.tsx`) & All Transactions (`AllTransactionsView.tsx`):**
  - Both screens are gated while locked: if rendered while locked, display a locked card with an **Unlock** button and **Back to Home** instead of balances, transactions, or **Export** buttons.
- **Manage & Settings (`ManageView.tsx`):**
  - **Appearance** (Light/Dark toggle), **PIN Lock**, and the **Version** footer remain visible and usable while locked.
  - **Bank Accounts**, **Expense Categories**, **Spreadsheet Export (.csv)**, and **Backup & Restore (.json)** are hidden behind a single locked card with an **Unlock** button.

## 7. Unlock, Setup, Change, Disable & Recovery Flows

- **Unlock Modal:**
  - Prompts for the 4–6 digit PIN with **Unlock**, **Cancel**, and **Forgot PIN?** actions.
  - **Wrong PIN:** Display an inline error (`Incorrect PIN. Please try again.`) and clear the PIN field.
  - **Failed-attempt cooldown:** After **5 consecutive wrong PIN attempts**, disable PIN submission for **30 seconds** with a visible countdown message; **Forgot PIN?** remains immediately accessible without waiting for the cooldown. A successful unlock or Master Password PIN reset clears the failed-attempt counter and cooldown.
- **Forgot PIN? (Master Password Recovery):**
  - Switches to a Master Password prompt (`Enter Master Password`, with show/hide toggle).
  - Wrong Master Password displays an inline error and clears the input.
  - Correct Master Password clears failed-attempt state, unlocks the session (`isUnlocked = true`), and transitions straight to **Set New PIN** (enter new 4–6 digit PIN twice + **Save PIN**), preserving the existing Master Password.
- **PIN Lock Section in Manage & Settings:**
  - **When PIN is OFF:** Shows **Set Up PIN** button → modal/flow requiring:
    1. New PIN (4–6 digits) + Confirm New PIN (must match)
    2. Master Password (≥ 8 characters, with show/hide toggle) + Confirm Master Password (must match)
    3. Saving stores the `'lock'` record in IndexedDB and keeps the session unlocked.
  - **When PIN is ON:** Shows **Change PIN** and **Turn Off PIN** buttons:
    - **Change PIN:** Prompts for Current PIN (with **Forgot PIN?** escape hatch), then New PIN + Confirm New PIN (4–6 digits, must match). Updates `pinHash` while keeping `masterPasswordHash`, and sets `isUnlocked = true`.
    - **Turn Off PIN:** Prompts for Current PIN. Upon verification, deletes the `'lock'` record from `security` (clearing both PIN and Master Password), leaving the app unlocked (`hasPin = false`). Re-enabling later runs the full **Set Up PIN** flow again.

## 8. Banner, Toast & Delete Undo Behavior

Refinements validated in [pin-lock-prototype.html](pin-lock-prototype.html):

- **Transaction save banner (`Saved ...`):** Auto-dismisses after **2 seconds** (`2000` ms), with `+ Add another` and `Dismiss` actions.
- **General status toasts** (e.g., PIN enabled/updated/disabled, transaction restored, lock/export notices): Auto-dismiss after **2 seconds** (`2000` ms).
- **Unlocking via PIN:** Unlocks directly with **no** banner or toast shown.
- **Transaction delete banner (`Transaction deleted and balances updated.`):**
  - Uses red destructive styling (`--color-destructive-bg`, `--color-destructive-border`, `--color-destructive-ink`) with a red **Undo** button (`btn-danger-fill`) next to **Close**.
  - Stays visible for **4 seconds** (`4000` ms) before auto-dismissing.
  - Tapping **Undo** within the 4-second window restores the deleted transaction in IndexedDB/state, recalculates balances, and displays a **2-second** confirmation toast.

## 9. Left to the Builder

- Exact component decomposition (`PinModal`, `security` DB/crypto helpers), CSS styling reusing existing `Soft Cards` tokens, modal focus trapping + `Escape` dismissal + opener focus restoration, exact Lock button placement so narrow 375px headers (like **All Transactions** with **Export**) avoid awkward title truncation, and unit/component test layout in `tests/`.
