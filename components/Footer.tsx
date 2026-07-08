'use client';

export default function Footer() {
  return (
    <footer
      style={{
        marginTop: '40px',
        padding: '24px',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-card)',
      }}
    >
      <div
        style={{
          maxWidth: '1600px',
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            TFUSD
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Treuhand Finanzgruppe USD — BSC-native stablecoin dashboard.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <a
            href="https://github.com/arrnaya/tfusd"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'none', fontFamily: "'JetBrains Mono', monospace" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-cyan)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            GitHub
          </a>
          <a
            href="https://www.geckoterminal.com/bsc/pools/0x92e6f8a2a99a86c44d44461693231d091084c7b1ec4f2372c352893caeb4aa84"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'none', fontFamily: "'JetBrains Mono', monospace" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-cyan)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            GeckoTerminal
          </a>
          <a
            href="https://bscscan.com/token/0xe05d4c8a972ee90478861f2c87296bb190adb0b8#transactions"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'none', fontFamily: "'JetBrains Mono', monospace" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-cyan)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            BscScan
          </a>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
          © {new Date().getFullYear()} TFUSD. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
