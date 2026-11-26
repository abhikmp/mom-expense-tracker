# Mom's Expense & Bank Account Tracker — Design Document

> **Status:** Finalized — Functional, data, export, PWA architecture, and **Soft Cards (Android Phone-Only + Light/Dark Theme)** UI/UX design approved and ready for implementation.

## 1. Intent & Why

Build a simple, calm, clutter-free personal expense and bank account tracker for the user's mother on her Android phone. Because she is not technical, the app must avoid complex budgeting features, account logins, or crowded menus. She primarily wants to open the app to see how much money is left in each bank account, check where she has spent the most, and quickly record expenses, cash deposits, and transfers. Periodically, her child (the user) needs to export her records as a Google Sheets / Excel-compatible spreadsheet for review.

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **At-a-glance balances:** Open directly to a `Home` dashboard showing total balance across all active accounts and the current balance of each active bank account.
- **Top spending visibility:** Show where she spent the most (ranked by category, defaulting to the current month with a month switcher).
- **Frictionless recording:** A dedicated `Record` tab with a 3-way toggle (**Expense**, **Deposit**, **Transfer** with **Outgoing / Incoming**) and large, tappable controls.
- **History & mistake recovery:** Show the last 10 transactions on `Home`, with an **All Transactions** view supporting filters by **date range**, **category**, and **transaction type**, plus tap-to-edit/delete so typos never permanently corrupt balances.
- **Spreadsheet export & sharing:** One-tap generation of Excel- and Google Sheets-compatible UTF-8 BOM `.csv` files (`transactions` + `bank-balances`), using Android's native Share sheet (`navigator.share` with files) when available so she can send them directly over WhatsApp/Email, with file download fallback. Placed in **All Transactions** (filtered) and **Manage / Settings** (full export) to keep `Home` clean.
- **On-device privacy:** All data lives locally on her Android phone with zero accounts, passwords, or backend servers.

### Non-Goals
- Automatic bank SMS parsing, bank API / Account Aggregator syncing, or UPI app integration.
- Multi-user cloud sync, real-time family sharing, or login/authentication.
- Budgeting limits, recurring bill reminders, investment tracking, loans, or split-bill features.
- Reconciling transfers between two of her own accounts as a single linked pair (transfers are recorded against one chosen bank account as either Incoming or Outgoing).

### Anti-Goals (What Would Make This a Failure)
- Cluttered forms requiring lots of typing or tiny controls hard to tap on a phone.
- Requiring internet access or sign-in just to check a balance or log an expense.
- Silent balance drift with no way to edit/delete a mistaken entry or adjust an account's balance.
- Losing all data on an accidental tap with no export/backup path.

## 3. Constraints

- **Target device:** Android phone (phone-only PWA layout, `max-width: 430px` centered frame on larger viewports, full-bleed on phones — mobile Chrome / PWA installed via "Add to Home Screen").
- **User profile:** Non-technical, uses the app independently day to day.
- **Language & Currency:** English UI; Indian Rupees (`₹` / `INR`) using Indian digit grouping (`en-IN`), allowing decimal paise inputs while hiding `.00` on whole-rupee display.
- **Data residency:** Local on-device storage (`IndexedDB`), no backend server or cloud database.
- **Offline reliability:** Zero runtime external network requests (all code, Phosphor icons, and `IBM Plex Sans` fonts bundled locally); silent `navigator.storage.persist()` request on startup to reduce browser storage eviction risk.
- **Deployment model:** Static files with relative asset paths (`base: './'`) hosted on any free HTTPS static host such as GitHub Pages, built from a dedicated Git repository inside `mom-expense-tracker/`.

## 4. Approaches Considered

| Approach | How It Works | Trade-offs | Verdict |
|---|---|---|---|
| **1. Installable Offline Web App (PWA)** | Static HTML/CSS/JS app hosted on HTTPS (e.g., GitHub Pages), installed to Android home screen via Chrome, backed by on-device `IndexedDB` and a Service Worker for offline use. | Fastest to build and iterate; easy to update without sideloading; zero Android SDK required. Requires HTTPS static host for home-screen install; clearing Chrome site data could clear local storage unless backed up/exported. | **Selected** |
| **2. Native Android App (`.apk` — Kotlin + Jetpack Compose + SQLite)** | Compiled `.apk` sideloaded onto her phone with private SQLite storage and native Android Share sheet for sending exports. | Immune to browser cache clearing; zero web hosting; native Share menu. Requires Android SDK/Gradle toolchain, enabling "Install unknown apps", and re-sideloading for updates. | Not selected |
| **3. Packaged Web-to-Android App (`.apk` via Capacitor)** | Web UI wrapped in a native Android shell `.apk`. | Combines web UI agility with standalone `.apk` storage. Still requires Android build toolchain and sideloading to update. | Not selected |
| *Dropped: Cloud Web App / Google Forms* | Remote backend with accounts, or Google Forms feeding a Sheet. | Cloud backend adds hosting/login friction against "lives in her own system"; Google Forms cannot provide an offline, live local dashboard with per-bank balances. | Dropped |

## 5. Product Behavior & Architecture

### Navigation Structure
Two primary Android bottom navigation tabs (with `56×30px` active indicator pill around outline icons):
1. **`Home`** (default launch tab — dashboard)
2. **`Record`** (transaction entry form)

Plus three secondary views reachable from `Home` (each featuring an Android `←` back button and Light/Dark theme toggle in the Top App Bar):
- **Bank Account History** (opened by tapping any bank account row inside the Balances card on `Home`)
- **All Transactions** (opened via **Show All →** on `Home`)
- **Manage / Settings** (opened via the **Manage** button in the `Home` Top App Bar, or **+ Add / Edit** on the Balances card which jumps directly to Bank Accounts)

### Tab 1: `Home` (Dashboard)
1. **Android Top App Bar:** Shows `Expenses`, **Manage** trigger, and **Light / Dark Theme toggle** (`Sun` / `Moon` icon, persisted locally).
2. **First-Run Empty State:** On first launch with zero bank accounts, displays a clean welcome prompt to **+ Add Your First Bank Account** with no sample/demo data that could be confused with real money.
3. **Backup Reminder Banner:** Tracks the timestamp/count since the last `.csv` export or `.json` backup and shows a gentle, dismissible reminder banner when 30+ days or 25+ new transactions have passed.
4. **Unified Balances Card (`Soft Cards` container + Ledger rows):** Displays **Total Balance** (sum of all active bank accounts, **no Export button on `Home`**) and **+ Add / Edit** at the top of the card, followed by hairline-separated rows for each active bank account showing its name and remaining balance (archived accounts hidden and excluded from Total Balance). **Tapping any bank row** opens **Bank Account History** for that account.
5. **Where You Spent Most:** Ranked horizontal bars/list of **Expense** totals by category for the selected month (defaults to current month, with previous/next month switcher). Strictly aggregates `Expense` transactions; `Deposit` and `Transfer` (Incoming/Outgoing) are excluded so they do not distort spending categories.
6. **Last 10 Transactions:** Most recent 10 transactions (across all types), newest first, showing primary label (category or transfer direction), account + payment/deposit mode + note subtitle, date, and signed amount (`-` in crisp primary ink for Expense/Outgoing Transfer, `+` in green for Deposit/Incoming Transfer). Includes a **Show All →** trigger.

### Secondary View: Bank Account History (from tapping a bank row)
- Top App Bar shows the **Bank Account Name**, `←` back to `Home`, **Export (N)** `.csv` trigger (exports that bank's transactions + bank balances summary), and theme toggle.
- Balance Summary Card shows Current Balance, recorded entry count, and a **`+ Record`** button that opens `Record` pre-selected to that bank account.
- Chronological newest-first list of all transactions belonging to that bank account, with tap-to-edit/delete updating balances immediately.

### Tab 2: `Record` (Transaction Entry)
- If zero active bank accounts exist, prompts Mom to add a bank account first before saving.
- **3-way Transaction Type toggle** at top (with clear microcopy so buying via Google Pay goes under Expense):
  - **Expense** — anything she spends money on / buys, including shop or grocery payments via Google Pay/UPI → **subtracts** from selected bank account.
  - **Deposit** — cash or cheque deposited into her bank account → **adds** to selected bank account.
  - **Transfer** — money sent to or received from someone else's account → reveals **Outgoing (-)** / **Incoming (+)** sub-toggle; Outgoing subtracts, Incoming adds.
- **Fields:**
  - **Amount:** Large numeric input (`inputmode="decimal"`), entered in rupees (e.g., `45.50` or `500`), required, > 0.
  - **Bank Account:** Pill buttons for each active bank account (required); defaults to the most recently used active bank account (or the pre-targeted bank when opened from Bank Account History).
  - **Category (shown only for Expense):** Pill buttons for visible Expense categories (defaults: *Groceries, Bills, Medical, Household, Travel, Other*; customizable in **Manage / Settings**).
  - **Payment Mode (shown for Expense and Transfer):**
    - Under **Expense**, defaults to 3 pills: **`GPay`** (default), **`Cash`**, **`Card`**, plus **`+ Add New`** to add and persist custom modes inline.
    - Under **Transfer**, defaults to 3 pills: **`GPay`** (default), **`Cash`**, **`Cheque`**, plus **`+ Add New`** to add and persist custom modes inline.
  - **Mode of Deposit (shown only for Deposit):** Pill buttons **`Cash`** (default) and **`Cheque`**.
  - **Date:** Defaults to Today; editable via native date picker.
  - **Note:** Optional short text (e.g., *"GPay to Ravi"*, *"Pharmacy"*).
- **Save behavior:** Saves entry atomically in `IndexedDB`, updates computed balances immediately, and returns automatically to `Home` with a clear confirmation banner (including a quick **+ Add another** link).

### All Transactions View (from `Show All →`)
- Lists all transactions newest-first (including historical transactions belonging to archived accounts or hidden categories).
- **Filters:**
  - **Date range** (From date / To date)
  - **Transaction type** (`All`, `Expense`, `Deposit`, `Transfer - Outgoing`, `Transfer - Incoming`)
  - **Category** (`All`, plus expense categories including hidden categories that have historical entries; applies to Expenses)
- **Edit / Delete:** Tapping any transaction opens an edit dialog allowing updates to its fields (amount, type, direction, bank account, category, payment/deposit mode, date, note) or deleting it (with an explicit confirmation prompt before deleting), immediately recalculating affected bank account balance(s). Archived bank accounts remain selectable when editing historical entries so Mom is not forced to switch accounts.
- **Export:** Exports the **currently filtered transactions** plus the **Bank Balances summary** as two `.csv` files (via Android Share sheet when supported, or file download fallback).

### Manage / Settings View (from header `Manage` or `+ Add / Edit`)
Consolidates secondary management and export/backup tools so `Home` and `Record` remain uncluttered:
- **Appearance:** Toggle between **Light** and **Dark** theme (in addition to the Top App Bar toggle).
- **Bank Accounts:** Add a new bank account (name + starting/current balance), rename an existing account, adjust current balance (`startingBalancePaise = desiredBalancePaise - netTransactionsPaise`), or archive/unarchive an account (warns before archiving if remaining balance ≠ ₹0).
- **Categories:** Add, rename, or hide Expense categories. Transactions store a stable `categoryId`, so renaming updates past records and reports automatically, while hiding removes a category only from `Record` chips (preserving past labels, `All Transactions` filters, and `.csv` exports).
- **Export All:** Exports **all transactions** plus the **Bank Balances summary** as two `.csv` files.
- **JSON Backup & Restore:** **Download Backup** and **Restore Backup** actions. Backup files include a top-level `_note` field explaining `*Paise` units, `schemaVersion`, `exportedAt`, `accounts`, `categories`, custom `expensePaymentModes` / `transferPaymentModes`, and `transactions`. Restoring validates the file structure and displays an explicit confirmation dialog with record counts before overwriting local `IndexedDB` data.

### Data Model & Balance Integrity
- **Monetary unit (`*Paise`):** All monetary amounts (`startingBalancePaise`, `amountPaise`) are stored and computed internally as **integer paise** (`Math.round(rupees * 100)`) to eliminate JavaScript floating-point drift. Conversion to/from decimal rupees happens strictly at input, display, and `.csv` export boundaries.
- **BankAccount:** `id`, `name`, `startingBalancePaise`, `createdAt`, `archived` (boolean, so hiding an old account preserves historical transactions).
- **Category:** `id`, `name`, `hidden` (boolean), `sortOrder`, `isDefault`.
- **Transaction:** `id`, `type` (`expense` | `deposit` | `transfer`), `direction` (`outgoing` | `incoming` — explicit for `transfer`, implied for `expense`/`deposit`), `amountPaise` (positive integer), `accountId`, `categoryId` (nullable, used for `expense`), `mode` (string: payment mode for `expense`/`transfer`, deposit mode for `deposit`), `date` (`YYYY-MM-DD`), `note`, `createdAt`, `updatedAt`.
- **Settings / Preferences (local `IndexedDB`):** `theme` (`light` | `dark`), `expensePaymentModes` (default `["GPay", "Cash", "Card"]`), `transferPaymentModes` (default `["GPay", "Cash", "Cheque"]`), `depositModes` (`["Cash", "Cheque"]`), `lastUsedAccountId`, `lastBackupOrExportAt`, `changesSinceLastBackup`.
- **Balance computation:** Derive each account's current balance as `startingBalancePaise + sum(deposits + incoming transfers) - sum(expenses + outgoing transfers)` rather than storing a separate mutable cached balance. This prevents drift when transactions are edited, deleted, or moved between accounts.

### Export Format
- Generates **two UTF-8 BOM `.csv` files** (so Excel and Google Sheets handle `₹` and special characters cleanly while keeping each file a pure rectangular table):
  1. `transactions-YYYY-MM-DD.csv` (or `transactions-filtered-YYYY-MM-DD.csv` from **All Transactions**, or `transactions-<bank>-filtered-YYYY-MM-DD.csv` from **Bank Account History**): `Date`, `Type`, `Direction`, `Account`, `Category`, `Mode`, `Amount`, `Signed Amount`, `Note` (amounts formatted as decimal rupees, e.g., `45.50`).
  2. `bank-balances-YYYY-MM-DD.csv`: `Account`, `Status`, `Starting Balance`, `Current Balance`, `As Of Date`.
- Sharing prefers `navigator.share({ files })` on Android Chrome with automatic fallback to standard browser file downloads.

## 6. Tech Stack & Finalized UI/UX Specification

### Settled Technical Choices
- **Frontend stack:** Vite + React + TypeScript.
- **Offline & storage:** `vite-plugin-pwa` (Workbox precaching) + `idb` for `IndexedDB`, plus `@fontsource/ibm-plex-sans` and `@phosphor-icons/react` bundled locally for zero runtime network calls.
- **PWA identity:** App name `"Mom's Expense Tracker"`, short name `"Expenses"`, standalone display mode, bundled local assets only.
- **Repository & build:** Dedicated Git repository inside `mom-expense-tracker/` with Vite `base: './'` for static HTTPS deployment.

### Finalized UI/UX Design (`Soft Cards` — Phone-Only Android Layout)
- **Visual & Interaction Reference Snapshot:** [ui-reference.html](./ui-reference.html) — Self-contained interactive reference of the approved **Soft Cards** UI (Light & Dark themes, CSS custom properties, spacing/radii, unified Balances card, Bank Account History view, Payment/Deposit mode pills, and Android navigation shell). During implementation, match the layout, spacing, contrast, and token values in `ui-reference.html` directly (adapting inline icons to `@phosphor-icons/react` and font loading to `@fontsource/ibm-plex-sans` for zero runtime network calls).
- **Visual System:** Minimalist Swiss finance aesthetic with calm `Soft Cards` geometry (`20px` card radius, `14px` control radius, `999px` pill chips/toggles, `1px` borders, zero shadows or gradients at rest).
- **Phone-Only Android Shell:** `max-width: 430px` centered stage on wide screens and full-bleed on phones (`100dvh`), `60px` Top App Bar, `16px` horizontal gutters, `48dp+` interactive touch targets (`>= 8px` spacing), Android bottom navigation bar with `56×30px` icon pill indicator, and `env(safe-area-inset-*)` support.
- **Light & Dark Themes (WCAG AA >= 4.5:1 across all text & numbers):**
  - *Light (default):* `#F8FAFC` ground, `#FFFFFF` card, `#020617` ink, `#475569` secondary ink (`~7.4:1`), `#E2E8F0` border, `#0F172A` primary CTA, `#1E3A8A` leading spending bar, `#166534` / `#DCFCE7` positive inflow signal.
  - *Dark:* `#0B0F17` ground, `#131A26` card, `#232D3F` border, `#F8FAFC` ink, `#B6C2D2` secondary ink (`~8.5:1`), `#F8FAFC` / `#0F172A` primary CTA, `#5B9BF8` leading spending bar, `#4ADE80` / `#143322` positive inflow signal.
- **Typography & Numeric Legibility:** Local `"IBM Plex Sans"` (`400/500/600/700`) with `font-variant-numeric: tabular-nums` on every currency value, date, and counter. Sizes: `32px` lead balance, `20px` Top App Bar `<h1>`, `17px` row amounts, `16px` primary labels/inputs, **`13px–14px` minimum** for secondary metadata and dates (`12px` floor for compact pills).
- **Motion Craft:** `0ms` instant tab switches (`Home` ↔ `Record`), `140ms` `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`) `scale(0.97)` press states, `200ms` centered dialogs (`scale(0.96) -> 1`, never `scale(0)`), `@media (hover: hover) and (pointer: fine)` hover gating, and `prefers-reduced-motion: reduce` support.
