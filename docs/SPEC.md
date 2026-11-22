# Frontdesk Specification

## Context
Arvo Systems has 9 support agents handling ~40 tickets/day. They use a spreadsheet + WhatsApp group. Last quarter ~1 in 5 tickets were late and nobody could say which or why, because the spreadsheet shows only current state and keeps no history. Frontdesk replaces it: a backend service + a simple screen for agents.

## Delivery rules (from the test)
- ~8 hours; 8 honest hours preferred over extra polish.
- Backend Node or Python; PostgreSQL or MySQL; any frontend framework. We use Node+TS, PostgreSQL, React+Vite.
- Must be hosted online (free tier ok) and stay up one week. Must also run locally.
- Deliver: live URL, repo link, README (how to run locally), short note: "what did you not finish, and why?" (NOTES.md).
- No clarification will be given: decide, and document decisions.

## R1. SLA targets
| Priority | Meaning | First reply within | Resolve within |
| Urgent | Customer cannot work at all | 2 working hours | Same working day |
| Medium | | Half a working day | ~3 working days |
| Small | Questions / small requests | 1 working day | ~1 working week |
- Working time: 9:30 to 18:30 (9h/day), Monday to Friday, timezone Asia/Kolkata. No weekends. No festival holidays.
- So: half day = 4.5h, 1 day = 9h, 3 days = 27h, 1 week = 5 working days = 45h. (No lunch break assumed; document.)
- All SLA math uses WORKING time, never wall-clock. Example that MUST pass in a test: a ticket arriving Friday 6:00 PM is NOT late on Sunday morning.
- A ticket created outside working hours starts its clock at the next working-time start.
- "Same working day" for Urgent: due 18:30 on the day the clock starts.
- Holidays: `holidays` table seeded with a clearly-labelled, editable list of 2026 Indian/Kerala festival and public holidays (flag "verify these dates"); lead-only API/screen to add/remove. The engine reads from it.
- Two SLA clocks per ticket: first-response and resolution. Late = now > deadline of an unmet milestone, or milestone met after its deadline. Breaches are recorded as events and are STICKY (never erased).

## R2. Waiting on customer pauses the clock
- Agent asks the customer a question via "Send & wait for customer" -> status WAITING_CUSTOMER. SLA clocks are PAUSED; that time never counts against Arvo.
- Customer replies -> status OPEN, clocks resume; deadlines move forward by the WORKING minutes spent paused. Store pause intervals (paused_at, resumed_at).
- Must be correct across weekends/holidays (some customers take a week).

## R3. Auto-close
- Customer silent ~1 working week (5 working days = 45 working hours) while WAITING_CUSTOMER -> ticket auto-closed. Customer can contact Arvo again later; that creates a NEW ticket linked as "follow-up of".
- Implement as an idempotent sweep (cron every few min) AND lazily on list/read (free hosting sleeps) plus a protected trigger endpoint. Actor in history = "system".

## R4. Reopen
- After an agent marks RESOLVED, the customer can reopen only within ~1 week (use 5 working days; document). After that: reject with a clear message; customer opens a NEW linked ticket.
- On reopen, start a new SLA cycle (same priority) from reopen time; keep previous cycle in history.

## R5. Priority change mid-ticket (undefined in the story; our decision)
Recompute both deadlines from the ORIGINAL clock start using the new priority's targets, preserving elapsed working time and paused time. Breaches already recorded stay recorded (sticky). Record an event with old/new priority and old/new deadlines. Explain in README. Test upgrade and downgrade.

## R6. Agent screen (one screen)
- Login. Seed 9 agents + 1 lead. Roles: agent, lead.
- "My tickets" on ONE screen: id, subject, priority, status, assignee, time remaining or overdue (working time), clear badges for LATE and WAITING ON CUSTOMER. Filters: late, waiting on customer, unassigned queue, mine. Sort by most urgent deadline.
- Unassigned queue visible with a "Take this ticket" button.
- Ticket detail: full timeline; exactly two communication actions: (1) reply to customer (optional "send & wait for customer"), (2) internal note (team only). Plus resolve, change priority, release.
- Lead-only "Late tickets" report: which tickets were late and WHY (e.g. "not claimed for 3h10m", "first reply 45 working min after deadline", "resolution overdue by 1 working day") and how much time was excluded due to customer waiting.

## R7. No double-taking (incident INC-0291)
Two agents clicked "take this ticket" on the same ticket and both replied with different answers.
- Claim must be atomic in the DB (conditional UPDATE ... WHERE assignee_id IS NULL, or optimistic locking). Loser gets HTTP 409 saying who has it.
- Only the assignee (or a lead) may reply, add notes, resolve.
- Concurrency test: multiple simultaneous claims, exactly one succeeds.

## R8. Private notes never reach customers (incident INC-0304)
A private note was sent to a customer. "Not on a screen. Not in an API response. Not in an export. Not in a list."
- Internal notes in a SEPARATE table from customer-visible messages.
- Separate route trees and serializers with explicit field WHITELISTS: /api/agent/* (auth) and /api/customer/* (secret ticket token). No shared "return whole row" paths.
- Covers ticket detail, lists, search, CSV/JSON exports, errors, timelines, any emails/webhooks.
- Canary test: note containing "SECRET-CANARY-123"; hit every customer-reachable endpoint; the string never appears in any body.

## R9. Immutable audit history (incident INC-0318)
Customer said Arvo replied next morning; Arvo said 40 minutes; nobody could prove it. The system must record exactly what happened, when, and who did it; nobody can change it later.
- Append-only `ticket_events`: id, ticket_id, event_type, actor_type (agent/customer/system), actor_id, actor_name, occurred_at (SERVER UTC time only), payload JSON (old/new values, deadlines).
- Event types: ticket_created, claimed, released, public_reply, internal_note_added, status_changed, priority_changed, sla_paused, sla_resumed, sla_breached, auto_closed, reopened, reopen_rejected, holiday_changed.
- Immutability enforced IN THE DATABASE: triggers raising exceptions on UPDATE/DELETE/TRUNCATE for events, messages and notes; no edit/delete endpoints. Bonus: hash chain with a verify endpoint.
- Ticket detail shows wall-clock timestamp AND elapsed working time for first reply: "first replied at X by Y (N working minutes after creation)".
- Test: direct SQL UPDATE/DELETE on events fails.

## R10. Customer side (minimal)
- Public create-ticket form: name, email, subject, description, urgency chosen as "I cannot work at all" / "Something is broken" / "Question or small request" mapped to Urgent/Medium/Small; agent can change it.
- Customer gets a secret unguessable link (token) to view the public conversation, reply, and reopen if allowed. No customer login.

## R11. Status model (enforce server-side state machine)
NEW (unassigned) -> OPEN (assigned) <-> WAITING_CUSTOMER -> RESOLVED -> CLOSED (auto-close, or reopen window expiry); RESOLVED -> OPEN (reopen within window). Invalid transitions return 4xx and are tested.

## R12. Quality
Server-side validation; password hashing; sessions/JWT; authorization on every agent route; XSS-safe output; basic rate limit on public endpoints. Time stored UTC, computed in Asia/Kolkata. Injectable Clock so tests can simulate time.

## R13. Required tests
Working-time engine, pause/resume, auto-close, reopen window, priority change, atomic claim concurrency, private-note canary, immutability triggers, state machine.

## R14. Deliverables
Working app; README.md (local run steps, Windows-friendly, tests, demo logins, live URL, API overview, "Assumptions & Decisions"); NOTES.md (what is not finished and why, honest); requirement-to-code/test traceability table; deploy instructions.

