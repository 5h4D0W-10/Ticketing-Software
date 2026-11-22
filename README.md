# Frontdesk - Arvo Systems Support Ticket System

Frontdesk is a support-ticket system built for Arvo Systems to eliminate late tickets and untracked SLA breaches through strict working-time SLA tracking, immutable audit trails, and concurrency-safe assignment.

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
5. **Architecture & Testing**:
   - Monorepo with `/server` (Node.js + TypeScript + Express + `pg` + Vitest) and `/web` (React + Vite + TypeScript).
   - Injectable `Clock` abstraction (`SystemClock`, `FakeClock`) for deterministic simulation of SLA policies and time-travel tests.
   - Tests run in-memory and against embedded PostgreSQL (PGlite) when a standalone PostgreSQL daemon is not present.

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

## API Overview & Health Check
- `GET /health` - Service health status and database connectivity check.
