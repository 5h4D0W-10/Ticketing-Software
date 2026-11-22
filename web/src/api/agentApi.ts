import { TicketListItem, TicketDetail, TimelineItem, LateReportItem, Holiday, User } from '../types';

const TOKEN_KEY = 'frontdesk_agent_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearStoredToken();
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `Request failed with status ${response.status}`);
    (error as any).status = response.status;
    (error as any).data = data;
    throw error;
  }

  return data as T;
}

export const agentApi = {
  // Auth
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const res = await request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.token);
    return res;
  },

  async getMe(): Promise<{ user: User }> {
    return request<{ user: User }>('/api/auth/me');
  },

  logout(): void {
    clearStoredToken();
  },

  // Tickets
  async getTickets(filter: 'all' | 'mine' | 'unassigned' | 'late' | 'waiting_customer' = 'all'): Promise<TicketListItem[]> {
    const res = await request<{ tickets: TicketListItem[] }>(`/api/agent/tickets?filter=${filter}`);
    return res.tickets;
  },

  async getTicketDetail(id: string): Promise<{ ticket: TicketDetail; timeline: TimelineItem[] }> {
    return request<{ ticket: TicketDetail; timeline: TimelineItem[] }>(`/api/agent/tickets/${id}`);
  },

  async claimTicket(id: string): Promise<{ ticket: TicketListItem }> {
    return request<{ ticket: TicketListItem }>(`/api/agent/tickets/${id}/claim`, {
      method: 'POST',
    });
  },

  async releaseTicket(id: string): Promise<{ ticket: TicketListItem }> {
    return request<{ ticket: TicketListItem }>(`/api/agent/tickets/${id}/release`, {
      method: 'POST',
    });
  },

  async replyToCustomer(id: string, body: string, waitForCustomer: boolean = false): Promise<{ messageId: string; ticket: TicketListItem }> {
    return request<{ messageId: string; ticket: TicketListItem }>(`/api/agent/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body, waitForCustomer }),
    });
  },

  async addInternalNote(id: string, body: string): Promise<{ noteId: string }> {
    return request<{ noteId: string }>(`/api/agent/tickets/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },

  async resolveTicket(id: string): Promise<{ ticket: TicketListItem }> {
    return request<{ ticket: TicketListItem }>(`/api/agent/tickets/${id}/resolve`, {
      method: 'POST',
    });
  },

  async changePriority(id: string, priority: 'Urgent' | 'Medium' | 'Small'): Promise<{ ticket: TicketListItem }> {
    return request<{ ticket: TicketListItem }>(`/api/agent/tickets/${id}/priority`, {
      method: 'POST',
      body: JSON.stringify({ priority }),
    });
  },

  // Lead reports & holidays
  async getLateTicketsReport(): Promise<LateReportItem[]> {
    const res = await request<{ report: LateReportItem[] }>('/api/agent/reports/late');
    return res.report;
  },

  async getHolidays(): Promise<Holiday[]> {
    const res = await request<{ holidays: Holiday[] }>('/api/agent/holidays');
    return res.holidays;
  },

  async addHoliday(holidayDate: string, description: string): Promise<Holiday> {
    const res = await request<{ holiday: Holiday }>('/api/agent/holidays', {
      method: 'POST',
      body: JSON.stringify({ holidayDate, description }),
    });
    return res.holiday;
  },

  async deleteHoliday(id: string): Promise<void> {
    await request(`/api/agent/holidays/${id}`, {
      method: 'DELETE',
    });
  },

  async exportCsv(): Promise<Blob> {
    const token = getStoredToken();
    const response = await fetch('/api/agent/tickets/export/csv', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error('Failed to export CSV');
    }
    return response.blob();
  },
};

