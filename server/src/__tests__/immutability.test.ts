import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Database Immutability Triggers (Direct SQL)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();

    // Read and run migration SQL files
    const baselineSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/001_baseline.sql'), 'utf-8');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/002_schema.sql'), 'utf-8');
    const triggersSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/003_immutability_triggers.sql'), 'utf-8');

    await db.exec(baselineSql);
    await db.exec(schemaSql);
    await db.exec(triggersSql);

    // Seed test user and customer
    await db.query(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES ('11111111-1111-1111-1111-111111111111', 'Test Agent', 'agent@arvosystems.com', 'hash', 'agent');
    `);

    await db.query(`
      INSERT INTO customers (id, name, email)
      VALUES ('22222222-2222-2222-2222-222222222222', 'Test Customer', 'cust@example.com');
    `);

    await db.query(`
      INSERT INTO tickets (
        id, subject, description, priority, status, customer_id, public_token,
        clock_start, response_due_at, resolution_due_at
      )
      VALUES (
        '33333333-3333-3333-3333-333333333333', 'Test Ticket', 'Description', 'Medium', 'OPEN',
        '22222222-2222-2222-2222-222222222222', 'token-1234567890abcdef',
        NOW(), NOW() + INTERVAL '4 hours', NOW() + INTERVAL '3 days'
      );
    `);
  });

  describe('ticket_events immutability', () => {
    it('rejects direct SQL UPDATE on ticket_events', async () => {
      const insertRes = await db.query<{ id: string }>(`
        INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, payload)
        VALUES ('33333333-3333-3333-3333-333333333333', 'ticket_created', 'customer', 'Test Customer', '{}')
        RETURNING id;
      `);
      const eventId = insertRes.rows[0].id;

      await expect(
        db.query(`UPDATE ticket_events SET actor_name = 'Hacker' WHERE id = $1;`, [eventId])
      ).rejects.toThrow(/immutable.*prohibited/i);
    });

    it('rejects direct SQL DELETE on ticket_events', async () => {
      const insertRes = await db.query<{ id: string }>(`
        INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, payload)
        VALUES ('33333333-3333-3333-3333-333333333333', 'claimed', 'agent', 'Test Agent', '{}')
        RETURNING id;
      `);
      const eventId = insertRes.rows[0].id;

      await expect(
        db.query(`DELETE FROM ticket_events WHERE id = $1;`, [eventId])
      ).rejects.toThrow(/immutable.*prohibited/i);
    });
  });

  describe('messages immutability', () => {
    it('rejects direct SQL UPDATE on messages', async () => {
      const insertRes = await db.query<{ id: string }>(`
        INSERT INTO messages (ticket_id, sender_type, sender_name, body)
        VALUES ('33333333-3333-3333-3333-333333333333', 'customer', 'Test Customer', 'Initial inquiry')
        RETURNING id;
      `);
      const messageId = insertRes.rows[0].id;

      await expect(
        db.query(`UPDATE messages SET body = 'Tampered text' WHERE id = $1;`, [messageId])
      ).rejects.toThrow(/immutable.*prohibited/i);
    });

    it('rejects direct SQL DELETE on messages', async () => {
      const insertRes = await db.query<{ id: string }>(`
        INSERT INTO messages (ticket_id, sender_type, sender_name, body)
        VALUES ('33333333-3333-3333-3333-333333333333', 'agent', 'Test Agent', 'Public agent reply')
        RETURNING id;
      `);
      const messageId = insertRes.rows[0].id;

      await expect(
        db.query(`DELETE FROM messages WHERE id = $1;`, [messageId])
      ).rejects.toThrow(/immutable.*prohibited/i);
    });
  });

  describe('internal_notes immutability', () => {
    it('rejects direct SQL UPDATE on internal_notes', async () => {
      const insertRes = await db.query<{ id: string }>(`
        INSERT INTO internal_notes (ticket_id, author_id, author_name, body)
        VALUES (
          '33333333-3333-3333-3333-333333333333',
          '11111111-1111-1111-1111-111111111111',
          'Test Agent',
          'Confidential team note'
        )
        RETURNING id;
      `);
      const noteId = insertRes.rows[0].id;

      await expect(
        db.query(`UPDATE internal_notes SET body = 'Tampered internal note' WHERE id = $1;`, [noteId])
      ).rejects.toThrow(/immutable.*prohibited/i);
    });

    it('rejects direct SQL DELETE on internal_notes', async () => {
      const insertRes = await db.query<{ id: string }>(`
        INSERT INTO internal_notes (ticket_id, author_id, author_name, body)
        VALUES (
          '33333333-3333-3333-3333-333333333333',
          '11111111-1111-1111-1111-111111111111',
          'Test Agent',
          'Another private note'
        )
        RETURNING id;
      `);
      const noteId = insertRes.rows[0].id;

      await expect(
        db.query(`DELETE FROM internal_notes WHERE id = $1;`, [noteId])
      ).rejects.toThrow(/immutable.*prohibited/i);
    });
  });
});
