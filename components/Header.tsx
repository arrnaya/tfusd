import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthContext';

export default function Header() {
  const { user, isAuthenticated, logout } = useAuth();
  const pathname = usePathname();

  return (
    <header style={styles.header}>
      <div style={styles.headerLeft}>
        <Link href="/" style={styles.logo}>
          <img src="/TFUSD-LOGO.png" alt="TFUSD Logo" style={{ width: '64px', height: '64px' }} />
        </Link>
        <div style={styles.headerTitle}>
          <h1 style={styles.h1}>Treuhand Finanzgruppe USD Decentralized Oracle Network</h1>
          <span style={styles.subtitle}>Proof of Reserves, Supply Management & DAO Governance</span>
        </div>
      </div>

      <nav style={styles.nav}>
        <Link href="/" style={{ ...styles.navLink, ...(pathname === '/' ? styles.navLinkActive : {}) }}>DONs</Link>
        <Link href="/supply" style={{ ...styles.navLink, ...(pathname === '/supply' ? styles.navLinkActive : {}) }}>Supply</Link>
        <Link href="/dao" style={{ ...styles.navLink, ...(pathname === '/dao' ? styles.navLinkActive : {}) }}>DAO</Link>
        <Link href="/admin" style={{ ...styles.navLink, ...(pathname === '/admin' ? styles.navLinkActive : {}) }}>Admin</Link>
        <Link href="/mint" style={{ ...styles.navLink, ...(pathname === '/mint' ? styles.navLinkActive : {}) }}>Mint</Link>
        <Link href="/stake" style={{ ...styles.navLink, ...(pathname === '/stake' ? styles.navLinkActive : {}) }}>Stake</Link>
      </nav>

      <div style={styles.headerRight}>
        {isAuthenticated && user && (
          <>
            <span style={styles.roleBadge}>{user.role}</span>
            <button onClick={logout} style={styles.logoutBtn}>Logout</button>
          </>
        )}
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    position: 'relative',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 28px',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-color)',
    backdropFilter: 'blur(20px)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  logo: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    fontWeight: 800,
    textDecoration: 'none',
    boxShadow: '0 4px 16px rgba(0, 212, 255, 0.25)',
  },
  headerTitle: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  h1: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    letterSpacing: '-0.01em',
    margin: 0,
  },
  subtitle: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
  },
  navLink: {
    color: 'var(--text-muted)',
    fontSize: '13px',
    fontWeight: 600,
    textDecoration: 'none',
    fontFamily: "'JetBrains Mono', monospace",
    padding: '8px 14px',
    borderRadius: '8px',
    transition: 'all 0.2s',
    letterSpacing: '0.02em',
  },
  navLinkActive: {
    color: 'var(--accent-cyan)',
    background: 'rgba(0, 212, 255, 0.08)',
    border: '1px solid rgba(0, 212, 255, 0.2)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  roleBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--accent-purple)',
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '2px 8px',
    background: 'rgba(168, 85, 247, 0.1)',
    borderRadius: '4px',
    border: '1px solid rgba(168, 85, 247, 0.2)',
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '11px',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};