'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthContext';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const { isAuthenticated, stage, loginWithPassword, verifyPin, logout } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, router]);

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await loginWithPassword(email.trim(), password);
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'Login failed.');
    }
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await verifyPin(totpCode.trim());
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'TOTP verification failed.');
    }
  }

  if (isAuthenticated) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={{ color: 'var(--text-muted)' }}>Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.bgGrid} />
      <div style={styles.bgGlow} />

      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <div style={styles.logo}>TF</div>
        </div>
        <h1 style={styles.title}>Treuhand Finanzgruppe USD Dashboard</h1>
        <p style={styles.subtitle}>Treuhand Finanzgruppe USD (TFUSD) Stablecoin Platform — Decentralized Oracle Network — Authorized Access Only</p>

        {stage === 'idle' && (
          <>
            <div style={styles.divider} />
            <form onSubmit={handleLoginSubmit} style={styles.form}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@tfusd.io"
                style={styles.textInput}
                autoFocus
              />
              <label style={styles.label}>Password</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={styles.textInput}
              />
              <button
                type="submit"
                disabled={loading || !email || !password}
                style={styles.button}
              >
                {loading ? 'Authenticating...' : 'Continue'}
              </button>
            </form>
            {loading && <p style={styles.hint}>Verifying credentials...</p>}
          </>
        )}

        {stage === 'password-verified' && (
          <>
            <div style={styles.successBanner}>
              <span style={{ color: 'var(--success)' }}>✓</span> Credentials verified
            </div>
            <form onSubmit={handleTotpSubmit} style={styles.form}>
              <label style={styles.label}>Enter 6-Digit PIN</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={'*'.repeat(totpCode.length)}
                onKeyDown={(e) => {
                  if (/^\d$/.test(e.key) && totpCode.length < 6) {
                    setTotpCode(prev => prev + e.key);
                  } else if (e.key === 'Backspace') {
                    setTotpCode(prev => prev.slice(0, -1));
                  }
                }}
                onChange={() => {}}
                placeholder="000000"
                style={styles.input}
                autoFocus
              />
              <button type="submit" disabled={loading || totpCode.length !== 6} style={styles.button}>
                {loading ? 'Verifying...' : 'Verify & Enter'}
              </button>
              <button type="button" onClick={logout} style={styles.secondaryBtn}>
                Cancel / Use different account
              </button>
            </form>
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>
          <span style={styles.footerText}>Protected by Password + PIN</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    overflow: 'hidden',
  },
  bgGrid: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundImage:
      'linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px)',
    backgroundSize: '50px 50px',
    pointerEvents: 'none',
    zIndex: 0,
  },
  bgGlow: {
    position: 'fixed',
    top: '-50%',
    left: '-50%',
    width: '200%',
    height: '200%',
    background:
      'radial-gradient(circle at 30% 30%, rgba(0, 212, 255, 0.05) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)',
    pointerEvents: 'none',
    zIndex: 0,
    animation: 'glowRotate 30s linear infinite',
  },
  card: {
    position: 'relative',
    zIndex: 10,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: '20px',
    padding: '40px',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logoWrap: {
    marginBottom: '20px',
  },
  logo: {
    width: '56px',
    height: '56px',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: '24px',
    color: 'white',
    boxShadow: '0 0 30px rgba(0, 212, 255, 0.3)',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: '6px',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: 'center',
    marginBottom: '24px',
  },
  divider: {
    width: '100%',
    height: '1px',
    background: 'var(--border-color)',
    marginBottom: '24px',
  },
  successBanner: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    color: 'var(--success)',
    fontSize: '13px',
    fontWeight: 600,
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  textInput: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: "'JetBrains Mono', monospace",
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  input: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '14px 16px',
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.15em',
    textAlign: 'center',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  button: {
    background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontSize: '14px',
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0, 212, 255, 0.25)',
    transition: 'transform 0.15s, opacity 0.15s',
  },
  secondaryBtn: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: '4px',
  },
  error: {
    marginTop: '16px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: 'var(--danger)',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    width: '100%',
    textAlign: 'center',
  },
  hint: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
    marginTop: '8px',
  },
  footer: {
    marginTop: '28px',
    paddingTop: '20px',
    borderTop: '1px solid var(--border-color)',
    width: '100%',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
  },
};
