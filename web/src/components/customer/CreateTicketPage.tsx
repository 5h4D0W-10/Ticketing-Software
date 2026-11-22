import React, { useState } from 'react';
import { UrgencyOption, CustomerTicket } from '../../types';
import { customerApi } from '../../api/customerApi';

interface CreateTicketPageProps {
  initialParentTicketId?: string;
  initialSubject?: string;
  onTicketCreated: (token: string) => void;
}

export function CreateTicketPage({
  initialParentTicketId,
  initialSubject,
  onTicketCreated,
}: CreateTicketPageProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState(initialSubject || '');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<UrgencyOption>('broken');
  const [parentTicketId] = useState<string | undefined>(initialParentTicketId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<(CustomerTicket & { publicToken: string }) | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await customerApi.createTicket({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        description: description.trim(),
        urgency,
        parentTicketId,
      });

      const token = res.ticket?.publicToken || (res.ticket as any)?.token || (res as any)?.publicToken || (res as any)?.token || '';
      const ticketNumber = res.ticket?.ticketNumber || (res.ticket as any)?.ticket_number;
      setCreatedTicket({
        ...res.ticket,
        publicToken: token,
        ticketNumber,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to submit ticket');
    } finally {
      setLoading(false);
    }
  };

  const getTicketUrl = (token: string) => {
    return `${window.location.origin}/#/ticket/${token}`;
  };

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(getTicketUrl(token));
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  if (createdTicket) {
    const token = createdTicket.publicToken || (createdTicket as any).token || '';
    const ticketUrl = getTicketUrl(token);

    return (
      <div className="customer-page-container">
        <div className="card success-card">
          <div className="success-icon">✓</div>
          <h2 className="success-title">Support Request Received!</h2>
          <p className="success-subtitle">
            Ticket <strong>#{createdTicket.ticketNumber || (createdTicket as any).ticket_number || ''}</strong> has been logged in Arvo Systems Frontdesk.
          </p>

          <div className="ticket-token-box">
            <span className="token-label">Your Private Ticket Access Link:</span>
            <div className="token-link-row">
              <input
                type="text"
                readOnly
                className="form-input token-input"
                value={ticketUrl}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => handleCopy(token)}
              >
                {copied ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>
            <p className="token-help-text">
              🔒 <strong>Save or bookmark this secret link.</strong> No login required. You can check ticket progress, view agent replies, and reply back anytime.
            </p>
          </div>

          <div className="success-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onTicketCreated(token)}
            >
              Go to Your Ticket Conversation →
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setCreatedTicket(null);
                setSubject('');
                setDescription('');
              }}
            >
              Submit Another Request
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="customer-page-container">
      <div className="card customer-form-card">
        <div className="customer-header">
          <h1 className="customer-title">Arvo Systems Support</h1>
          <p className="customer-subtitle">
            Submit a support request to our engineering & customer service team.
          </p>
        </div>

        {parentTicketId && (
          <div className="alert alert-info">
            ℹ️ You are creating a <strong>follow-up ticket</strong> linked to your previous inquiry.
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="form">
          <div className="form-row">
            <div className="form-group flex-1">
              <label htmlFor="customer-name">Your Full Name</label>
              <input
                id="customer-name"
                type="text"
                className="form-input"
                placeholder="e.g. John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="form-group flex-1">
              <label htmlFor="customer-email">Email Address</label>
              <input
                id="customer-email"
                type="email"
                className="form-input"
                placeholder="e.g. john@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="ticket-subject">Subject</label>
            <input
              id="ticket-subject"
              type="text"
              className="form-input"
              placeholder="Brief summary of the issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>

          {/* Three Urgency Options (SPEC R10) */}
          <div className="form-group">
            <label className="urgency-group-label">How urgent is this issue?</label>
            <div className="urgency-options-grid">
              <label className={`urgency-card ${urgency === 'cannot_work' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="urgency"
                  value="cannot_work"
                  checked={urgency === 'cannot_work'}
                  onChange={() => setUrgency('cannot_work')}
                />
                <div className="urgency-text">
                  <div className="urgency-headline">🔴 I cannot work at all</div>
                  <div className="urgency-desc">Critical outage stopping all business operations. Target reply: 2 working hours.</div>
                </div>
              </label>

              <label className={`urgency-card ${urgency === 'broken' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="urgency"
                  value="broken"
                  checked={urgency === 'broken'}
                  onChange={() => setUrgency('broken')}
                />
                <div className="urgency-text">
                  <div className="urgency-headline">🟡 Something is broken</div>
                  <div className="urgency-desc">Core feature malfunctioning or degraded. Target reply: 4.5 working hours.</div>
                </div>
              </label>

              <label className={`urgency-card ${urgency === 'question' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="urgency"
                  value="question"
                  checked={urgency === 'question'}
                  onChange={() => setUrgency('question')}
                />
                <div className="urgency-text">
                  <div className="urgency-headline">🔵 Question or small request</div>
                  <div className="urgency-desc">General inquiry, account request, or small change. Target reply: 1 working day.</div>
                </div>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="ticket-desc">Detailed Description</label>
            <textarea
              id="ticket-desc"
              className="form-textarea"
              rows={5}
              placeholder="Please provide steps to reproduce, error messages, or questions..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
          >
            {loading ? 'Submitting Ticket...' : 'Submit Support Request'}
          </button>
        </form>
      </div>
    </div>
  );
}

