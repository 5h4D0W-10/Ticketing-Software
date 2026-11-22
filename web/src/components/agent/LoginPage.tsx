import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email.trim(), password);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const setDemoCredentials = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Password123!');
  };

  return (
    <div className="login-container">
      <div className="card login-card">
        <h2 className="login-title">Support Agent Login</h2>
        <p className="login-subtitle">Sign in to Arvo Systems Frontdesk</p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="form">
          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>
            <input
              id="login-email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@arvosystems.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="demo-logins">
          <p className="demo-title">Quick Demo Logins (Password: <code>Password123!</code>):</p>
          <div className="demo-buttons">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setDemoCredentials('lead@arvosystems.com')}
            >
              👑 Lead (Supervisor)
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setDemoCredentials('agent1@arvosystems.com')}
            >
              👤 Agent 1
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setDemoCredentials('agent2@arvosystems.com')}
            >
              👤 Agent 2
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

