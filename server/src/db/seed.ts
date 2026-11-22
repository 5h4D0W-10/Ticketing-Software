import { pool } from './connection.js';
import { createIstDate } from '../time/workingTime.js';
import { computeDeadlines } from '../time/slaPolicy.js';

export async function runSeeds(customPool = pool): Promise<void> {
  const client = await customPool.connect();

  try {
    console.log('--- Frontdesk Database Seeding ---');

    // 1. Ensure system metadata
    await client.query(`
      INSERT INTO system_metadata (key, value)
      VALUES ('seeds_version', '1.0.0')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    `);

    // 2. Fetch seeded holidays from DB for working-time calculations
    const holRes = await client.query<{ holiday_date: string }>('SELECT holiday_date FROM holidays;');
    const holidayDates = holRes.rows.map((r) => r.holiday_date);

    // 3. Check if tickets already exist (idempotent check)
    const ticketCountRes = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM tickets;');
    const ticketCount = parseInt(ticketCountRes.rows[0].count, 10);

    if (ticketCount > 0) {
      console.log(`Tickets table already contains ${ticketCount} ticket(s). Skipping sample ticket seeding (idempotent).`);
      printCredentials();
      return;
    }

    console.log('Seeding sample customers, tickets, messages, notes, and audit events...');

    // 4. Seed Customers
    const customers = [
      { id: 'c0000000-0000-0000-0000-000000000001', name: 'Acme Corp Tech', email: 'tech@acmecorp.com' },
      { id: 'c0000000-0000-0000-0000-000000000002', name: 'Zenith Logistics', email: 'ops@zenithlogistics.in' },
      { id: 'c0000000-0000-0000-0000-000000000003', name: 'BlueStar Health', email: 'admin@bluestarhealth.org' },
      { id: 'c0000000-0000-0000-0000-000000000004', name: 'FinTech Cloud', email: 'support@fintechcloud.com' },
      { id: 'c0000000-0000-0000-0000-000000000005', name: 'Kerala Retail Hub', email: 'manager@keralaretail.com' },
    ];

    for (const c of customers) {
      await client.query(
        `INSERT INTO customers (id, name, email)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING;`,
        [c.id, c.name, c.email]
      );
    }

    // Agent IDs
    const agent1 = 'a0000000-0000-0000-0000-000000000001';
    const agent2 = 'a0000000-0000-0000-0000-000000000002';
    const agent3 = 'a0000000-0000-0000-0000-000000000003';
    const agent4 = 'a0000000-0000-0000-0000-000000000004';
    const agent5 = 'a0000000-0000-0000-0000-000000000005';
    const agent6 = 'a0000000-0000-0000-0000-000000000006';
    const agent7 = 'a0000000-0000-0000-0000-000000000007';

    // =========================================================================
    // Ticket 1: LATE URGENT (Breached First Reply)
    // =========================================================================
    const t1ClockStart = createIstDate(2026, 11, 23, 9, 30, 0);
    const t1Deadlines = computeDeadlines(t1ClockStart, 'Urgent', holidayDates);
    const t1ResponseDue = t1Deadlines.responseDueAt;
    const t1ResDue = t1Deadlines.resolutionDueAt;

    const t1Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at, first_response_breached, resolution_breached,
         public_token, created_at, updated_at
       ) VALUES (
         1001, $1, 'Payment Gateway rejecting all live transactions',
         'All production checkouts are failing with 500 error since 9:30 AM.',
         'Urgent', 'OPEN', $2, $3, $4, $5, true, false,
         'tok_live_seed_late_urgent_1001_abcde123456789012345', $3, $3
       ) RETURNING id;`,
      [customers[0].id, agent1, t1ClockStart, t1ResponseDue, t1ResDue]
    );
    const t1Id = t1Res.rows[0].id;

    // Events for Ticket 1
    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES
         ($1, 'ticket_created', 'customer', 'Acme Corp Tech', $2, '{"priority":"Urgent"}'),
         ($1, 'sla_breached', 'system', 'system', $3, '{"milestone":"first_response","deadline":"' || $3 || '"}'),
         ($1, 'claimed', 'agent', 'Agent One', $4, '{"assigneeId":"' || $5 || '"}');`,
      [t1Id, t1ClockStart, t1ResponseDue.toISOString(), createIstDate(2026, 11, 23, 12, 10, 0), agent1]
    );
    await client.query(
      `INSERT INTO messages (ticket_id, sender_type, sender_name, body, created_at)
       VALUES ($1, 'customer', 'Acme Corp Tech', 'Urgent: Payment gateway down. Please fix immediately.', $2);`,
      [t1Id, t1ClockStart]
    );
    await client.query(
      `INSERT INTO internal_notes (ticket_id, author_id, author_name, body, created_at)
       VALUES ($1, $2, 'Agent One', 'Checked Stripe webhook signatures. Credentials rotated without updating webhook secret.', $3);`,
      [t1Id, agent1, createIstDate(2026, 11, 23, 12, 15, 0)]
    );

    // =========================================================================
    // Ticket 2: MEDIUM NEARLY DUE (~45 minutes remaining on first reply)
    // =========================================================================
    const t2ClockStart = createIstDate(2026, 11, 25, 10, 0, 0);
    const t2Deadlines = computeDeadlines(t2ClockStart, 'Medium', holidayDates);
    const t2ResponseDue = t2Deadlines.responseDueAt;
    const t2ResDue = t2Deadlines.resolutionDueAt;

    const t2Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at,
         public_token, created_at, updated_at
       ) VALUES (
         1002, $1, 'Report generation timing out for monthly CSV export',
         'Exporting more than 10,000 rows results in a 504 Gateway Timeout.',
         'Medium', 'OPEN', $2, $3, $4, $5,
         'tok_live_seed_medium_nearly_due_1002_bcdef23456789012', $3, $3
       ) RETURNING id;`,
      [customers[1].id, agent2, t2ClockStart, t2ResponseDue, t2ResDue]
    );
    const t2Id = t2Res.rows[0].id;

    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES
         ($1, 'ticket_created', 'customer', 'Zenith Logistics', $2, '{"priority":"Medium"}'),
         ($1, 'claimed', 'agent', 'Agent Two', $3, '{"assigneeId":"' || $4 || '"}');`,
      [t2Id, t2ClockStart, createIstDate(2026, 11, 25, 10, 15, 0), agent2]
    );
    await client.query(
      `INSERT INTO messages (ticket_id, sender_type, sender_name, body, created_at)
       VALUES ($1, 'customer', 'Zenith Logistics', 'The monthly CSV report fails to generate for November.', $2);`,
      [t2Id, t2ClockStart]
    );

    // =========================================================================
    // Ticket 3: SMALL FINE (On Track, Plenty of Working Time Remaining)
    // =========================================================================
    const t3ClockStart = createIstDate(2026, 11, 25, 10, 30, 0);
    const t3Deadlines = computeDeadlines(t3ClockStart, 'Small', holidayDates);
    const t3ResponseDue = t3Deadlines.responseDueAt;
    const t3ResDue = t3Deadlines.resolutionDueAt;

    const t3Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at, first_response_at,
         public_token, created_at, updated_at
       ) VALUES (
         1003, $1, 'Request to add new user email to notification alias',
         'Please add dispatch@bluestarhealth.org to the system notifications list.',
         'Small', 'OPEN', $2, $3, $4, $5, $6,
         'tok_live_seed_small_fine_1003_cdefg3456789012345678', $3, $6
       ) RETURNING id;`,
      [customers[2].id, agent3, t3ClockStart, t3ResponseDue, t3ResDue, createIstDate(2026, 11, 25, 11, 0, 0)]
    );
    const t3Id = t3Res.rows[0].id;

    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES
         ($1, 'ticket_created', 'customer', 'BlueStar Health', $2, '{"priority":"Small"}'),
         ($1, 'claimed', 'agent', 'Agent Three', $3, '{"assigneeId":"' || $4 || '"}'),
         ($1, 'public_reply', 'agent', 'Agent Three', $5, '{"body":"Acknowledged, reviewing configuration."}');`,
      [t3Id, t3ClockStart, createIstDate(2026, 11, 25, 10, 45, 0), agent3, createIstDate(2026, 11, 25, 11, 0, 0)]
    );
    await client.query(
      `INSERT INTO messages (ticket_id, sender_type, sender_name, body, created_at)
       VALUES
         ($1, 'customer', 'BlueStar Health', 'Hi, can you add dispatch@bluestarhealth.org to notification alias?', $2),
         ($1, 'agent', 'Agent Three', 'Hello! We have received your request and are verifying access permissions.', $3);`,
      [t3Id, t3ClockStart, createIstDate(2026, 11, 25, 11, 0, 0)]
    );

    // =========================================================================
    // Ticket 4: WAITING ON CUSTOMER (SLA Clock Paused, R2)
    // =========================================================================
    const t4ClockStart = createIstDate(2026, 11, 24, 11, 0, 0);
    const t4Deadlines = computeDeadlines(t4ClockStart, 'Medium', holidayDates);
    const t4ResponseDue = t4Deadlines.responseDueAt;
    const t4ResDue = t4Deadlines.resolutionDueAt;
    const t4PausedAt = createIstDate(2026, 11, 24, 14, 0, 0);

    const t4Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at, first_response_at,
         public_token, created_at, updated_at
       ) VALUES (
         1004, $1, 'Intermittent 502 Bad Gateway during peak checkout hours',
         'Customers reporting occasional 502 errors between 1 PM and 2 PM.',
         'Medium', 'WAITING_CUSTOMER', $2, $3, $4, $5, $6,
         'tok_live_seed_waiting_customer_1004_defgh45678901234', $3, $6
       ) RETURNING id;`,
      [customers[3].id, agent4, t4ClockStart, t4ResponseDue, t4ResDue, t4PausedAt]
    );
    const t4Id = t4Res.rows[0].id;

    // Active pause interval
    await client.query(
      `INSERT INTO sla_pauses (ticket_id, cycle, paused_at, resumed_at)
       VALUES ($1, 1, $2, NULL);`,
      [t4Id, t4PausedAt]
    );
    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES
         ($1, 'ticket_created', 'customer', 'FinTech Cloud', $2, '{"priority":"Medium"}'),
         ($1, 'claimed', 'agent', 'Agent Four', $3, '{"assigneeId":"' || $4 || '"}'),
         ($1, 'public_reply', 'agent', 'Agent Four', $5, '{"body":"Please provide request IDs"}'),
         ($1, 'sla_paused', 'agent', 'Agent Four', $5, '{"reason":"waiting_customer"}'),
         ($1, 'status_changed', 'agent', 'Agent Four', $5, '{"oldStatus":"OPEN","newStatus":"WAITING_CUSTOMER"}');`,
      [t4Id, t4ClockStart, createIstDate(2026, 11, 24, 11, 30, 0), agent4, t4PausedAt]
    );
    await client.query(
      `INSERT INTO messages (ticket_id, sender_type, sender_name, body, created_at)
       VALUES
         ($1, 'customer', 'FinTech Cloud', 'We are seeing intermittent 502 errors during high traffic periods.', $2),
         ($1, 'agent', 'Agent Four', 'Could you share specific timestamps and request IDs for the failed requests so we can check server logs?', $3);`,
      [t4Id, t4ClockStart, t4PausedAt]
    );

    // =========================================================================
    // Ticket 5: ABOUT TO AUTO-CLOSE (Silent in WAITING_CUSTOMER for ~36 working hours)
    // =========================================================================
    const t5ClockStart = createIstDate(2026, 11, 19, 10, 0, 0);
    const t5Deadlines = computeDeadlines(t5ClockStart, 'Small', holidayDates);
    const t5ResponseDue = t5Deadlines.responseDueAt;
    const t5ResDue = t5Deadlines.resolutionDueAt;
    const t5PausedAt = createIstDate(2026, 11, 19, 12, 0, 0); // ~4 working days ago

    const t5Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at, first_response_at,
         public_token, created_at, updated_at
       ) VALUES (
         1005, $1, 'Question about invoice formatting for GST compliance',
         'Need clarification on B2B e-invoicing field mapping.',
         'Small', 'WAITING_CUSTOMER', $2, $3, $4, $5, $6,
         'tok_live_seed_about_to_autoclose_1005_efghi567890123', $3, $6
       ) RETURNING id;`,
      [customers[4].id, agent5, t5ClockStart, t5ResponseDue, t5ResDue, t5PausedAt]
    );
    const t5Id = t5Res.rows[0].id;

    await client.query(
      `INSERT INTO sla_pauses (ticket_id, cycle, paused_at, resumed_at)
       VALUES ($1, 1, $2, NULL);`,
      [t5Id, t5PausedAt]
    );
    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES
         ($1, 'ticket_created', 'customer', 'Kerala Retail Hub', $2, '{"priority":"Small"}'),
         ($1, 'claimed', 'agent', 'Agent Five', $3, '{"assigneeId":"' || $4 || '"}'),
         ($1, 'public_reply', 'agent', 'Agent Five', $5, '{"body":"Which GSTIN format are you using?"}'),
         ($1, 'sla_paused', 'agent', 'Agent Five', $5, '{"reason":"waiting_customer"}');`,
      [t5Id, t5ClockStart, createIstDate(2026, 11, 19, 10, 30, 0), agent5, t5PausedAt]
    );

    // =========================================================================
    // Ticket 6: RESOLVED NEAR REOPEN LIMIT (Resolved ~4 working days ago)
    // =========================================================================
    const t6ClockStart = createIstDate(2026, 11, 19, 9, 30, 0);
    const t6Deadlines = computeDeadlines(t6ClockStart, 'Medium', holidayDates);
    const t6ResponseDue = t6Deadlines.responseDueAt;
    const t6ResDue = t6Deadlines.resolutionDueAt;
    const t6ResolvedAt = createIstDate(2026, 11, 19, 16, 30, 0);

    const t6Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at, first_response_at, resolved_at,
         public_token, created_at, updated_at
       ) VALUES (
         1006, $1, 'SSO login failure with Okta SAML integration',
         'SAML certificate expired on customer IdP metadata.',
         'Medium', 'RESOLVED', $2, $3, $4, $5, $6, $7,
         'tok_live_seed_resolved_near_limit_1006_fghij678901234', $3, $7
       ) RETURNING id;`,
      [customers[0].id, agent6, t6ClockStart, t6ResponseDue, t6ResDue, createIstDate(2026, 11, 19, 11, 0, 0), t6ResolvedAt]
    );
    const t6Id = t6Res.rows[0].id;

    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES
         ($1, 'ticket_created', 'customer', 'Acme Corp Tech', $2, '{"priority":"Medium"}'),
         ($1, 'claimed', 'agent', 'Agent Six', $3, '{"assigneeId":"' || $4 || '"}'),
         ($1, 'public_reply', 'agent', 'Agent Six', $5, '{"body":"Please upload renewed x509 cert"}'),
         ($1, 'status_changed', 'agent', 'Agent Six', $6, '{"oldStatus":"OPEN","newStatus":"RESOLVED"}');`,
      [t6Id, t6ClockStart, createIstDate(2026, 11, 19, 10, 0, 0), agent6, createIstDate(2026, 11, 19, 11, 0, 0), t6ResolvedAt]
    );

    // =========================================================================
    // Ticket 7: CREATED FRIDAY 6 PM (SPEC Mandatory Test Case!)
    // Arrived Friday 6:00 PM -> NOT late on Sunday or Monday morning!
    // =========================================================================
    const t7CreatedFriday = createIstDate(2026, 11, 20, 18, 0, 0); // Friday 18:00 IST
    const t7Deadlines = computeDeadlines(t7CreatedFriday, 'Medium', holidayDates);
    const t7ClockStart = t7Deadlines.clockStart;
    const t7ResponseDue = t7Deadlines.responseDueAt;
    const t7ResDue = t7Deadlines.resolutionDueAt;

    const t7Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at,
         public_token, created_at, updated_at
       ) VALUES (
         1007, $1, 'Batch synchronization job failed over weekend (Arrived Friday 6:00 PM)',
         'Nightly sync job encountered socket hang up at 18:00 IST Friday.',
         'Medium', 'NEW', NULL, $2, $3, $4,
         'tok_live_seed_friday_6pm_1007_ghijkl78901234567890', $2, $2
       ) RETURNING id;`,
      [customers[1].id, t7ClockStart, t7ResponseDue, t7ResDue]
    );
    const t7Id = t7Res.rows[0].id;

    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES ($1, 'ticket_created', 'customer', 'Zenith Logistics', $2, '{"priority":"Medium","note":"Arrived Friday 18:00 IST. Clock starts Monday 09:30 AM."}');`,
      [t7Id, t7CreatedFriday]
    );
    await client.query(
      `INSERT INTO messages (ticket_id, sender_type, sender_name, body, created_at)
       VALUES ($1, 'customer', 'Zenith Logistics', 'Batch sync failed right before the weekend at 6:00 PM Friday.', $2);`,
      [t7Id, t7CreatedFriday]
    );

    // =========================================================================
    // Ticket 8A & 8B: UNASSIGNED QUEUE TICKETS (Ready for "Take this ticket")
    // =========================================================================
    const t8AClockStart = createIstDate(2026, 11, 25, 10, 15, 0);
    const t8ADeadlines = computeDeadlines(t8AClockStart, 'Small', holidayDates);
    const t8ARespDue = t8ADeadlines.responseDueAt;
    const t8AResDue = t8ADeadlines.resolutionDueAt;

    const t8ARes = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at,
         public_token, created_at, updated_at
       ) VALUES (
         1008, $1, 'Unable to update company billing address on settings page',
         'Save button remains disabled after typing PIN code.',
         'Small', 'NEW', NULL, $2, $3, $4,
         'tok_live_seed_unassigned_8a_1008_hijklm890123456789', $2, $2
       ) RETURNING id;`,
      [customers[2].id, t8AClockStart, t8ARespDue, t8AResDue]
    );
    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES ($1, 'ticket_created', 'customer', 'BlueStar Health', $2, '{"priority":"Small"}');`,
      [t8ARes.rows[0].id, t8AClockStart]
    );

    const t8BClockStart = createIstDate(2026, 11, 25, 10, 45, 0);
    const t8BDeadlines = computeDeadlines(t8BClockStart, 'Urgent', holidayDates);
    const t8BRespDue = t8BDeadlines.responseDueAt;
    const t8BResDue = t8BDeadlines.resolutionDueAt;

    const t8BRes = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at,
         public_token, created_at, updated_at
       ) VALUES (
         1009, $1, 'Urgent: Webhook endpoints returning HTTP 500 internal server error',
         'Production order dispatch notifications are failing to reach third-party carrier.',
         'Urgent', 'NEW', NULL, $2, $3, $4,
         'tok_live_seed_unassigned_8b_1009_ijklmn901234567890', $2, $2
       ) RETURNING id;`,
      [customers[3].id, t8BClockStart, t8BRespDue, t8BResDue]
    );
    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES ($1, 'ticket_created', 'customer', 'FinTech Cloud', $2, '{"priority":"Urgent"}');`,
      [t8BRes.rows[0].id, t8BClockStart]
    );

    // =========================================================================
    // Ticket 9: REOPENED TICKET (Cycle = 2, R4)
    // =========================================================================
    const t9Cycle1Start = createIstDate(2026, 11, 23, 10, 0, 0);
    const t9ReopenTime = createIstDate(2026, 11, 24, 15, 0, 0);
    const t9Deadlines = computeDeadlines(t9ReopenTime, 'Medium', holidayDates);
    const t9RespDue = t9Deadlines.responseDueAt;
    const t9ResDue = t9Deadlines.resolutionDueAt;

    const t9Res = await client.query(
      `INSERT INTO tickets (
         ticket_number, customer_id, subject, description, priority, status, assignee_id,
         clock_start, response_due_at, resolution_due_at, cycle,
         public_token, created_at, updated_at
       ) VALUES (
         1010, $1, 'Mobile app crash when uploading invoice attachment (Reopened)',
         'App crashes with EXC_BAD_ACCESS when PDF file exceeds 5MB.',
         'Medium', 'OPEN', $2, $3, $4, $5, 2,
         'tok_live_seed_reopened_cycle2_1010_jklmno012345678901', $6, $3
       ) RETURNING id;`,
      [customers[4].id, agent7, t9ReopenTime, t9RespDue, t9ResDue, t9Cycle1Start]
    );
    const t9Id = t9Res.rows[0].id;

    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
       VALUES
         ($1, 'ticket_created', 'customer', 'Kerala Retail Hub', $2, '{"cycle":1,"priority":"Medium"}'),
         ($1, 'claimed', 'agent', 'Agent Seven', $3, '{"assigneeId":"' || $4 || '"}'),
         ($1, 'status_changed', 'agent', 'Agent Seven', $5, '{"oldStatus":"OPEN","newStatus":"RESOLVED"}'),
         ($1, 'reopened', 'customer', 'Kerala Retail Hub', $6, '{"cycle":2,"reopenedAt":"' || $6 || '","reason":"Crash still reproducing on iOS 17.5"}');`,
      [
        t9Id,
        t9Cycle1Start,
        createIstDate(2026, 11, 23, 10, 30, 0),
        agent7,
        createIstDate(2026, 11, 23, 17, 0, 0),
        t9ReopenTime,
      ]
    );
    await client.query(
      `INSERT INTO messages (ticket_id, sender_type, sender_name, body, created_at)
       VALUES
         ($1, 'customer', 'Kerala Retail Hub', 'Mobile app crashes whenever we attach an invoice PDF.', $2),
         ($1, 'agent', 'Agent Seven', 'We deployed a hotfix in v2.4.1. Marking as resolved.', $3),
         ($1, 'customer', 'Kerala Retail Hub', 'The issue still happens on iOS 17.5 with large files. Reopening ticket with crash log.', $4);`,
      [t9Id, t9Cycle1Start, createIstDate(2026, 11, 23, 17, 0, 0), t9ReopenTime]
    );

    console.log('Seeded 10 sample tickets successfully!');
    printCredentials();
  } finally {
    client.release();
  }
}

function printCredentials() {
  console.log('\n======================================================');
  console.log('   FRONTDESK - DEMO CREDENTIALS (PASSWORD: Password123!)');
  console.log('======================================================');
  console.log('👑 Lead Supervisor : lead@arvosystems.com');
  console.log('👤 Support Agent 1 : agent1@arvosystems.com');
  console.log('👤 Support Agent 2 : agent2@arvosystems.com');
  console.log('👤 Support Agent 3 : agent3@arvosystems.com');
  console.log('👤 Support Agent 4 : agent4@arvosystems.com');
  console.log('👤 Support Agent 5 : agent5@arvosystems.com');
  console.log('👤 Support Agent 6 : agent6@arvosystems.com');
  console.log('👤 Support Agent 7 : agent7@arvosystems.com');
  console.log('👤 Support Agent 8 : agent8@arvosystems.com');
  console.log('👤 Support Agent 9 : agent9@arvosystems.com');
  console.log('======================================================\n');
}

if (process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'))) {
  (async () => {
    try {
      await runSeeds();
      process.exit(0);
    } catch (err) {
      console.error('Seed execution failed:', err);
      process.exit(1);
    }
  })();
}
