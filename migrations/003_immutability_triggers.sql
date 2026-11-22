-- 003_immutability_triggers.sql
-- Enforce database-level immutability on ticket_events, messages, and internal_notes.
-- Any UPDATE, DELETE, or TRUNCATE operation will raise an exception.

CREATE OR REPLACE FUNCTION enforce_table_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is immutable: % operations are strictly prohibited', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

-- 1. ticket_events immutability triggers
DROP TRIGGER IF EXISTS trg_prevent_update_delete_ticket_events ON ticket_events;
CREATE TRIGGER trg_prevent_update_delete_ticket_events
BEFORE UPDATE OR DELETE ON ticket_events
FOR EACH ROW
EXECUTE FUNCTION enforce_table_immutability();

DROP TRIGGER IF EXISTS trg_prevent_truncate_ticket_events ON ticket_events;
CREATE TRIGGER trg_prevent_truncate_ticket_events
BEFORE TRUNCATE ON ticket_events
FOR EACH STATEMENT
EXECUTE FUNCTION enforce_table_immutability();

-- 2. messages immutability triggers
DROP TRIGGER IF EXISTS trg_prevent_update_delete_messages ON messages;
CREATE TRIGGER trg_prevent_update_delete_messages
BEFORE UPDATE OR DELETE ON messages
FOR EACH ROW
EXECUTE FUNCTION enforce_table_immutability();

DROP TRIGGER IF EXISTS trg_prevent_truncate_messages ON messages;
CREATE TRIGGER trg_prevent_truncate_messages
BEFORE TRUNCATE ON messages
FOR EACH STATEMENT
EXECUTE FUNCTION enforce_table_immutability();

-- 3. internal_notes immutability triggers
DROP TRIGGER IF EXISTS trg_prevent_update_delete_internal_notes ON internal_notes;
CREATE TRIGGER trg_prevent_update_delete_internal_notes
BEFORE UPDATE OR DELETE ON internal_notes
FOR EACH ROW
EXECUTE FUNCTION enforce_table_immutability();

DROP TRIGGER IF EXISTS trg_prevent_truncate_internal_notes ON internal_notes;
CREATE TRIGGER trg_prevent_truncate_internal_notes
BEFORE TRUNCATE ON internal_notes
FOR EACH STATEMENT
EXECUTE FUNCTION enforce_table_immutability();

