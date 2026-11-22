import React, { useState, useEffect } from 'react';
import { TicketListItem } from '../../types';
import { agentApi } from '../../api/agentApi';
import { useAuth } from '../../context/AuthContext';

interface TicketListPageProps {
  onSelectTicket: (ticketId: string) => void;
}

type FilterType = 'mine' | 'unassigned' | 'late' | 'waiting_customer' | 'all';

export function TicketListPage({ onSelectTicket }: TicketListPageProps) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterType>('mine');
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimConflict, setClaimConflict] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const fetchTickets = async (selectedFilter: FilterType) => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.getTickets(selectedFilter);
      setTickets(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets(filter);
  }, [filter]);

  const handleClaim = async (ticketId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setClaimConflict(null);
    setClaimingId(ticketId);

    try {
      await agentApi.claimTicket(ticketId);
      // Refresh list on success
      await fetchTickets(filter);
    } catch (err: any) {
      if (err.status === 409) {
        const assignee = err.data?.currentAssignee?.name || 'another agent';
        setClaimConflict(
          `⚠️ Conflict (INC-0291): Ticket was already claimed by ${assignee}! Your claim was rejected to prevent double-taking.`
        );
      } else {
        setError(err.message || 'Failed to claim ticket');
      }
      await fetchTickets(filter);
    } finally {
      setClaimingId(null);
    }
  };

  const handleExportCsv = async () => {
    try {
      const blob = await agentApi.exportCsv();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `frontdesk-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      setError(err.message || 'Failed to export CSV');
    }
  };

  const formatWorkingTime = (t: TicketListItem) => {
    if (t.status === 'RESOLVED' || t.status === 'CLOSED') {
      return <span className="text-muted">Completed</span>;
    }
    if (t.isWaitingCustomer) {
      return <span className="text-amber">SLA Clock Paused</span>;
    }
    if (t.isLate) {
      return (
        <span className="text-red font-semibold">
          {t.overdueWorkingMinutes > 0
            ? `${t.overdueWorkingMinutes}m overdue`
            : 'Overdue'}
        </span>
      );
    }
    if (t.timeRemainingWorkingMinutes > 0) {
      return (
        <span className="text-green font-semibold">
          {t.timeRemainingWorkingMinutes}m remaining
        </span>
      );
    }
    return <span className="text-muted">Due now</span>;
  };

  return (
    <div className="tickets-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Tickets</h1>
          <p className="page-subtitle">
            Logged in as <strong>{user?.name}</strong> ({user?.role}) · Asia/Kolkata Working Time SLA
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={handleExportCsv}
          >
            📥 Export CSV
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => fetchTickets(filter)}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {claimConflict && (
        <div className="alert alert-warning" role="alert">
          <div className="alert-content">
            {claimConflict}
          </div>
          <button
            type="button"
            className="alert-close"
            onClick={() => setClaimConflict(null)}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="tabs">
        <button
          type="button"
          className={`tab-btn ${filter === 'mine' ? 'active' : ''}`}
          onClick={() => setFilter('mine')}
        >
          👤 Mine
        </button>
        <button
          type="button"
          className={`tab-btn ${filter === 'unassigned' ? 'active' : ''}`}
          onClick={() => setFilter('unassigned')}
        >
          📥 Unassigned Queue
        </button>
        <button
          type="button"
          className={`tab-btn ${filter === 'late' ? 'active' : ''}`}
          onClick={() => setFilter('late')}
        >
          🔴 Late Tickets
        </button>
        <button
          type="button"
          className={`tab-btn ${filter === 'waiting_customer' ? 'active' : ''}`}
          onClick={() => setFilter('waiting_customer')}
        >
          ⏳ Waiting on Customer
        </button>
        <button
          type="button"
          className={`tab-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          📋 All Tickets
        </button>
      </div>

      {/* Main Tickets Table */}
      <div className="card table-card">
        {loading ? (
          <div className="loading-state">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No tickets in this view</p>
            <p className="empty-sub">Tickets matching this filter will appear here.</p>
          </div>
        ) : (
          <table className="tickets-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Subject & Customer</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Working Time SLA</th>
                <th>Badges</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.id}
                  className="table-row-clickable"
                  onClick={() => onSelectTicket(t.id)}
                >
                  <td className="ticket-number-cell">
                    <strong>#{t.ticketNumber}</strong>
                  </td>

                  <td className="ticket-subject-cell">
                    <div className="subject-title">{t.subject}</div>
                    <div className="customer-info">{t.customerName} ({t.customerEmail})</div>
                  </td>

                  <td>
                    <span className={`priority-pill priority-${t.priority.toLowerCase()}`}>
                      {t.priority}
                    </span>
                  </td>

                  <td>
                    <span className={`status-pill status-${t.status.toLowerCase()}`}>
                      {t.status}
                    </span>
                  </td>

                  <td>
                    {t.assigneeName ? (
                      <span className="assignee-name">{t.assigneeName}</span>
                    ) : (
                      <span className="unassigned-tag">Unassigned</span>
                    )}
                  </td>

                  <td>
                    {formatWorkingTime(t)}
                  </td>

                  <td className="badges-cell">
                    {t.isLate && (
                      <span className="badge badge-late">
                        🔴 LATE
                      </span>
                    )}
                    {t.isWaitingCustomer && (
                      <span className="badge badge-waiting">
                        ⏳ WAITING ON CUSTOMER
                      </span>
                    )}
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    <div className="action-buttons-group">
                      {t.assigneeId === null && (
                        <button
                          type="button"
                          className="btn btn-take btn-xs"
                          disabled={claimingId === t.id}
                          onClick={(e) => handleClaim(t.id, e)}
                        >
                          {claimingId === t.id ? 'Taking...' : 'Take this ticket'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTicket(t.id);
                        }}
                      >
                        View
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

