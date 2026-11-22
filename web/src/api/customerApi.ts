import { CustomerTicket, CustomerMessage, UrgencyOption } from '../types';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `Request failed with status ${response.status}`);
    (error as any).status = response.status;
    (error as any).data = data;
    throw error;
  }

  return data as T;
}

export const customerApi = {
  async createTicket(params: {
    name: string;
    email: string;
    subject: string;
    description: string;
    urgency: UrgencyOption;
    parentTicketId?: string;
  }): Promise<{ ticket: CustomerTicket & { publicToken: string } }> {
    return request<{ ticket: CustomerTicket & { publicToken: string } }>('/api/customer/tickets', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async getTicket(token: string): Promise<{ ticket: CustomerTicket; messages: CustomerMessage[] }> {
    return request<{ ticket: CustomerTicket; messages: CustomerMessage[] }>(`/api/customer/tickets/${token}`);
  },

  async replyToTicket(token: string, body: string): Promise<{ success: boolean; messageId: string; ticket: CustomerTicket }> {
    return request<{ success: boolean; messageId: string; ticket: CustomerTicket }>(`/api/customer/tickets/${token}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },

  async reopenTicket(token: string): Promise<{ success: boolean; ticket: CustomerTicket }> {
    return request<{ success: boolean; ticket: CustomerTicket }>(`/api/customer/tickets/${token}/reopen`, {
      method: 'POST',
    });
  },

  async exportTicket(token: string, format: 'json' | 'csv' = 'json'): Promise<Blob> {
    const response = await fetch(`/api/customer/tickets/${token}/export?format=${format}`);
    if (!response.ok) {
      throw new Error('Failed to export ticket conversation');
    }
    return response.blob();
  },
};

