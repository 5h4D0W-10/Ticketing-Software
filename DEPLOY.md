# Frontdesk - Production Deployment Guide

Frontdesk is packaged as a **single deployable unit**: the Node.js/Express backend serves both the REST API (`/api/*`) and the built React/Vite single-page application (`web/dist`) as static assets. Database migrations and idempotent seed data are executed automatically on application startup.

---

## Deployment Architecture

```
[ Web Browser ]
      │
      ▼ (HTTPS)
[ Frontdesk Web Service (Node.js + Express) ]
  ├── Static Frontend: /dist (React + Vite SPA)
  ├── Customer API: /api/customer/*
  ├── Agent API: /api/agent/*
  ├── Auth: /api/auth/*
  ├── Internal Webhook: /api/internal/sweep
  └── Health Check: /health
      │
      ▼ (TCP / SSL)
[ Managed PostgreSQL 15+ Database ]
```

---

## Option 1: Render (Recommended - Free Tier)

Render provides both a free Web Service (Node.js) and a free managed PostgreSQL instance.

### Method A: One-Click Blueprint Deployment (Automated via `render.yaml`)

This repository contains a pre-configured `render.yaml` Blueprint file that automatically creates both the managed PostgreSQL database and the web service, links their connection strings, and generates secure secrets with zero manual configuration.

1. Log in to [dashboard.render.com](https://dashboard.render.com/).
2. Click **New +** and select **Blueprint**.
3. Connect your GitHub repository (`https://github.com/5h4D0W-10/Ticketing-Software.git`).
4. Render will parse `render.yaml` and display the resources to create:
   - **Database**: `frontdesk-db` (Free PostgreSQL)
   - **Web Service**: `frontdesk-app` (Free Node Web Service)
5. Click **Apply**.
6. Render will automatically provision PostgreSQL, run `npm install && npm run build`, execute database migrations and seed data on startup, and launch the service at `https://frontdesk-app.onrender.com`.

---

### Method B: Manual Dashboard Setup

If you prefer to configure the services manually:

#### Step 1: Create a PostgreSQL Database on Render
1. Log in to [dashboard.render.com](https://dashboard.render.com/).
2. Click **New +** and select **PostgreSQL**.
3. Configure the database:
   - **Name**: `frontdesk-db`
   - **Database**: `frontdesk`
   - **User**: `frontdesk_user`
   - **Region**: Choose closest to target users (e.g. `Singapore` or `Frankfurt`).
   - **Plan**: Select **Free**.
4. Click **Create Database**.
5. Once provisioned, locate the **Connections** panel and copy the **Internal Database URL** (or **External Database URL** if deploying services across different regions).

### Step 2: Create the Frontdesk Web Service
1. In the Render Dashboard, click **New +** and select **Web Service**.
2. Connect your Git repository (GitHub or GitLab).
3. Configure the service settings:
   - **Name**: `frontdesk-app` (or your chosen name)
   - **Region**: Same region as your database.
   - **Branch**: `master` (or `main`)
   - **Root Directory**: *(Leave empty to use repo root)*
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     npm install && npm run build
     ```
   - **Start Command**:
     ```bash
     npm run start
     ```
   - **Plan**: Select **Free**.

### Step 3: Configure Environment Variables
Under the **Environment Variables** section on Render, add:

| Variable Name | Example / Recommended Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production optimizations and security flags |
| `DATABASE_URL` | `postgres://user:password@host/database?ssl=true` | Connection string from Render Postgres |
| `JWT_SECRET` | `c8f2a1705e4b9319e7284b30e18d6a4a` | Random 32+ character string for signing agent tokens |
| `INTERNAL_SECRET` | `frontdesk-prod-sweep-secret-99` | Secret header for external webhook `POST /api/internal/sweep` |
| `PORT` | `10000` | Port assigned by Render (auto-bound) |

4. Click **Create Web Service**.

### Step 4: Automatic Boot & Seeding
On startup, Frontdesk automatically:
1. Connects to PostgreSQL and runs all SQL migrations in `/migrations`.
2. Seeds the database with:
   - Lead Supervisor (`lead@arvosystems.com` / `Password123!`)
   - 9 Support Agents (`agent1@arvosystems.com` .. `agent9@arvosystems.com` / `Password123!`)
   - 2026 Kerala & Indian festival/public holidays
   - 10 sample tickets covering late Urgent, nearly due Medium, Small fine, waiting on customer, about to auto-close, resolved near reopen window, Friday 6 PM ticket, unassigned queue, and reopened ticket.
3. Initializes the background cron scheduler (`node-cron`) for SLA sweeps.

---

## Option 2: Railway (Alternative)

Railway provides one-click monorepo deployment with native PostgreSQL.

1. Go to [railway.app](https://railway.app/) and create a **New Project**.
2. Click **Provision PostgreSQL**.
3. Click **New Service** -> **GitHub Repo** -> select your repository.
4. Go to **Settings**:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
5. Go to **Variables** and add:
   - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}` *(Railway variable reference)*
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: `<random-32-char-string>`
   - `INTERNAL_SECRET`: `<random-secret>`
6. Railway will automatically build and expose a public HTTPS domain.

---

## Option 3: Fly.io + Neon PostgreSQL

If deploying on Fly.io with a serverless PostgreSQL provider like [Neon](https://neon.tech):

1. Create a free PostgreSQL instance on [Neon](https://neon.tech) and copy the connection string:
   ```
   postgres://[user]:[password]@[endpoint].neon.tech/neondb?sslmode=require
   ```
2. Launch on Fly.io:
   ```bash
   fly launch --no-deploy
   ```
3. Set secrets:
   ```bash
   fly secrets set DATABASE_URL="postgres://..." JWT_SECRET="your-jwt-secret" NODE_ENV="production"
   ```
4. Deploy:
   ```bash
   fly deploy
   ```

---

## Requirement: Keeping the Live URL Up for 1 Week

The hiring specification requires the live URL to **stay up for at least one week**. Keep the following platform-specific risks in mind:

### 1. Free-Tier Cold Starts / Inactivity Sleep
- **The Issue**: On Render's free tier, web services spin down into sleep mode after 15 minutes of zero HTTP traffic. When a user visits the URL, the service takes ~30–50 seconds to cold start.
- **Why Frontdesk is Immune to SLA Drift**:
  - Frontdesk implements **lazy SLA sweeps**: every time an agent or customer reads a ticket or list (`GET /api/agent/tickets`, `GET /api/customer/tickets/:token`), the working-time engine sweeps pending auto-closes and checks sticky breach events.
  - Calculations use immutable database timestamps and `Asia/Kolkata` working minutes, ensuring zero SLA drift or missed breaches even if the service was asleep over a weekend.
- **How to Avoid Cold Starts Entirely (Keep Alive)**:
  - Set up a free ping monitor (e.g., [UptimeRobot](https://uptimerobot.com/), [cron-job.org](https://cron-job.org/), or a simple GitHub Actions scheduled workflow) to send a `GET` request to `https://<your-app>.onrender.com/health` every **10 minutes**.
  - This keeps the service permanently warm throughout the evaluation week.

### 2. Free Database Expiry
- **Render PostgreSQL**: Free Render databases remain active for **30 days** before being terminated. A 1-week test falls well within this window.
- **Neon Serverless**: Neon compute auto-suspends when idle; the `pg` connection pool handles auto-resumption transparently upon arrival of new queries.

---

## Verification & Sanity Checklist

After deployment completes:

1. **Health Check**:
   ```bash
   curl -i https://<your-live-url>/health
   ```
   Expect:
   ```json
   {
     "status": "ok",
     "service": "frontdesk-backend",
     "database": "connected",
     "timestamp": "..."
   }
   ```

2. **Customer Portal**:
   - Visit `https://<your-live-url>/` in your browser.
   - Submit a test ticket and verify that a secret token URL is generated.

3. **Agent Portal**:
   - Navigate to `https://<your-live-url>/#/agent/login`.
   - Log in with `lead@arvosystems.com` / `Password123!`.
   - Verify the "My tickets" dashboard displays the 10 seeded tickets with `🔴 LATE` and `⏳ WAITING ON CUSTOMER` badges.
   - Inspect the **Late Report** (`/agent/reports/late`) to see computed explanations and excluded customer waiting times.

