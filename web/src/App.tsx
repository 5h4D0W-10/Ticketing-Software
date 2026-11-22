import React from 'react';

export const APP_NAME = 'Frontdesk';
export const ORG_NAME = 'Arvo Systems';

export function App() {
  return (
    <div className="container">
      <header className="header">
        <h1 className="title">{APP_NAME}</h1>
        <p className="subtitle">{ORG_NAME} Support Ticket System</p>
      </header>

      <main className="card">
        <span className="badge">System Operational</span>
        <h2 style={{ marginTop: '1rem', fontSize: '1.25rem' }}>Welcome to Frontdesk</h2>
        <p style={{ marginTop: '0.5rem', color: '#475569' }}>
          Real-time working-time SLA tracking, immutable audit trails, and concurrency-safe ticket management.
        </p>
      </main>
    </div>
  );
}

