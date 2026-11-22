export type TicketPriority = 'Urgent' | 'Medium' | 'Small';

export type TicketStatus = 'NEW' | 'OPEN' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';

export type UrgencyOption = 'cannot_work' | 'broken' | 'question';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'agent' | 'lead';
}

export interface TicketListItem {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  customerName: string;
  customerEmail: string;
  clockStart: string;
  responseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  isLate: boolean;
  lateMilestone?: 'first_response' | 'resolution';
  overdueWorkingMinutes: number;
  timeRemainingWorkingMinutes: number;
  isWaitingCustomer: boolean;
  badges: {
    isLate: boolean;
    isWaitingCustomer: boolean;
    isUrgent: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetail extends TicketListItem {
  firstResponseSummary?: string | null;
}

export interface TimelineItem {
  type: 'message' | 'internal_note' | 'event';
  timestamp: string;
  data: Record<string, any>;
}

export interface LateReportItem {
  id: string;
  ticketNumber: number;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeName: string | null;
  customerName: string;
  clockStart: string;
  responseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  reasons: string[];
  excludedCustomerWaitingMinutes: number;
  excludedCustomerWaitingFormatted: string;
}

export interface Holiday {
  id: string;
  holiday_date: string;
  description: string;
  created_at: string;
}

export interface CustomerTicket {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  canReopen: boolean;
  clockStart: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMessage {
  id: string;
  senderType: 'customer' | 'agent';
  senderName: string;
  body: string;
  createdAt: string;
}

