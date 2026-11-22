# Frontdesk - Engineering Notes

Running list of anything skipped, deferred, or intentionally simplified, with rationale. This document is updated after each phase.

## Phase 0: Scaffold, Spec, Tooling
- **Database Schema**: Phase 0 included initial migrations setup (`migrations/` directory, migration runner, and baseline migration table) with a minimal initial migration table check. The full ticket/event/note schema was introduced in Phase 1.
- **Docker in Test Runner**: Vitest unit/integration tests run against an in-memory/mock pool or test database. Docker Compose is provided for local and containerized development.
- **Seeds**: Placeholder seed script created; agent and holiday seeds scheduled for subsequent phases.

## Phase 1: Database Schema + Working-Time Engine
- **PGlite for Zero-Dependency PostgreSQL Testing**: To ensure Vitest test suites can run reliably anywhere (including environments without a running Docker daemon or local Postgres service), `@electric-sql/pglite` was integrated for testing direct SQL triggers and transactions in-memory using real PostgreSQL WASM.
- **Trigger Functions**: Created `enforce_table_immutability()` function and attached `BEFORE UPDATE OR DELETE` (row-level) and `BEFORE TRUNCATE` (statement-level) triggers to `ticket_events`, `messages`, and `internal_notes`.
- **Holidays Table**: Holiday table created in migration `002_schema.sql`; the seed data for 2026 Kerala/Indian public and festival holidays was populated in migration `004_seed_users_and_holidays.sql`.
- **Working Time Precision**: Working time calculations are computed with millisecond precision in `Asia/Kolkata` with zero timezone drift or daylight savings ambiguities.

## Phase 2: Ticket Domain Logic
- **Explicit State Machine (R11)**: Strict transition validation (`NEW` -> `OPEN` <-> `WAITING_CUSTOMER` -> `RESOLVED` -> `CLOSED`; `RESOLVED` -> `OPEN`; `OPEN` -> `NEW`). Invalid transitions reject with typed `InvalidStateTransitionError` (HTTP 422).
- **Atomic Transactions**: Every business operation (ticket creation, replies, pause/resume, priority change, resolve, claim, release) and all corresponding audit events are committed together in a single DB transaction.
- **SLA Pause/Resume (R2)**: Handled by creating open pause intervals in `sla_pauses`. When resumed by customer reply, only unmet milestones (e.g. `resolution_due_at`, or `response_due_at` if not yet met) are shifted forward by working minutes paused.
- **Sticky Breach Recording**: Breaches are recorded idempotently via `recordBreachEvent`, ensuring that a milestone breach creates an immutable audit event once, which is sticky and never overwritten.
- **Mid-Ticket Priority Changes (R5)**: Recomputes both deadlines from `clock_start` using new priority targets while adding all accumulated working minutes paused. Pre-existing breach status is preserved.

## Phase 3: Auth, Agent API, Atomic Claim + Concurrency
- **Authentication & Roles**: JWT-based bearer authentication with bcrypt password hashing. Seeded 9 agents + 1 lead (`lead@arvosystems.com`, `agent1@arvosystems.com`..`agent9@arvosystems.com`).
- **Atomic Concurrency (INC-0291, R7)**: Ticket claiming uses atomic conditional SQL `UPDATE tickets SET assignee_id = $1 ... WHERE id = $2 AND assignee_id IS NULL`. Concurrency tested via simultaneous `Promise.all` claims from 5 agents, guaranteeing exactly one 200 and four 409 responses.
- **Action Guarding (R7)**: Non-assignee agents attempting to reply, add notes, or resolve are rejected with HTTP 403. Lead role can supervise and act across any ticket.
- **Data Protection (R8)**: Agent CSV export strictly excludes internal notes. Internal notes reside in a separate table and are accessible only to authenticated agents on ticket detail.
- **Late Tickets Report (R6)**: Lead-only report breaks down exact causes of lateness (unclaimed duration, late first response, resolution overdue) and highlights customer waiting exclusions.

## Phase 4: Customer API, Strict Note Separation, Canary Test
- **Customer Endpoints (`/api/customer/*`)**: Public ticket creation (with sliding rate limiting), unguessable 48-hex character public tokens (`/api/customer/tickets/:token`), customer reply with automatic SLA resume, customer JSON/CSV export, and customer reopen.
- **Strict Note Separation (INC-0304, R8)**: Customer code does not import or query the `internal_notes` table. Explicit field whitelist serializers guarantee no sensitive fields or internal team notes ever reach customer endpoints.
- **Canary Test (R8)**: Tested with `SECRET-CANARY-123` across all customer endpoints (create, get by token, reply, reopen, JSON export, CSV export, and 404/400 error responses), asserting that the canary string never appears in any response body or header. Positive verification confirmed that only authenticated agents can see the note on the agent timeline.
- **Customer Reopen (R4)**: Implemented 5-working-day (2700 working minutes) reopen window with cycle increment, fresh SLA cycle calculation, and `reopen_rejected` audit event logging if expired.

## Phase 5: Auto-Close Sweep, Reopen Window, Late Report
- **Auto-Close Sweep (R3)**:
  - Idempotent background sweep closes tickets that have been in `WAITING_CUSTOMER` status for >= 5 working days (45 working hours = 2700 working minutes) using the working-time engine (excluding weekends and festival holidays).
  - Automatically records an immutable `auto_closed` audit event with actor `"system"`.
  - Triggered three ways:
    1. Scheduled background cron via `node-cron` every 5 minutes in long-running server environments.
    2. Lazy evaluation on ticket reads (`/api/agent/tickets`, `/api/agent/tickets/:id`, `/api/customer/tickets/:token`) to ensure complete reliability in sleeping free-tier/serverless hosting environments.
    3. Protected endpoint `POST /api/internal/sweep` with `x-internal-secret` header for external webhook or cron services.
  - Customers attempting to reply to an auto-closed or manually closed ticket receive an informative 400 response along with pre-filled follow-up ticket metadata (`parentTicketId`, follow-up subject) to initiate a new linked ticket.
- **Reopen Window (R4)**:
  - Customers can reopen a `RESOLVED` ticket only within 5 working days (2700 working minutes) of `resolved_at`.
  - When reopened within window: transitions ticket to `OPEN`, increments `cycle` number (`cycle + 1`), sets `clock_start` to reopen timestamp, recalculates fresh SLA response and resolution deadlines, and logs a `reopened` event.
  - When reopen is requested after the 5-working-day window: rejected with HTTP 400, records an immutable `reopen_rejected` audit event, and returns pre-filled follow-up metadata (`parentTicketId`, `followUp`) to open a new ticket.
- **Late Tickets Report with Explainable Reasons (R6)**:
  - Lead-only report (`GET /api/agent/reports/late`) computes explainable human-readable reasons from immutable `ticket_events` and `sla_pauses`:
    - Unclaimed duration (e.g. `"not claimed for 3h10m"`).
    - First-reply breach amount in working minutes (e.g. `"first reply 45 working min after deadline"`).
    - Resolution overdue amount in working days/hours (e.g. `"resolution overdue by 1 working day"`).
    - Customer waiting time paused during `WAITING_CUSTOMER` intervals is explicitly calculated and reported as `excludedCustomerWaitingMinutes` and formatted (e.g. `"2h"`), ensuring delays outside the team's control are transparently excluded.

## Phase 6: Agent Screen, Ticket Detail, Lead Report, Customer Pages
- **Frontend Architecture**: Built using React 18 + Vite + TypeScript. Kept simple, fast, and functional with zero heavy CSS or UI library overhead. Client-side navigation supports direct URLs and hash routing (`/#/ticket/:token`, `/#/agent/tickets/:id`, `/#/agent/reports/late`, `/#/agent/holidays`).
- **Strict API Tree Separation**:
  - Customer screens (`CreateTicketPage`, `CustomerTicketPage`) call exclusively `/api/customer/*` via `customerApi.ts`, strictly isolating private notes and internal agent endpoints.
  - Agent screens (`LoginPage`, `TicketListPage`, `TicketDetailPage`, `LateReportsPage`, `HolidaysPage`) call exclusively `/api/agent/*` and `/api/auth/*` via `agentApi.ts`.
- **Agent Screen (R6 & R7)**:
  - ONE main screen "My tickets" with tabbed filters (`Mine`, `Unassigned queue`, `Late`, `Waiting on customer`, `All`).
  - Clear visual badges: red `🔴 LATE` badge and amber `⏳ WAITING ON CUSTOMER` badge.
  - Unassigned queue shows atomic "Take this ticket" button. If another agent takes it concurrently, HTTP 409 conflict is captured and displayed nicely with the name of the taking agent (preventing INC-0291).
- **Ticket Detail & Private Note Guarantee (R8 & R9)**:
  - Header displays SLA targets, deadlines, and working-time status (remaining or overdue).
  - Explicit first-reply timing display shows both wall-clock timestamp and elapsed working minutes (`"first replied at ... by Agent (N working minutes after creation)"`).
  - Exactly two compose boxes:
    1. Public reply box with "Send & wait for customer" checkbox (pausing SLA clock until customer response).
    2. Visually distinct internal note box styled with warm yellow background, amber borders, lock icon (🔒), and explicit disclaimer: "STRICTLY CONFIDENTIAL · NEVER VISIBLE TO CUSTOMER".
  - Actions toolbar for resolving, changing priority (with recomputation), and releasing tickets.
- **Lead-Only Pages**:
  - Late tickets audit report (`/agent/reports/late`) with computed explanations (`not claimed for X`, `first reply Y late`, `resolution overdue by Z`) and customer waiting time paused exclusions.
  - Holidays management page (`/agent/holidays`) for CRUD on festival/public holidays affecting the SLA engine.
- **Customer Portal (R10)**:
  - Public ticket creation form with 3 urgency options mapped to Urgent, Medium, and Small.
  - Generates unguessable secret access link (`/#/ticket/:token`).
  - Customer ticket view showing exclusively public messages, reply box (auto-resuming paused SLA), and 5-working-day reopen button (or pre-filled follow-up creation link when closed/expired).

## Phase 7: Seed Data, Production Build, Deploy Guide
- **Idempotent Seed Script (`server/src/db/seed.ts`)**:
  - Seeds 9 support agents + 1 lead supervisor with demo credentials (`Password123!`).
  - Seeds 13 official 2026 Kerala & Indian festival/public holidays with the note to verify dates.
  - Automatically checks `tickets` table; if tickets already exist, skips sample ticket creation to preserve live/production data.
  - Seeds 10 realistic sample tickets covering all business rules and edge cases:
    1. Late Urgent ticket (first reply breached, red LATE badge).
    2. Medium nearly due ticket (resolution due in ~45 working minutes).
    3. Small fine ticket (on track with ample working time).
    4. Waiting on customer ticket (SLA clock paused, open pause interval in `sla_pauses`).
    5. About to auto-close ticket (~36 working hours silent in `WAITING_CUSTOMER`, ~1 working day before auto-close).
    6. Resolved near reopen limit (resolved ~36 working hours ago, ~1 working day remaining in 5-working-day reopen window).
    7. Created Friday 6:00 PM ticket (arrived at closing boundary, SLA clock starts Monday 09:30 AM without weekend penalty).
    8. Unassigned queue tickets (two tickets in `NEW` status ready for atomic claiming).
    9. Reopened ticket (Cycle 2, previous cycle preserved in audit events, fresh SLA cycle calculated).
  - Terminal output clearly prints demo login credentials upon execution.
- **Production Readiness (`server/src/index.ts`)**:
  - Validates environment variables (`DATABASE_URL`, `JWT_SECRET`, `PORT`, `INTERNAL_SECRET`).
  - Automatic migrations (`runMigrations`) and idempotent seed (`runSeeds`, only if empty) run on container boot.
  - Graceful shutdown handles `SIGTERM` and `SIGINT`, cleanly terminating background cron schedulers and closing database connection pools.
  - Single deployable: Express serves built React static assets from `web/dist` with client-side routing fallback.
- **Deployment Documentation (`DEPLOY.md`)**:
  - Detailed step-by-step guides for Render (Free Web Service + Free PostgreSQL), Railway, and Fly.io + Neon PostgreSQL.
  - Explicit environment variable tables, build commands, and start commands.
  - Addresses free-tier cold starts (explaining why Frontdesk's lazy SLA engine ensures immunity to timing drift during sleep) and 30-day database expiry risks.
