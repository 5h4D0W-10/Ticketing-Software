import React, { useState, useEffect } from 'react';
import { Holiday } from '../../types';
import { agentApi } from '../../api/agentApi';
import { useAuth } from '../../context/AuthContext';

export function HolidaysPage() {
  const { user } = useAuth();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New holiday form
  const [holidayDate, setHolidayDate] = useState('2026-01-01');
  const [description, setDescription] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchHolidays = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.getHolidays();
      // Sort by holiday date ascending
      data.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
      setHolidays(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load holidays');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, []);

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayDate || !description.trim()) return;

    setAdding(true);
    setError(null);
    setSuccess(null);

    try {
      await agentApi.addHoliday(holidayDate, description.trim());
      setDescription('');
      setSuccess(`Holiday on ${holidayDate} added successfully. Working-time engine will exclude this date.`);
      await fetchHolidays();
    } catch (err: any) {
      setError(err.message || 'Failed to add holiday');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteHoliday = async (id: string, date: string, desc: string) => {
    if (!window.confirm(`Remove holiday "${desc}" (${date})? This will affect working-time SLA calculations.`)) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await agentApi.deleteHoliday(id);
      setSuccess(`Holiday on ${date} removed successfully.`);
      await fetchHolidays();
    } catch (err: any) {
      setError(err.message || 'Failed to delete holiday');
    }
  };

  if (user?.role !== 'lead') {
    return (
      <div className="card error-card">
        <h2>🔒 Restricted Access</h2>
        <p>Holidays management is strictly restricted to Lead Supervisors.</p>
      </div>
    );
  }

  return (
    <div className="holidays-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">📅 Holidays Management (R1)</h1>
          <p className="page-subtitle">
            Lead Supervisor View · 2026 Indian & Kerala Public / Festival Holidays
          </p>
        </div>

        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={fetchHolidays}
        >
          🔄 Refresh
        </button>
      </div>

      <div className="alert alert-info">
        ℹ️ <strong>SLA Engine Notice:</strong> Days listed below are completely excluded from working-time calculations (09:30–18:30 IST). Tickets spanning these dates automatically have their deadlines pushed forward. (Flag: verify these dates before production deployment).
      </div>

      {success && (
        <div className="alert alert-success" role="alert">
          {success}
        </div>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Add Holiday Form */}
      <div className="card add-holiday-card">
        <h3 className="section-title">Add New Public or Festival Holiday</h3>
        <form onSubmit={handleAddHoliday} className="add-holiday-form">
          <div className="form-group-inline">
            <label htmlFor="holiday-date">Date (YYYY-MM-DD):</label>
            <input
              id="holiday-date"
              type="date"
              className="form-input"
              value={holidayDate}
              onChange={(e) => setHolidayDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group-inline" style={{ flexGrow: 1 }}>
            <label htmlFor="holiday-desc">Holiday Description / Name:</label>
            <input
              id="holiday-desc"
              type="text"
              className="form-input"
              placeholder="e.g. Onam / Republic Day / Diwali"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={adding}
          >
            {adding ? 'Adding...' : '+ Add Holiday'}
          </button>
        </form>
      </div>

      {/* Holidays Table */}
      <div className="card table-card">
        {loading ? (
          <div className="loading-state">Loading holidays...</div>
        ) : holidays.length === 0 ? (
          <div className="empty-state">No holidays registered.</div>
        ) : (
          <table className="tickets-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Festival / Occasion</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => {
                const d = new Date(`${h.holiday_date}T00:00:00Z`);
                const dayName = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

                return (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.holiday_date}</strong>
                    </td>
                    <td>{dayName}</td>
                    <td>{h.description}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-xs btn-danger-outline"
                        onClick={() => handleDeleteHoliday(h.id, h.holiday_date, h.description)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

