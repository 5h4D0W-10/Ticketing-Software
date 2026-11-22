# Frontdesk - Engineering Notes

Running list of anything skipped, deferred, or intentionally simplified, with rationale. This document is updated after each phase.

## Phase 0: Scaffold, Spec, Tooling
- **Database Schema**: Phase 0 includes initial migrations setup (`migrations/` directory, migration runner, and baseline migration table) with a minimal initial migration table check. The full ticket/event/note schema will be introduced in subsequent phases following specification breakdown.
- **Docker in Test Runner**: Vitest unit/integration tests can run against an in-memory/mock pool or test database. Docker Compose is provided for local and containerized development.
- **Seeds**: Seed script placeholder created for initial DB migrations verification; full agent/holiday seeds will be expanded in the respective phase.

