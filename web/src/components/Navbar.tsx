import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

export function Navbar({ currentView, onNavigate }: NavbarProps) {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-brand" onClick={() => onNavigate('customer-new')}>
          <span className="brand-logo">⚡</span>
          <span className="brand-name">Frontdesk</span>
          <span className="brand-sub">Arvo Systems</span>
        </div>

        <div className="nav-links">
          {/* Customer Facing */}
          <button
            type="button"
            className={`nav-btn ${currentView === 'customer-new' ? 'active' : ''}`}
            onClick={() => onNavigate('customer-new')}
          >
            New Customer Ticket
          </button>

          <span className="nav-divider">|</span>

          {/* Agent Facing */}
          {user ? (
            <>
              <button
                type="button"
                className={`nav-btn ${currentView === 'agent-tickets' ? 'active' : ''}`}
                onClick={() => onNavigate('agent-tickets')}
              >
                My Tickets
              </button>

              {user.role === 'lead' && (
                <>
                  <button
                    type="button"
                    className={`nav-btn ${currentView === 'lead-late-report' ? 'active' : ''}`}
                    onClick={() => onNavigate('lead-late-report')}
                  >
                    Late Report
                  </button>
                  <button
                    type="button"
                    className={`nav-btn ${currentView === 'lead-holidays' ? 'active' : ''}`}
                    onClick={() => onNavigate('lead-holidays')}
                  >
                    Holidays
                  </button>
                </>
              )}

              <div className="nav-user-info">
                <span className="user-badge">
                  {user.name} <span className="role-tag">{user.role}</span>
                </span>
                <button
                  type="button"
                  className="nav-btn-logout"
                  onClick={() => {
                    logout();
                    onNavigate('agent-login');
                  }}
                >
                  Logout
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className={`nav-btn ${currentView === 'agent-login' ? 'active' : ''}`}
              onClick={() => onNavigate('agent-login')}
            >
              Agent Login
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
