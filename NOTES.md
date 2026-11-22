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
