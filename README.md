# Frontdesk - Arvo Systems Support Ticket System

Frontdesk is an enterprise support-ticket system built for **Arvo Systems** (handling ~40 tickets/day across 9 support agents and 1 lead supervisor). It replaces error-prone spreadsheets and WhatsApp groups with pure working-time SLA tracking, database-enforced immutable audit trails, atomic claim concurrency, and strict separation between customer messages and private team notes.

---

## Live Deployment

- **Live URL**: `https://frontdesk-app.onrender.com` *(Deployed on Render Free Tier via `render.yaml`)*
- **Health Endpoint**: `https://frontdesk-app.onrender.com/health`
- **Customer Portal**: `https://frontdesk-app.onrender.com/#/customer/new`
- **Agent Portal**: `https://frontdesk-app.onrender.com/#/agent/login`

---

## Tech Stack

- **Backend**: Node.js (v20+ / v22 / v24), TypeScript, Express.js.
- **Frontend**: React 18, TypeScript, Vite (lightweight utilitarian CSS, zero bulky component framework overhead).
- **Database**: PostgreSQL 15+ (with native SQL triggers for immutability and atomic row-level locks).
- **Embedded Database Fallback**: Embedded PostgreSQL ([PGlite 16 WASM](https://pglite.dev/)) automatically initializes if a local PostgreSQL daemon or Docker instance is absent, enabling zero-config local runs.
- **Testing**: Vitest, Supertest, PGlite in-memory testing (59 tests across 11 test suites).
- **Scheduling**: Node-cron background scheduler + lazy SLA evaluation on request reads (immune to free-tier sleep cycles).

---

## System Architecture

```mermaid
flowchart TD
    subgraph Client["Frontend Layer (React + Vite)"]
        CP["Customer Portal<br/>(/#/customer/new, /#/ticket/:token)"]
        AP["Agent App<br/>('My Tickets', Detail, Late Report, Holidays)"]
    end

    subgraph Server["Backend Application (Express + Node.js)"]
        Auth["JWT Auth & Role Guard<br/>(/api/auth/*)"]
        AgentRoutes["Agent API Router<br/>(/api/agent/*)"]
        CustomerRoutes["Customer API Router<br/>(/api/customer/*)"]
        InternalRoutes["Internal Webhook<br/>(/api/internal/sweep)"]
        RateLimiter["Sliding Rate Limiter"]
        LazySweep["Lazy Auto-Close Sweep"]
        Cron["node-cron Scheduler"]
    end

    subgraph Domain["Domain & Business Engine"]
        SLA["Working-Time SLA Engine<br/>(Asia/Kolkata 09:30-18:30)"]
        SM["State Machine<br/>(NEW -> OPEN <-> WAITING -> RESOLVED -> CLOSED)"]
        TS["Ticket Service<br/>(Atomic Transactions & Claims)"]
        Reports["Explainable Late Report Engine"]
    end

    subgraph Data["Database Layer (PostgreSQL)"]
        T["tickets"]
        TE["ticket_events (Immutable Trigger)"]
        M["messages (Immutable Trigger)"]
        IN["internal_notes (Immutable Trigger, Separate Table)"]
        H["holidays (Editable)"]
        P["sla_pauses (Pause Intervals)"]
    end

    CP -->|Public Token Access| RateLimiter --> CustomerRoutes
    AP -->|Bearer JWT Token| Auth --> AgentRoutes
    InternalRoutes --> TS
    Cron --> TS
    CustomerRoutes --> LazySweep --> TS
    AgentRoutes --> LazySweep --> TS

    CustomerRoutes --> TS
    AgentRoutes --> TS
    TS --> SLA
    TS --> SM
    AgentRoutes --> Reports

    TS --> T
    TS --> TE
    TS --> M
    TS --> IN
    TS --> H
    TS --> P
```

---

## Demo Accounts & Logins

All demo accounts are pre-seeded with password: **`Password123!`** (or click the quick demo buttons on the login screen):

| Role | Email | Password | Permissions & Views |
| :--- | :--- | :--- | :--- |
| **Lead Supervisor** | `lead@arvosystems.com` | `Password123!` | Ticket Queue, Claims, Replies, Internal Notes, **Late Tickets Report (R6)**, **Holidays Manager (R1)** |
| **Support Agent 1** | `agent1@arvosystems.com` | `Password123!` | Ticket Queue, Atomic Claims (R7), Replies, Internal Notes (R8) |
| **Support Agent 2** | `agent2@arvosystems.com` | `Password123!` | Ticket Queue, Atomic Claims, Replies, Internal Notes |
| **Support Agent 3–9** | `agent3@arvosystems.com` … `agent9@arvosystems.com` | `Password123!` | Ticket Queue, Atomic Claims, Replies, Internal Notes |

### Customer Portal:
- No login required. Customers create requests at `/#/customer/new` and receive a private, unguessable secret link (`/#/ticket/:token`) to check progress, reply, or reopen resolved tickets within 5 working days.

---

## Local Setup & Step-by-Step Execution

Frontdesk is designed to run seamlessly on **Windows, macOS, and Linux**.

### Prerequisites
- Node.js (v20+ recommended)
- npm (v10+)
- *(Optional)* Docker Desktop (if using Docker for PostgreSQL; if omitted, Frontdesk automatically falls back to embedded PGlite PostgreSQL).

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/5h4D0W-10/Ticketing-Software.git
cd "ticket booking system"
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
# Windows (PowerShell):
Copy-Item .env.example .env

# macOS / Linux:
cp .env.example .env
```

### 3. Choose Database Mode (Docker or Zero-Dependency Fallback)

#### Option A: Zero-Dependency Embedded PostgreSQL (Default & Easiest)
If Docker or local PostgreSQL is not running, Frontdesk automatically boots an embedded PostgreSQL 16 engine (via PGlite WASM) and persists the database to `.data/frontdesk-db`. **No extra software or database installation required.**

#### Option B: Local Docker PostgreSQL
To use external Docker PostgreSQL instead:
```bash
docker compose up -d
```
*(Default connection: `postgres://frontdesk:frontdesk_secret@localhost:5432/frontdesk_dev`)*

### 4. Build Application
```bash
npm run build
```

### 5. Start the Server
```bash
npm start
```
The server will automatically:
1. Run all database migrations in `/migrations`.
2. Seed demo users, 2026 festival holidays, and sample tickets.
3. Serve both the REST API and the React single-page frontend directly at:
   👉 **[http://localhost:3000](http://localhost:3000)**

### 6. Development Mode (Optional)
To run frontend and backend with hot-reloading:
```bash
npm run dev:all
```
- Frontend Dev Server: `http://localhost:5173` (proxies `/api` to port 3000)
- Backend Dev Server: `http://localhost:3000`

---

## How to Run Tests

The test suite runs 59 automated unit, integration, and concurrency tests in parallel across 11 test files using an in-memory PostgreSQL WASM instance (no external database needed):

```bash
npm test
```

### Key Incident Verification Tests:
1. **INC-0291 (Atomic Claim Concurrency)**:
   - File: `server/src/__tests__/agentApi.test.ts`
   - Test: Simultaneous `Promise.all` claims from 5 agents against the same unassigned ticket. Exactly one agent receives `200 OK`; the remaining 4 receive `409 Conflict` containing the winner's name.
2. **INC-0304 (Private Note Canary Guarantee)**:
   - File: `server/src/__tests__/canary.test.ts`
   - Test: Creates a ticket, adds an internal note with body `SECRET-CANARY-123`, and calls every customer-reachable endpoint (create, get by token, customer reply, customer JSON export, customer CSV export, and error responses). Asserts the string never appears in any response body or header.
3. **INC-0318 (Immutable Audit History)**:
   - File: `server/src/__tests__/immutability.test.ts`
   - Test: Executes raw SQL `UPDATE`, `DELETE`, and `TRUNCATE` against `ticket_events`, `messages`, and `internal_notes`. Verifies that PostgreSQL database triggers raise fatal exceptions and reject any modification.

---

## API Overview (Agent vs Customer Trees)

Frontdesk enforces strict isolation between agent and customer endpoints via separate routers, middleware, and serializers:

### Customer API (`/api/customer/*`) — Public & Rate-Limited
- **No internal note data**: Customer code has zero access to the `internal_notes` table.
- **Explicit Whitelist Serializers**: Returns only public fields (`token`, `subject`, `status`, `createdAt`, `updatedAt`, `canReopen`, `messages`).
- `POST /api/customer/tickets` — Submit ticket (urgency mapped to priority).
- `GET /api/customer/tickets/:token` — Retrieve ticket conversation by secret token (public messages only).
- `POST /api/customer/tickets/:token/reply` — Post customer reply (automatically resumes paused SLA clocks).
- `POST /api/customer/tickets/:token/reopen` — Reopen a resolved ticket within 5 working days (starts new SLA cycle).
- `GET /api/customer/tickets/:token/export` — Export public conversation as JSON or CSV.

### Agent API (`/api/agent/*`) — Authenticated (JWT Required)
- `GET /api/agent/tickets` — Filtered queues (`all`, `mine`, `unassigned`, `late`, `waiting_customer`) sorted by urgent deadline.
- `GET /api/agent/tickets/:id` — Ticket detail with full audit timeline, public messages, and internal notes.
- `POST /api/agent/tickets/:id/claim` — Atomic ticket claim (HTTP 409 on conflict).
- `POST /api/agent/tickets/:id/release` — Release ticket back to unassigned queue.
- `POST /api/agent/tickets/:id/reply` — Public reply to customer (optional `waitForCustomer: true` pauses SLA).
- `POST /api/agent/tickets/:id/notes` — Append internal team note (team only).
- `POST /api/agent/tickets/:id/resolve` — Mark ticket resolved.
- `POST /api/agent/tickets/:id/priority` — Change priority with mid-ticket deadline recomputation.
- `GET /api/agent/tickets/export/csv` — CSV export for agents (strictly excludes internal notes).
- `GET /api/agent/reports/late` — Root-cause late tickets report with customer pause deductions (Lead only).
- `GET / POST / DELETE /api/agent/holidays` — Festival holidays management (Lead only).

---

## Full Assumptions & Decisions

In accordance with the specification delivery instructions (*"No clarification will be given: decide, and document decisions"*), all business rules and edge cases have been resolved as follows:

### 1. Working Hours (09:30 – 18:30 IST) Without Lunch
- Operating hours are Monday through Friday, 09:30 to 18:30 IST (9 working hours / 540 working minutes per day).
- Timezone is strictly **`Asia/Kolkata`** (+05:30 fixed offset, no Daylight Saving Time).
- Weekends (Saturday and Sunday) and festival/public holidays are completely excluded from SLA clocks.
- *Decision*: In accordance with SPEC R1 (*"No lunch break assumed; document"*), working time is continuous between 09:30 and 18:30 without lunch deductions.

### 2. Working Time Units & Deadlines
- **Half working day**: 4.5 working hours = 270 working minutes.
- **1 working day**: 9 working hours = 540 working minutes.
- **3 working days**: 27 working hours = 1,620 working minutes.
- **1 working week**: 5 working days = 45 working hours = 2,700 working minutes.

### 3. Outside-Hours & Boundary Starts
- Tickets created before 09:30 IST on a working day start their SLA clock at 09:30:00.000 IST on that day.
- Tickets created after 18:30:00.000 IST on a working day (or over a weekend/holiday) start their SLA clock at 09:30:00.000 IST on the next working day.
- **Mandatory Test Case**: A ticket created on Friday at 18:00:00 IST is **not** late on Sunday morning or Monday at 09:29 AM. It has 8.5 working hours remaining until its first-day resolution deadline.

### 4. Urgent Same-Day Resolution Rule
- SPEC R1 states: *"Same working day for Urgent: due 18:30 on the day the clock starts"*.
- For an Urgent ticket whose clock starts at 09:30 AM, resolution is due at 18:30:00 IST on that same working day (9 working hours).
- If an Urgent ticket arrives mid-day (e.g. 14:00 IST), resolution is due by 18:30 IST same day if created before 12:30 IST, or wraps cleanly into the next working day after remaining hours are consumed.

### 5. SLA Pause & Resume on Customer Waiting (R2)
- When an agent selects *"Send & wait for customer"*, the ticket transitions to `WAITING_CUSTOMER`.
- An active pause record is created in `sla_pauses`.
- When the customer replies, the ticket transitions back to `OPEN`, the pause is closed, and unmet deadlines are shifted forward by the exact **working minutes spent paused** (excluding weekends/holidays during the customer's silence).
- Time spent waiting on the customer **never** counts against Arvo Systems' SLA.

### 6. Mid-Ticket Priority Changes (R5)
- When an agent updates a ticket's priority (e.g. Medium upgraded to Urgent, or downgraded to Small):
  - Both response and resolution deadlines are recomputed from the ticket's original `clock_start` using the new priority's total allowance, plus any accumulated paused working minutes.
  - If the working time already elapsed exceeds the new allowance, the deadline is set to the current time, marking it overdue immediately.
  - Pre-existing breaches remain **sticky** (breach events are never erased).
  - An immutable audit event (`priority_changed`) is recorded with old/new priorities and old/new deadlines.

### 7. Auto-Close Sweep (R3)
- If a customer remains silent for **5 working days** (45 working hours = 2,700 working minutes) while in `WAITING_CUSTOMER`, the ticket is auto-closed.
- Auto-close is evaluated using pure working time (not wall-clock days).
- Handled via:
  1. Background cron every 5 minutes (`node-cron`).
  2. Lazy evaluation on ticket reads (guaranteeing 100% accuracy on free-tier cloud environments that spin down or sleep).
  3. External webhook `POST /api/internal/sweep` with secret header.
- The closing actor is recorded as `"system"`, and event `auto_closed` is logged.

### 8. Reopen Window & Follow-Up Tickets (R4)
- A customer can reopen a `RESOLVED` ticket only within **5 working days** (2,700 working minutes) of `resolved_at`.
- Reopen success: Transitions to `OPEN`, increments `cycle` number (`cycle = cycle + 1`), sets `clock_start` to reopen timestamp, resets SLA targets for the new cycle, and logs `reopened`.
- Reopen expiration (> 5 working days): Customer request is rejected with HTTP 400, logs an immutable `reopen_rejected` audit event, and returns pre-filled metadata (`parentTicketId`, subject) to open a new linked follow-up ticket.

### 9. Holiday Calendar & Lead Management (R1)
- Seeded with 13 official 2026 Kerala & Indian festival and public holidays:
  - *Republic Day, Maha Shivratri, Eid-ul-Fitr, Good Friday, Vishu, May Day, Bakrid, Independence Day, First Onam, Thiruvonam, Mahanavami, Vijayadashami, Deepavali, Christmas*.
- Lead supervisors can add or delete holiday dates via `/api/agent/holidays` or the UI Holidays page.
- The working-time engine dynamically queries the `holidays` table on every calculation.

### 10. Customer Access via Secret Unguessable Token (R8, R10)
- Customers never log in and do not have passwords.
- Upon ticket creation, the server generates a cryptographically secure 48-character unguessable token (`tok_...`).
- Customer endpoints accept only this secret token, completely isolating customer conversations from sequential ID enumeration attacks.

---

## Deliverables & Documentation Index

- **[docs/SPEC.md](docs/SPEC.md)**: Original hiring test specification.
- **[docs/TRACEABILITY.md](docs/TRACEABILITY.md)**: Detailed mapping of requirements R1 through R14 to code and test suites.
- **[NOTES.md](NOTES.md)**: Engineering notes, phase log, and honest evaluation of deferred secondary items.
- **[DEPLOY.md](DEPLOY.md)**: Complete production deployment guide for Render, Railway, and Fly.io + Neon.
- **[render.yaml](render.yaml)**: One-click Render Blueprint definition.
