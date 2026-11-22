# Frontdesk - Arvo Systems Support Ticket System

Frontdesk is a support-ticket system built for Arvo Systems to eliminate late tickets and untracked SLA breaches through strict working-time SLA tracking, immutable audit trails, and concurrency-safe assignment.

---

## Assumptions & Decisions

1. **Working Time & SLA Targets (Asia/Kolkata)**:
   - Operating hours are Monday through Friday, 09:30 to 18:30 IST (9 working hours per day).
   - Weekends (Saturday and Sunday) and festival/public holidays are excluded from SLA calculations.
   - Per specification, no lunch break is deducted within the 9:30–18:30 window.
   - Priority targets:
     - **Urgent**: First reply within 2 working hours; resolve by 18:30 on the same working day (or next working day if received outside working hours).
     - **Medium**: First reply within 4.5 working hours (half working day); resolve within 27 working hours (3 working days).
     - **Small**: First reply within 9 working hours (1 working day); resolve within 45 working hours (5 working days / 1 working week).
2. **Architecture & Monorepo**:
   - Monorepo with `/server` (Node.js + TypeScript + Express + `pg` + Vitest) and `/web` (React + Vite + TypeScript).
   - Single deployable backend: in production, Express serves the compiled React frontend from `/web/dist`.
3. **Database Migrations**:
   - Plain SQL files in `/migrations/` applied in alphanumeric order.
   - Recorded in a `schema_migrations` table inside a transaction per migration.
4. **Time & Clocks**:
   - All timestamps stored in UTC (`TIMESTAMPTZ`), computed in `Asia/Kolkata`.
   - Business logic uses an injectable clock abstraction to allow deterministic testing of time-based rules.

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

