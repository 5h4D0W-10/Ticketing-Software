-- 002_schema.sql
-- Frontdesk Core Schema: Users, Customers, Tickets, Messages, Internal Notes, Ticket Events, SLA Pauses, Holidays

-- Enable pgcrypto / uuid-ossp for UUID generation
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN OTHERS THEN
    NULL;
END;
$$;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN
    NULL;
END;
$$;

-- 1. Users (agents and leads)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('agent', 'lead')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Customers
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tickets
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number SERIAL UNIQUE,
    subject VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('Urgent', 'Medium', 'Small')),
    status VARCHAR(30) NOT NULL CHECK (status IN ('NEW', 'OPEN', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    version INT NOT NULL DEFAULT 1,
    clock_start TIMESTAMPTZ NOT NULL,
    response_due_at TIMESTAMPTZ NOT NULL,
    resolution_due_at TIMESTAMPTZ NOT NULL,
    first_response_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    cycle INT NOT NULL DEFAULT 1,
    parent_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    public_token VARCHAR(64) UNIQUE NOT NULL,
    first_response_breached BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_breached BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_public_token ON tickets(public_token);
CREATE INDEX IF NOT EXISTS idx_tickets_parent_ticket_id ON tickets(parent_ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_clock_start ON tickets(clock_start);

-- 4. Messages (Customer-visible only)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('customer', 'agent', 'system')),
    sender_id UUID,
    sender_name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_ticket_id ON messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- 5. Internal Notes (Team-only, separate table)
CREATE TABLE IF NOT EXISTS internal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    author_name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_ticket_id ON internal_notes(ticket_id);
CREATE INDEX IF NOT EXISTS idx_internal_notes_created_at ON internal_notes(created_at);

-- 6. Ticket Events (Append-only audit trail)
CREATE TABLE IF NOT EXISTS ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    event_type VARCHAR(50) NOT NULL CHECK (
        event_type IN (
            'ticket_created', 'claimed', 'released', 'public_reply',
            'internal_note_added', 'status_changed', 'priority_changed',
            'sla_paused', 'sla_resumed', 'sla_breached', 'auto_closed',
            'reopened', 'reopen_rejected', 'holiday_changed'
        )
    ),
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('agent', 'customer', 'system')),
    actor_id UUID,
    actor_name VARCHAR(255) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id ON ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_occurred_at ON ticket_events(occurred_at);

-- 7. SLA Pauses
CREATE TABLE IF NOT EXISTS sla_pauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    cycle INT NOT NULL DEFAULT 1,
    paused_at TIMESTAMPTZ NOT NULL,
    resumed_at TIMESTAMPTZ,
    working_minutes_paused INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_pauses_ticket_id ON sla_pauses(ticket_id);

-- 8. Holidays (Editable list of festival/public holidays)
CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    holiday_date DATE UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_holiday_date ON holidays(holiday_date);
