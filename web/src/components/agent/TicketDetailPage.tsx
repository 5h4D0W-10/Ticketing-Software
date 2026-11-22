import React, { useState, useEffect } from 'react';
import { TicketDetail, TimelineItem, TicketPriority } from '../../types';
import { agentApi } from '../../api/agentApi';
import { useAuth } from '../../context/AuthContext';

interface TicketDetailPageProps {
  ticketId: string;
  onBack: () => void;
}

export function TicketDetailPage({ ticketId, onBack }: TicketDetailPageProps) {
  const { user } = useAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Compose box states
  const [replyBody, setReplyBody] = useState('');
  const [waitForCustomer, setWaitForCustomer] = useState(false);
  const [replying, setReplying] = useState(false);

  const [noteBody, setNoteBody] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Priority change state
  const [showPriorityModal, setShowPriorityModal] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState<TicketPriority>('Medium');
  const [changingPriority, setChangingPriority] = useState(false);

  const loadTicket = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.getTicketDetail(ticketId);
      setTicket(data.ticket);
      setTimeline(data.timeline);
      setSelectedPriority(data.ticket.priority);
    } catch (err: any) {
      setError(err.message || 'Failed to load ticket details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicket();
  }, [ticketId]);

  const isAssigneeOrLead = user && ticket && (ticket.assigneeId === user.id || user.role === 'lead');

  // Handle Public Reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;

    setReplying(true);
    setError(null);
    setActionSuccess(null);

    try {
      await agentApi.replyToCustomer(ticketId, replyBody.trim(), waitForCustomer);
      setReplyBody('');
      setWaitForCustomer(false);
      setActionSuccess(waitForCustomer ? 'Reply sent! Ticket status moved to WAITING_CUSTOMER (SLA paused).' : 'Reply sent to customer!');
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  // Handle Internal Note
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteBody.trim()) return;

    setAddingNote(true);
    setError(null);
    setActionSuccess(null);

    try {
      await agentApi.addInternalNote(ticketId, noteBody.trim());
      setNoteBody('');
      setActionSuccess('Private internal note saved to audit timeline. (Never sent to customer).');
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Failed to add internal note');
    } finally {
      setAddingNote(false);
    }
  };

  // Handle Claim
  const handleClaim = async () => {
    try {
      await agentApi.claimTicket(ticketId);
      setActionSuccess('You have successfully claimed this ticket!');
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Failed to claim ticket');
    }
  };

  // Handle Release
  const handleRelease = async () => {
    if (!window.confirm('Are you sure you want to release this ticket back to the unassigned queue?')) {
      return;
    }
    try {
      await agentApi.releaseTicket(ticketId);
      setActionSuccess('Ticket released back to unassigned queue.');
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Failed to release ticket');
    }
  };

  // Handle Resolve
  const handleResolve = async () => {
    if (!window.confirm('Mark this ticket as RESOLVED? Customer will have 5 working days to reopen.')) {
      return;
    }
    try {
      await agentApi.resolveTicket(ticketId);
      setActionSuccess('Ticket marked as RESOLVED! Reopen window started.');
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve ticket');
    }
  };

  // Handle Priority Change
  const handleChangePriority = async () => {
    setChangingPriority(true);
    try {
      await agentApi.changePriority(ticketId, selectedPriority);
      setShowPriorityModal(false);
      setActionSuccess(`Priority updated to ${selectedPriority}. Deadlines recomputed from clock start.`);
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Failed to change priority');
    } finally {
      setChangingPriority(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
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
      <div className="card loading-card">
        <p>Loading ticket #{ticketId}...</p>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="card error-card">
        <p>Ticket not found or error loading.</p>
        <button type="button" className="btn btn-primary" onClick={onBack}>
          ← Back to tickets
        </button>
      </div>
    );
  }

  return (
    <div className="ticket-detail-page">
      <div className="detail-navigation">
        <button type="button" className="btn btn-outline btn-sm" onClick={onBack}>
          ← Back to Tickets
        </button>
      </div>

      {actionSuccess && (
        <div className="alert alert-success" role="alert">
          {actionSuccess}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Ticket Header & SLA Summary */}
      <div className="card ticket-header-card">
        <div className="header-top-row">
          <div>
            <div className="ticket-title-row">
              <span className="ticket-id-tag">#{ticket.ticketNumber}</span>
              <h1 className="ticket-subject">{ticket.subject}</h1>
            </div>
            <p className="ticket-customer-meta">
              Customer: <strong>{ticket.customerName}</strong> ({ticket.customerEmail})
            </p>
          </div>

          <div className="header-badges">
            <span className={`priority-pill priority-${ticket.priority.toLowerCase()}`}>
              {ticket.priority} Priority
            </span>
            <span className={`status-pill status-${ticket.status.toLowerCase()}`}>
              {ticket.status}
            </span>
            {ticket.isLate && (
              <span className="badge badge-late">
                🔴 LATE
              </span>
            )}
            {ticket.isWaitingCustomer && (
              <span className="badge badge-waiting">
                ⏳ WAITING ON CUSTOMER
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="ticket-actions-bar">
          <div className="assignee-display">
            Assignee: <strong>{ticket.assigneeName || 'Unassigned'}</strong>
          </div>

          <div className="actions-cluster">
            {ticket.assigneeId === null ? (
              <button
                type="button"
                className="btn btn-take btn-sm"
                onClick={handleClaim}
              >
                ✋ Take this ticket
              </button>
            ) : (
              isAssigneeOrLead && (
                <>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={handleRelease}
                  >
                    Release Ticket
                  </button>

                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setShowPriorityModal(!showPriorityModal)}
                  >
                    Change Priority
                  </button>

                  {ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && (
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      onClick={handleResolve}
                    >
                      ✓ Mark Resolved
                    </button>
                  )}
                </>
              )
            )}
          </div>
        </div>

        {/* Priority Change Box */}
        {showPriorityModal && (
          <div className="priority-modal-panel">
            <span className="priority-modal-title">Change Ticket Priority (R5 Recompute Rule):</span>
            <div className="priority-select-row">
              <select
                className="form-select"
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(e.target.value as TicketPriority)}
              >
                <option value="Urgent">Urgent (2h reply, same day resolution)</option>
                <option value="Medium">Medium (4.5h reply, 3 working days resolution)</option>
                <option value="Small">Small (1 working day reply, 1 working week resolution)</option>
              </select>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={changingPriority || selectedPriority === ticket.priority}
                onClick={handleChangePriority}
              >
                {changingPriority ? 'Updating...' : 'Confirm Priority Change'}
              </button>

              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowPriorityModal(false)}
              >
                Cancel
              </button>
            </div>
            <p className="priority-note">
              Note: Deadlines are recomputed from original clock start while preserving all accumulated paused time. Sticky breaches stay recorded.
            </p>
          </div>
        )}

        {/* SLA Info Card */}
        <div className="sla-info-box">
          <div className="sla-grid">
            <div className="sla-item">
              <span className="sla-label">Clock Start</span>
              <span className="sla-val">{formatDate(ticket.clockStart)}</span>
            </div>
            <div className="sla-item">
              <span className="sla-label">First Response Deadline</span>
              <span className="sla-val">{formatDate(ticket.responseDueAt)}</span>
            </div>
            <div className="sla-item">
              <span className="sla-label">Resolution Deadline</span>
              <span className="sla-val">{formatDate(ticket.resolutionDueAt)}</span>
            </div>
            <div className="sla-item">
              <span className="sla-label">Working Time Status</span>
              <span className="sla-val font-semibold">
                {ticket.isWaitingCustomer ? (
                  <span className="text-amber">Paused (Waiting on Customer)</span>
                ) : ticket.isLate ? (
                  <span className="text-red">
                    {ticket.overdueWorkingMinutes > 0
                      ? `${ticket.overdueWorkingMinutes} working min overdue`
                      : 'SLA Breached'}
                  </span>
                ) : (
                  <span className="text-green">
                    {ticket.timeRemainingWorkingMinutes > 0
                      ? `${ticket.timeRemainingWorkingMinutes} working min remaining`
                      : 'On track'}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Wall-Clock & Elapsed Working Minutes for First Response (R9) */}
          {ticket.firstResponseSummary && (
            <div className="sla-first-reply-summary">
              ⏱️ <strong>First Response Record (R9):</strong> {ticket.firstResponseSummary}
            </div>
          )}
        </div>
      </div>

      {/* Main Two-Column Layout: Conversation & Timeline on left, Compose Boxes on right */}
      <div className="detail-content-layout">
        <div className="detail-timeline-column">
          <h2 className="section-title">Timeline & Conversation Thread</h2>

          <div className="timeline-container">
            {timeline.length === 0 ? (
              <p className="text-muted">No events recorded yet.</p>
            ) : (
              timeline.map((item, index) => {
                const ts = formatDate(item.timestamp);

                if (item.type === 'message') {
                  const m = item.data;
                  const isAgent = m.sender_type === 'agent';
                  return (
                    <div
                      key={`msg-${index}`}
                      className={`timeline-card message-card ${isAgent ? 'agent-message' : 'customer-message'}`}
                    >
                      <div className="card-header-line">
                        <span className="sender-tag">
                          {isAgent ? '👤 Arvo Agent' : '💬 Customer'} ({m.sender_name})
                        </span>
                        <span className="timestamp-tag">{ts}</span>
                      </div>
                      <div className="message-body">{m.body}</div>
                    </div>
                  );
                }

                if (item.type === 'internal_note') {
                  const n = item.data;
                  return (
                    <div
                      key={`note-${index}`}
                      className="timeline-card note-card-confidential"
                    >
                      <div className="card-header-line">
                        <span className="note-lock-tag">
                          🔒 Internal Team Note (INC-0304 Private Note Guarantee)
                        </span>
                        <span className="timestamp-tag">{ts}</span>
                      </div>
                      <div className="note-author">By: {n.author_name}</div>
                      <div className="note-body">{n.body}</div>
                    </div>
                  );
                }

                // System / Domain Audit Event
                const e = item.data;
                return (
                  <div key={`evt-${index}`} className="timeline-event-row">
                    <span className="event-bullet">•</span>
                    <div className="event-details">
                      <span className="event-type-badge">{e.event_type}</span>
                      <span className="event-actor">by {e.actor_name} ({e.actor_type})</span>
                      <span className="event-time">{ts}</span>
                      {e.payload && Object.keys(e.payload).length > 0 && (
                        <div className="event-payload">
                          <code>{JSON.stringify(e.payload)}</code>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Compose Boxes Column (Exactly two compose boxes as specified) */}
        <div className="detail-compose-column">
          <h2 className="section-title">Ticket Actions</h2>

          {/* COMPOSE BOX 1: Reply to Customer */}
          <div className="card compose-card customer-reply-box">
            <h3 className="compose-box-title">💬 Reply to Customer</h3>
            <p className="compose-box-desc">
              Public message visible to the customer on their portal page.
            </p>

            <form onSubmit={handleSendReply}>
              <textarea
                className="form-textarea"
                rows={4}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Write your public message to the customer here..."
                required
              />

              <div className="form-checkbox-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={waitForCustomer}
                    onChange={(e) => setWaitForCustomer(e.target.checked)}
                  />
                  <span>
                    <strong>Send & wait for customer</strong> (Pauses SLA clock until customer replies, R2)
                  </span>
                </label>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={replying || !isAssigneeOrLead}
              >
                {replying ? 'Sending...' : 'Send Reply to Customer'}
              </button>

              {!isAssigneeOrLead && (
                <p className="permission-notice">
                  * Only the assigned agent or lead supervisor may reply.
                </p>
              )}
            </form>
          </div>

          {/* COMPOSE BOX 2: Internal Note (Team Only) - Visually Distinct Yellow with Lock Icon */}
          <div className="card compose-card internal-note-box">
            <div className="internal-note-header">
              <span className="lock-icon">🔒</span>
              <div>
                <h3 className="internal-note-title">Internal Note (Team Only)</h3>
                <span className="internal-note-badge">STRICTLY CONFIDENTIAL · R8 GUARANTEE</span>
              </div>
            </div>

            <p className="internal-note-desc">
              Visible ONLY to Arvo Support agents. Guaranteed never to appear in customer screens, APIs, or exports.
            </p>

            <form onSubmit={handleAddNote}>
              <textarea
                className="form-textarea internal-textarea"
                rows={4}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add private technical notes, team context, or investigation findings..."
                required
              />

              <button
                type="submit"
                className="btn btn-amber btn-block"
                disabled={addingNote || !isAssigneeOrLead}
              >
                {addingNote ? 'Saving Note...' : '🔒 Add Internal Team Note'}
              </button>

              {!isAssigneeOrLead && (
                <p className="permission-notice">
                  * Only the assigned agent or lead supervisor may add internal notes.
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

