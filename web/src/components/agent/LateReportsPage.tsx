import { useState, useEffect } from 'react';
import { LateReportItem } from '../../types';
import { agentApi } from '../../api/agentApi';
import { useAuth } from '../../context/AuthContext';

interface LateReportsPageProps {
  onSelectTicket: (ticketId: string) => void;
}

export function LateReportsPage({ onSelectTicket }: LateReportsPageProps) {
  const { user } = useAuth();
  const [report, setReport] = useState<LateReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.getLateTicketsReport();
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load late tickets report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  if (user?.role !== 'lead') {
    return (
      <div className="card error-card">
        <h2>🔒 Restricted Access</h2>
        <p>The Late Tickets Report is strictly restricted to Lead Supervisors.</p>
      </div>
    );
  }

  return (
    <div className="report-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">📊 Late Tickets Audit Report (R6)</h1>
          <p className="page-subtitle">
            Lead Supervisor View · Exact Root-Cause Analysis & Customer Waiting Time Exclusions
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={fetchReport}
        >
          🔄 Refresh Report
        </button>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="card report-summary-card">
        <div className="summary-stat">
          <span className="stat-label">Total Late Tickets Identified</span>
          <span className="stat-value text-red">{report.length}</span>
        </div>
        <div className="summary-note">
          All calculations exclude weekends, official Kerala holidays, and customer waiting intervals (where SLA clock was paused).
        </div>
      </div>

      <div className="card table-card">
        {loading ? (
          <div className="loading-state">Generating report from immutable audit events...</div>
        ) : report.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">🎉 No Late Tickets Found</p>
            <p className="empty-sub">All active tickets have met their SLA targets within working hours.</p>
          </div>
        ) : (
          <table className="tickets-table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Subject & Customer</th>
                <th>Priority / Status</th>
                <th>Assignee</th>
                <th>Why Was It Late? (Computed Reasons)</th>
                <th>Customer Waiting Excluded</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {report.map((item) => (
                <tr key={item.id}>
                  <td className="ticket-number-cell">
                    <strong>#{item.ticketNumber}</strong>
                  </td>

                  <td>
                    <div className="subject-title">{item.subject}</div>
                    <div className="customer-info">{item.customerName}</div>
                  </td>

                  <td>
                    <span className={`priority-pill priority-${item.priority.toLowerCase()}`}>
                      {item.priority}
                    </span>
                    <span className={`status-pill status-${item.status.toLowerCase()}`} style={{ marginLeft: '0.25rem' }}>
                      {item.status}
                    </span>
                  </td>

                  <td>
                    {item.assigneeName ? (
                      <span className="assignee-name">{item.assigneeName}</span>
                    ) : (
                      <span className="unassigned-tag">Unassigned</span>
                    )}
                  </td>

                  <td>
                    <ul className="reasons-list">
                      {item.reasons.map((r, i) => (
                        <li key={i} className="reason-item text-red">
                          • {r}
                        </li>
                      ))}
                    </ul>
                  </td>

                  <td>
                    {item.excludedCustomerWaitingMinutes > 0 ? (
                      <span className="text-amber font-semibold">
                        {item.excludedCustomerWaitingFormatted} ({item.excludedCustomerWaitingMinutes}m paused)
                      </span>
                    ) : (
                      <span className="text-muted">None (0m)</span>
                    )}
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => onSelectTicket(item.id)}
                    >
                      Inspect Timeline
                    </button>
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
