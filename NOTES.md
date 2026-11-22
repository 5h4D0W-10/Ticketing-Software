# Frontdesk - Engineering Notes

Running list of anything skipped, deferred, or intentionally simplified, with rationale. This document is updated after each phase.

## Phase 0: Scaffold, Spec, Tooling
- **Database Schema**: Phase 0 included initial migrations setup (`migrations/` directory, migration runner, and baseline migration table) with a minimal initial migration table check. The full ticket/event/note schema was introduced in Phase 1.
- **Docker in Test Runner**: Vitest unit/integration tests run against an in-memory/mock pool or test database. Docker Compose is provided for local and containerized development.
- **Seeds**: Placeholder seed script created; agent and holiday seeds scheduled for subsequent phases.

## Phase 1: Database Schema + Working-Time Engine
- **PGlite for Zero-Dependency PostgreSQL Testing**: To ensure Vitest test suites can run reliably anywhere (including environments without a running Docker daemon or local Postgres service), `@electric-sql/pglite` was integrated for testing direct SQL triggers and transactions in-memory using real PostgreSQL WASM.
- **Trigger Functions**: Created `enforce_table_immutability()` function and attached `BEFORE UPDATE OR DELETE` (row-level) and `BEFORE TRUNCATE` (statement-level) triggers to `ticket_events`, `messages`, and `internal_notes`.
- **Holidays Table**: Holiday table created in migration `002_schema.sql`; the seed data for 2026 Kerala/Indian public and festival holidays will be populated in the seed/auth phase.
- **Working Time Precision**: Working time calculations are computed with millisecond precision in `Asia/Kolkata` with zero timezone drift or daylight savings ambiguities.
