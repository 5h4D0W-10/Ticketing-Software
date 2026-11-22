import React, { useState, useEffect } from 'react';
import { CustomerTicket, CustomerMessage } from '../../types';
import { customerApi } from '../../api/customerApi';

interface CustomerTicketPageProps {
  token: string;
  onOpenFollowUp: (parentTicketId: string, subject: string) => void;
  onBackToNew: () => void;
}

export function CustomerTicketPage({
  token,
  onOpenFollowUp,
  onBackToNew,
}: CustomerTicketPageProps) {
  const [ticket, setTicket] = useState<CustomerTicket | null>(null);
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadTicket = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await customerApi.getTicket(token);
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch (err: any) {
      setError(err.message || 'Ticket not found or secret link is invalid.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicket();
  }, [token]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;

    setReplying(true);
    setError(null);
    setActionNotice(null);

    try {
      await customerApi.replyToTicket(token, replyBody.trim());
      setReplyBody('');
      setActionNotice('Your reply has been delivered to the support team!');
      await loadTicket();
    } catch (err: any) {
      if (err.data?.isClosed || err.data?.canFollowUp) {
        setError('This ticket is closed and cannot receive replies.');
      } else {
        setError(err.message || 'Failed to send reply');
      }
    } finally {
      setReplying(false);
    }
  };

  const handleReopen = async () => {
    if (!window.confirm('Would you like to reopen this ticket?')) return;

    setReopening(true);
    setError(null);
    setActionNotice(null);

    try {
      await customerApi.reopenTicket(token);
      setActionNotice('Ticket successfully reopened! Our support team has been notified.');
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Could not reopen ticket');
      await loadTicket();
    } finally {
      setReopening(false);
    }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const blob = await customerApi.exportTicket(token, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ticket-${ticket?.ticketNumber || 'export'}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setError(err.message || 'Failed to download export');
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' IST';
  };

  if (loading) {
    return (
      <div className="customer-page-container">
        <div className="card loading-card">
          <p>Loading your ticket conversation...</p>
        </div>
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div className="customer-page-container">
        <div className="card error-card">
          <h2>Ticket Not Found</h2>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={onBackToNew}>
            ← Submit a New Request
          </button>
        </div>
      </div>
    );
  }

  if (!ticket) return null;

  return (
    <div className="customer-page-container">
      <div className="customer-ticket-header">
        <button type="button" className="btn btn-outline btn-sm" onClick={onBackToNew}>
          ← New Request
        </button>

        <div className="export-buttons-group">
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() => handleExport('json')}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() => handleExport('csv')}
          >
            Export CSV
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="alert alert-success" role="alert">
          {actionNotice}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Ticket Overview Card */}
      <div className="card customer-ticket-card">
        <div className="ticket-title-row">
          <span className="ticket-id-tag">#{ticket.ticketNumber || (ticket as any).ticket_number || ''}</span>
          <h1 className="ticket-subject">{ticket.subject}</h1>
        </div>

        {ticket.description && (
          <p className="ticket-description" style={{ marginTop: '0.75rem', color: '#4b5563', fontSize: '0.95rem', lineHeight: '1.5' }}>
            {ticket.description}
          </p>
        )}

        <div className="customer-ticket-meta">
          <span className={`status-pill status-${ticket.status.toLowerCase()}`}>
            Status: {ticket.status}
          </span>
          <span className="customer-meta-date">
            Created: {formatDate(ticket.createdAt)}
          </span>
        </div>

        {/* Resolved Banner & Reopen Option (R4) */}
        {ticket.status === 'RESOLVED' && (
          <div className="resolved-notice-box">
            {ticket.canReopen ? (
              <div className="reopen-allowed-content">
                <p>
                  ✅ <strong>Issue Resolved:</strong> If you feel this issue is not fully resolved, you can reopen this ticket within 5 working days of resolution.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={reopening}
                  onClick={handleReopen}
                >
                  {reopening ? 'Reopening...' : '🔄 Reopen This Ticket'}
                </button>
              </div>
            ) : (
              <div className="reopen-expired-content">
                <p>
                  ℹ️ <strong>Reopen Window Expired:</strong> The 5 working days reopen window for this ticket has closed.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onOpenFollowUp(ticket.id, `Follow-up on #${ticket.ticketNumber}: ${ticket.subject}`)}
                >
                  + Open a New Follow-Up Ticket
                </button>
              </div>
            )}
          </div>
        )}

        {/* Closed Banner (R3) */}
        {ticket.status === 'CLOSED' && (
          <div className="closed-notice-box">
            <p>
              🔒 <strong>This ticket is closed.</strong> Auto-closed after 5 working days of customer inactivity or resolution window completion.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onOpenFollowUp(ticket.id, `Follow-up on #${ticket.ticketNumber}: ${ticket.subject}`)}
            >
              + Open a New Follow-Up Ticket
            </button>
          </div>
        )}
      </div>

      {/* Public Conversation Thread (INC-0304 Strictly Public Messages Only) */}
      <div className="card customer-messages-card">
        <h2 className="section-title">Conversation</h2>

        <div className="messages-thread">
          {messages.length === 0 ? (
            <p className="text-muted">No messages in conversation yet.</p>
          ) : (
            messages.map((m) => {
              const isAgent = m.senderType === 'agent';
              return (
                <div
                  key={m.id}
                  className={`message-bubble ${isAgent ? 'agent-bubble' : 'customer-bubble'}`}
                >
                  <div className="message-header-line">
                    <span className="sender-indicator">
                      {isAgent ? '🛡️ Arvo Support Team' : '👤 You'}
                    </span>
                    <span className="timestamp-indicator">{formatDate(m.createdAt)}</span>
                  </div>
                  <div className="message-text">{m.body}</div>
                </div>
              );
            })
          )}
        </div>

        {/* Customer Reply Box (Active Tickets Only) */}
        {ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && (
          <div className="customer-reply-section">
            <form onSubmit={handleReply}>
              <label htmlFor="customer-reply-input" className="reply-label">
                Write a reply to the support team:
              </label>
              <textarea
                id="customer-reply-input"
                className="form-textarea"
                rows={3}
                placeholder="Type your reply or additional information here..."
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                required
              />

              <div className="reply-actions-row">
                <span className="reply-help-note">
                  {ticket.status === 'WAITING_CUSTOMER' && (
                    <span className="text-amber font-semibold">
                      ⏳ Sending a reply will automatically resume the SLA clock.
                    </span>
                  )}
                </span>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={replying}
                >
                  {replying ? 'Sending...' : 'Send Reply'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

