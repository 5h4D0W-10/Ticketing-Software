export type TicketPriority = 'Urgent' | 'Medium' | 'Small';

export type TicketStatus =
  | 'NEW'
  | 'OPEN'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED';

export type EventType =
  | 'ticket_created'
  | 'claimed'
  | 'released'
  | 'public_reply'
  | 'internal_note_added'
  | 'status_changed'
  | 'priority_changed'
  | 'sla_paused'
  | 'sla_resumed'
  | 'sla_breached'
  | 'auto_closed'
  | 'reopened'
  | 'reopen_rejected'
  | 'holiday_changed';

export type ActorType = 'agent' | 'customer' | 'system';

export interface Actor {
  type: ActorType;
  id?: string;
  name: string;
}

export interface TicketRow {
  id: string;
  ticket_number: number;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  customer_id: string;
  assignee_id: string | null;
  version: number;
  clock_start: Date;
  response_due_at: Date;
  resolution_due_at: Date;
  first_response_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  cycle: number;
  parent_ticket_id: string | null;
  public_token: string;
  first_response_breached: boolean;
  resolution_breached: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TicketEventRow {
  id: string;
  ticket_id: string;
  event_type: EventType;
  actor_type: ActorType;
  actor_id: string | null;
  actor_name: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
}

export interface SlaPauseRow {
  id: string;
  ticket_id: string;
  cycle: number;
  paused_at: Date;
  resumed_at: Date | null;
  working_minutes_paused: number;
  created_at: Date;
}

export class InvalidStateTransitionError extends Error {
  public readonly statusCode = 422;
  constructor(
    public readonly fromStatus: TicketStatus,
    public readonly toStatus: TicketStatus,
    message?: string
  ) {
    super(message || `Invalid state transition from ${fromStatus} to ${toStatus}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class ConcurrencyError extends Error {
  public readonly statusCode = 409;
  constructor(message = 'Resource version conflict or ticket already assigned') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}
