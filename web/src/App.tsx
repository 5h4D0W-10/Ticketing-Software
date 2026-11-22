import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { LoginPage } from './components/agent/LoginPage';
import { TicketListPage } from './components/agent/TicketListPage';
import { TicketDetailPage } from './components/agent/TicketDetailPage';
import { LateReportsPage } from './components/agent/LateReportsPage';
import { HolidaysPage } from './components/agent/HolidaysPage';
import { CreateTicketPage } from './components/customer/CreateTicketPage';
import { CustomerTicketPage } from './components/customer/CustomerTicketPage';

export const APP_NAME = 'Frontdesk';
export const ORG_NAME = 'Arvo Systems';

function AppContent() {
  const { user, loading } = useAuth();

  // Navigation state
  const [currentView, setCurrentView] = useState<string>('customer-new');
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [activeCustomerToken, setActiveCustomerToken] = useState<string | null>(null);
  const [followUpParentId, setFollowUpParentId] = useState<string | undefined>();
  const [followUpSubject, setFollowUpSubject] = useState<string | undefined>();

  // Parse location hash
  const syncRouteWithHash = () => {
    const hash = window.location.hash.replace(/^#\/?/, '');
    if (!hash) {
      // Default view: if user logged in, agent-tickets; otherwise customer-new
      return;
    }

    if (hash.startsWith('ticket/')) {
      const token = hash.replace('ticket/', '');
      setActiveCustomerToken(token);
      setCurrentView('customer-ticket');
    } else if (hash.startsWith('agent/tickets/')) {
      const ticketId = hash.replace('agent/tickets/', '');
      setActiveTicketId(ticketId);
      setCurrentView('agent-ticket-detail');
    } else if (hash === 'agent/tickets') {
      setCurrentView('agent-tickets');
    } else if (hash === 'agent/login') {
      setCurrentView('agent-login');
    } else if (hash === 'agent/reports/late') {
      setCurrentView('lead-late-report');
    } else if (hash === 'agent/holidays') {
      setCurrentView('lead-holidays');
    } else if (hash === 'customer/new' || hash === '') {
      setCurrentView('customer-new');
    }
  };

  useEffect(() => {
    syncRouteWithHash();
    window.addEventListener('hashchange', syncRouteWithHash);
    return () => window.removeEventListener('hashchange', syncRouteWithHash);
  }, []);

  const navigate = (view: string, param?: string) => {
    setCurrentView(view);
    if (view === 'customer-new') {
      window.location.hash = '/customer/new';
    } else if (view === 'customer-ticket' && param) {
      setActiveCustomerToken(param);
      window.location.hash = `/ticket/${param}`;
    } else if (view === 'agent-login') {
      window.location.hash = '/agent/login';
    } else if (view === 'agent-tickets') {
      setActiveTicketId(null);
      window.location.hash = '/agent/tickets';
    } else if (view === 'agent-ticket-detail' && param) {
      setActiveTicketId(param);
      window.location.hash = `/agent/tickets/${param}`;
    } else if (view === 'lead-late-report') {
      window.location.hash = '/agent/reports/late';
    } else if (view === 'lead-holidays') {
      window.location.hash = '/agent/holidays';
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <p className="text-muted">Initializing Frontdesk...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navbar currentView={currentView} onNavigate={navigate} />

      <main className="container main-content">
        {/* Customer Views */}
        {currentView === 'customer-new' && (
          <CreateTicketPage
            initialParentTicketId={followUpParentId}
            initialSubject={followUpSubject}
            onTicketCreated={(token) => {
              setFollowUpParentId(undefined);
              setFollowUpSubject(undefined);
              navigate('customer-ticket', token);
            }}
          />
        )}

        {currentView === 'customer-ticket' && activeCustomerToken && (
          <CustomerTicketPage
            token={activeCustomerToken}
            onBackToNew={() => navigate('customer-new')}
            onOpenFollowUp={(parentId, subject) => {
              setFollowUpParentId(parentId);
              setFollowUpSubject(subject);
              navigate('customer-new');
            }}
          />
        )}

        {/* Agent Views */}
        {currentView === 'agent-login' && (
          <LoginPage
            onLoginSuccess={() => navigate('agent-tickets')}
          />
        )}

        {currentView === 'agent-tickets' && (
          user ? (
            <TicketListPage
              onSelectTicket={(ticketId) => navigate('agent-ticket-detail', ticketId)}
            />
          ) : (
            <LoginPage
              onLoginSuccess={() => navigate('agent-tickets')}
            />
          )
        )}

        {currentView === 'agent-ticket-detail' && activeTicketId && (
          user ? (
            <TicketDetailPage
              ticketId={activeTicketId}
              onBack={() => navigate('agent-tickets')}
            />
          ) : (
            <LoginPage
              onLoginSuccess={() => navigate('agent-ticket-detail', activeTicketId)}
            />
          )
        )}

        {currentView === 'lead-late-report' && (
          user ? (
            <LateReportsPage
              onSelectTicket={(ticketId) => navigate('agent-ticket-detail', ticketId)}
            />
          ) : (
            <LoginPage
              onLoginSuccess={() => navigate('lead-late-report')}
            />
          )
        )}

        {currentView === 'lead-holidays' && (
          user ? (
            <HolidaysPage />
          ) : (
            <LoginPage
              onLoginSuccess={() => navigate('lead-holidays')}
            />
          )
        )}
      </main>

      <footer className="footer">
        <div className="container footer-content">
          <p>© 2026 Arvo Systems · Frontdesk SLA Engine · Asia/Kolkata Working Time</p>
          <div className="footer-links">
            <span onClick={() => navigate('customer-new')} className="footer-link">Customer Portal</span>
            <span>·</span>
            <span onClick={() => navigate('agent-tickets')} className="footer-link">Agent Portal</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
