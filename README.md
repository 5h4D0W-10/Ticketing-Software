# Frontdesk - Arvo Systems Support Ticket System

Frontdesk is a support-ticket system built for Arvo Systems to eliminate late tickets and untracked SLA breaches through strict working-time SLA tracking, immutable audit trails, and concurrency-safe assignment.

---

## Demo Accounts

All demo accounts are seeded with password: `Password123!`

- **Lead Supervisor**: `lead@arvosystems.com` (Role: `lead`)
- **Support Agents**:
  - `agent1@arvosystems.com` (Role: `agent`)
  - `agent2@arvosystems.com` (Role: `agent`)
  - `agent3@arvosystems.com` (Role: `agent`)
  - `agent4@arvosystems.com` (Role: `agent`)
  - `agent5@arvosystems.com` (Role: `agent`)
  - `agent6@arvosystems.com` (Role: `agent`)
  - `agent7@arvosystems.com` (Role: `agent`)
  - `agent8@arvosystems.com` (Role: `agent`)
  - `agent9@arvosystems.com` (Role: `agent`)

---

## Assumptions & Decisions

1. **Working Time & SLA Targets (Asia/Kolkata)**:
   - Operating hours are Monday through Friday, 09:30 to 18:30 IST (9 working hours / 540 working minutes per day).
   - Timezone is `Asia/Kolkata`, which has a fixed UTC+05:30 offset with no daylight saving time (DST).
   - Weekends (Saturday and Sunday) and festival/public holidays are strictly excluded from SLA calculations.
   - Per specification, no lunch break is deducted within the 9:30–18:30 window.
   - Boundary rules:
     - 09:30:00.000 IST is the opening boundary. Tickets created before 09:30:00.000 on a working day have their SLA clock start at 09:30:00.000 on that day.
     - 18:30:00.000 IST is the closing boundary. Tickets arriving at or after 18:30:00.000 have their SLA clock start at 09:30:00.000 on the next working day.
     - Between 09:30:00.000 and 18:30:00.000 is exactly 540 working minutes.
   - Priority targets:
     - **Urgent**: First reply within 2 working hours (120 working minutes); resolve by 18:30 IST on the day the SLA clock starts.
     - **Medium**: First reply within 4.5 working hours (270 working minutes); resolve within 27 working hours (1620 working minutes / 3 working days).
     - **Small**: First reply within 9 working hours (540 working minutes / 1 working day); resolve within 45 working hours (2700 working minutes / 5 working days / 1 working week).
2. **Priority Change Mid-Ticket (R5)**:
   - When priority is changed mid-ticket, both deadlines are recomputed from the ticket's original `clock_start` using the new priority's targets, preserving any elapsed paused working time.
   - Pre-existing breaches remain sticky. An audit event (`priority_changed`) is recorded with old/new priority and old/new deadlines.
3. **Database-Enforced Immutability (R9)**:
   - Immutability is enforced directly at the database engine level via PostgreSQL `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers on `ticket_events`, `messages`, and `internal_notes`.
4. **Data Isolation (R8)**:
   - `internal_notes` is stored in a separate table from customer-visible `messages`, preventing accidental data leaks.
5. **Atomic Claim Concurrency (R7)**:
   - Conditional atomic `UPDATE ... WHERE assignee_id IS NULL` prevents double-taking under high concurrency. Losers receive HTTP 409 specifying the current assignee.
   - Only the assignee or a lead is permitted to reply, add notes, or resolve tickets (HTTP 403 otherwise).
6. **Auto-Close Sweep (R3)**:
   - Tickets remaining in `WAITING_CUSTOMER` for 5 working days (45 working hours = 2700 working minutes) are auto-closed by an idempotent sweep with actor `"system"` and event `auto_closed`.
   - Executed via background cron, lazy evaluation on ticket reads (ensuring sleeping free-tier deployments remain accurate), and via protected webhook `POST /api/internal/sweep`.
   - Any reply to a closed ticket returns follow-up metadata (`parentTicketId`) to open a new linked ticket.
7. **Reopen Window (R4)**:
   - Customers may reopen `RESOLVED` tickets only within 5 working days of resolution.
   - Reopening transitions the ticket to `OPEN`, increments `cycle`, and starts a fresh SLA cycle.
   - Reopen attempts after 5 working days are rejected with HTTP 400, record an immutable `reopen_rejected` audit event, and return pre-filled follow-up information.
8. **Late Tickets Report & Audit Explainability (R6)**:
   - Lead report breaks down exact causes of lateness (unclaimed delay, late first response in working minutes, resolution overdue) and explicitly computes and excludes customer-waiting pause intervals.
9. **Architecture & Testing**:
   - Monorepo with `/server` (Node.js + TypeScript + Express + `pg` + Vitest) and `/web` (React + Vite + TypeScript).
   - Injectable `Clock` abstraction (`SystemClock`, `FakeClock`) for deterministic simulation of SLA policies and time-travel tests.
   - Zero-dependency embedded testing using `@electric-sql/pglite` (Postgres WASM) ensures comprehensive test coverage without external services.

---

## Local Development Setup

### Prerequisites
- Node.js (v20+ recommended, tested on v24)
- npm (v10+)
- Docker & Docker Compose (or local PostgreSQL instance)

### 1. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 2. Start PostgreSQL
Run PostgreSQL via Docker Compose:
```bash
docker compose up -d
```
Default connection string: `postgres://frontdesk:frontdesk_secret@localhost:5432/frontdesk_dev`

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Migrations & Seeds
```bash
npm run migrate
npm run seed
```

### 5. Start Development Servers
```bash
npm run dev
```

### 6. Run Tests
```bash
npm test
```

### 7. Production Build & Start
```bash
npm run build
npm start
```
Frontend will be served directly at `http://localhost:3000`.

---

## API Overview & Endpoints

### Health Check
- `GET /health` - Service health status and database connectivity check.

### Authentication (`/api/auth`)
- `POST /api/auth/login` - Authenticate with email and password, returns JWT token.
- `GET /api/auth/me` - Get current authenticated user profile.

### Agent API (`/api/agent`)
- `GET /api/agent/tickets` - List tickets with filters (`all`, `mine`, `unassigned`, `late`, `waiting_customer`) and live SLA status.
- `GET /api/agent/tickets/:id` - Ticket detail with complete timeline (messages, notes, audit events).
- `POST /api/agent/tickets/:id/claim` - Atomic ticket claim (HTTP 409 on conflict).
- `POST /api/agent/tickets/:id/release` - Release ticket back to queue.
- `POST /api/agent/tickets/:id/reply` - Public reply to customer (optional `waitForCustomer: true` pauses SLA).
- `POST /api/agent/tickets/:id/notes` - Add internal team-only note.
- `POST /api/agent/tickets/:id/resolve` - Resolve ticket.
- `POST /api/agent/tickets/:id/priority` - Change ticket priority with mid-ticket deadline recomputation.
- `GET /api/agent/tickets/export/csv` - CSV export for agents (strictly excludes internal notes).
- `GET /api/agent/reports/late` - Late tickets root cause analysis report (Lead only).
- `GET /api/agent/holidays` - View holidays list.
- `POST /api/agent/holidays` - Add holiday (Lead only).
- `DELETE /api/agent/holidays/:id` - Delete holiday (Lead only).

### Customer API (`/api/customer`)
- `POST /api/customer/tickets` - Create new ticket (public, rate-limited, maps urgency choices to priorities).
- `GET /api/customer/tickets/:token` - Get ticket public conversation by secret unguessable token (messages only).
- `POST /api/customer/tickets/:token/reply` - Customer reply (resumes SLA clocks if ticket is waiting on customer).
- `POST /api/customer/tickets/:token/reopen` - Reopen a resolved ticket within the 5-working-day window (starts a new SLA cycle).
- `GET /api/customer/tickets/:token/export` - Export conversation history as JSON or CSV (public messages only).
