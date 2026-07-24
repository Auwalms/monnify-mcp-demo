# PensionPal

PensionPal is a minimal NGN-focused retirement-savings demo app built to power
a 40-minute conference workshop on integrating third-party APIs (Monnify) with
an AI coding assistant connected to an MCP server. It demonstrates a complete,
real-world API integration: one-time checkout payments, reserved accounts for
direct receipt of funds, and a multi-step direct debit mandate lifecycle. It is
a **teaching prop**, not production software — it prioritizes reliability and
clarity over scalability or security hardening.

## Setup

1. Clone and install:
   ```bash
   npm install
   ```
2. Set up environment:
   ```bash
   cp .env.example .env
   # Fill in Monnify credentials:
   #   MONNIFY_API_KEY
   #   MONNIFY_SECRET_KEY
   #   MONNIFY_CONTRACT_CODE
   #   MONNIFY_BASE_URL (defaults to https://sandbox.monnify.com)
   # Optional:
   #   ADMIN_PASSWORD (for admin panel access, defaults to "admin")
   ```
3. Start:
   ```bash
   npm start
   ```
4. Open [http://localhost:3000](http://localhost:3000).

State persists to a local JSON file (`src/db/db.json`) via
[lowdb](https://github.com/typicode/lowdb).

### Test Users

Three demo users are seeded in the database. The dashboard defaults to **usr_001** (Amina Bello), but you can explore others:

| User ID  | Name           | KYC Status | Account Status | Mandate Status | Notes                                  |
| -------- | -------------- | ---------- | -------------- | -------------- | -------------------------------------- |
| usr_001  | Amina Bello    | VERIFIED   | ACTIVE         | None           | Primary demo user — start here         |
| usr_002  | Chioma Okafor  | VERIFIED   | ACTIVE         | ACTIVE         | Shows an authorized mandate in action  |
| usr_003  | Tunde Akinola  | PENDING    | ACTIVE         | None           | Shows pending KYC scenario             |

To switch users in the dashboard, append `?userId=usr_002` to the URL, e.g.:
```
http://localhost:3000?userId=usr_002
```

Or query the API directly:
```bash
curl http://localhost:3000/api/user?userId=usr_002
curl http://localhost:3000/api/users  # List all users
```

## Webhook setup (required before workshop)

This app uses **real Monnify sandbox webhooks**. Before the session:

1. Expose your local server via ngrok:
   ```bash
   ngrok http 3000
   ```
2. Register the webhook URL in your Monnify sandbox dashboard:
   `https://<your-ngrok-domain>.ngrok-free.app/api/webhooks/monnify`
3. Do this once upfront — ngrok URLs rotate on restart.

## Build strategy: pre-built vs. live-coded

**Pre-built, working end-to-end:**

- Checkout Link flow (one-time funding, real webhooks, balance updates)
- Subaccount fee-split logic integrated into checkout
- Bank list and account name resolution (supporting infrastructure for mandate flow)
- Idempotency protection (duplicate transaction prevention)
- Per-user event tracking with date/time display
- Admin panel for mandate management and manual debits

**Live-coded during the workshop:**

The Direct Debit mandate lifecycle (NGN only) — three distinct, interdependent steps:

1. **Create Mandate** (`POST /api/wallet/mandate`) — initiates a mandate with payer account details
2. **Check Status** (`GET /api/wallet/mandate/:mandateId/status`) — monitor mandate authorization progress
3. **Authorise Mandate** (`POST /api/wallet/mandate/:mandateId/authorise`) — activates the mandate for debiting

The mandate creation endpoints are stubs in `src/routes/wallet.js` and
`src/services/monnify.js`, marked with `// TODO: built live in workshop`. They accept
the correct request shapes and return placeholder responses. The frontend
(`public/app.js`) already wires up all steps in sequence.

**Mandate debit execution** is fully implemented:
- `POST /api/admin/mandate/:userId/debit` — admin endpoint to manually trigger mandate debits
- Real Monnify API integration via `debitMandate()` in `src/services/monnify.js`
- Automatic wallet balance updates and event logging
- One debit per mandate per day limit

## Core Features

### Idempotency Protection
- **Transaction tracking** — all processed transactions (both webhook and callback) are stored in `db.data.processedTransactions`
- **Duplicate prevention** — same transaction cannot be credited twice, even if webhook is retried or callback is called multiple times
- **Per-user events** — each user's transaction history is isolated; users only see their own recent activity

### Recent Activity with Timestamps
- **Date and time display** — recent activities show full locale-formatted date and time (not just time)
- **Event tracking** — all wallet operations logged with ISO timestamps, including:
  - Checkout payments
  - Mandate debits
  - Duplicate transaction attempts
  - Webhook events

### Admin Panel
Access the admin dashboard at `http://localhost:3000?admin=true` or via the "Admin Access?" link on the login screen.

**Features:**
- List all active mandates across users
- View mandate details (amount, frequency, creation date, last debit)
- View debit history per mandate (expandable)
- Manually trigger mandate debits using real Monnify API
- One debit per mandate per day limit to prevent accidental duplicates
- Password-protected (set `ADMIN_PASSWORD` in `.env`)

**Admin Endpoints:**
- `GET /api/admin/mandates` — list all active mandates
- `POST /api/admin/mandate/:userId/debit` — trigger mandate debit (requires `x-admin-password` header)

## Architecture notes

- **No build step** — Tailwind CSS via CDN, vanilla JS in the browser. Express
  serves static files from `public/`.
- **Passwordless login** — three test users seeded in `src/db/db.js`. No authentication required.
- **User model** — clean separation:
  ```js
  {
    userId, firstName, lastName, phoneNumber, email,
    wallet: { balance, currency: 'NGN' },
    directDebit: { payer, mandate },
    events: []  // Per-user transaction history
  }
  ```
- **Mandate model** — tracks authorization state and debit history:
  ```js
  {
    mandateReference, mandateCode, status, amount, frequency,
    createdAt, lastDebitDate, debitHistory: []
  }
  ```
- **MCP config** (`.vscode/mcp.json`) — purely a dev-time aid for VS Code +
  GitHub Copilot. The package name (`@monnify/mcp-server`) is a placeholder
  — confirm against Monnify's published MCP server before using.
