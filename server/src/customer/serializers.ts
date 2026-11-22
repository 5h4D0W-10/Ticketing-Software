import { TicketRow } from '../domain/types.js';

export interface CustomerPublicMessage {
  id: string;
  senderType: 'customer' | 'agent';
  senderName: string;
  body: string;
  createdAt: string;
}

export interface CustomerPublicTicket {
  id: string;
  ticketNumber: number;
  token: string;
  publicToken: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  canReopen: boolean;
}

export interface CustomerTicketDetailResponse {
  ticket: CustomerPublicTicket;
  messages: CustomerPublicMessage[];
}

/**
 * Explicit whitelist serializer for Customer Ticket summary
 */
export function serializeCustomerTicket(
  ticket: TicketRow,
  canReopen = false
): CustomerPublicTicket {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticket_number,
    token: ticket.public_token,
    publicToken: ticket.public_token,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: new Date(ticket.created_at).toISOString(),
    updatedAt: new Date(ticket.updated_at).toISOString(),
    canReopen,
  };
}

/**
 * Explicit whitelist serializer for Customer Message
 */
export function serializeCustomerMessage(msg: {
  id: string;
  sender_type: string;
  sender_name: string;
  body: string;
  created_at: Date;
}): CustomerPublicMessage {
  return {
    id: msg.id,
    senderType: msg.sender_type === 'agent' ? 'agent' : 'customer',
    senderName: msg.sender_type === 'agent' ? 'Arvo Support' : msg.sender_name,
    body: msg.body,
    createdAt: new Date(msg.created_at).toISOString(),
  };
}

/**
 * Explicit whitelist serializer for CSV export for customers
 */
export function serializeCustomerExportCsv(
  ticket: CustomerPublicTicket,
  messages: CustomerPublicMessage[]
): string {
  const headers = ['message_id', 'sender_type', 'sender_name', 'body', 'timestamp'];
  const rows = messages.map((m) => [
    m.id,
    m.senderType,
    `"${m.senderName.replace(/"/g, '""')}"`,
    `"${m.body.replace(/"/g, '""')}"`,
    m.createdAt,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

