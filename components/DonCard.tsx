import React from 'react';

interface DonCardProps {
  number: number;
  title: string;
  subtitle: string;
  badge: string;
  badgeClass: string;
  children: React.ReactNode;
  bodyHeight?: string;
}

const gradients: Record<number, string> = {
  1: 'linear-gradient(135deg, var(--accent-cyan), #0088ff)',
  2: 'linear-gradient(135deg, var(--accent-purple), #7c3aed)',
  3: 'linear-gradient(135deg, var(--accent-orange), #ff5500)',
  4: 'linear-gradient(135deg, var(--accent-green), #00aa66)',
};

export default function DonCard({ number, title, subtitle, badge, badgeClass, children, bodyHeight }: DonCardProps) {
  return (
    <div style={styles.card} className={`don-card-${number}`}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={{ ...styles.icon, background: gradients[number] }}>{number}</div>
          <div style={styles.titleWrap}>
            <h3 style={styles.title}>{title}</h3>
            <span style={styles.subtitle}>{subtitle}</span>
          </div>
        </div>
        <span style={{ ...styles.badge, ...badgeStyles[badgeClass] }}>{badge}</span>
      </div>
      <div style={{ ...styles.body, height: bodyHeight || styles.body.height }}>{children}</div>
    </div>
  );
}

const badgeStyles: Record<string, React.CSSProperties> = {
  live: {
    background: 'rgba(16, 185, 129, 0.15)',
    color: 'var(--success)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
  },
  code: {
    background: 'rgba(168, 85, 247, 0.15)',
    color: 'var(--accent-purple)',
    border: '1px solid rgba(168, 85, 247, 0.3)',
  },
  logs: {
    background: 'rgba(245, 158, 11, 0.15)',
    color: 'var(--warning)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
  },
  sync: {
    background: 'rgba(0, 255, 136, 0.15)',
    color: 'var(--accent-green)',
    border: '1px solid rgba(0, 255, 136, 0.3)',
  },
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    overflow: 'hidden',
    transition: 'all 0.3s ease',
    position: 'relative',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(255, 255, 255, 0.02)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  icon: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '14px',
    color: 'white',
  },
  titleWrap: {
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    fontSize: '14px',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  subtitle: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  badge: {
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontFamily: "'JetBrains Mono', monospace",
  },
  body: {
    padding: '20px',
    height: '480px',
    display: 'flex',
    flexDirection: 'column',
  },
};
