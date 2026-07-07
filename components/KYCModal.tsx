'use client';

interface KYCModalProps {
  amount: string;
  threshold: string;
  onClose: () => void;
  onCheckAgain: () => void;
}

export default function KYCModal({ amount, threshold, onClose, onCheckAgain }: KYCModalProps) {
  const kycUrl = process.env.NEXT_PUBLIC_BALLERINE_KYC_URL || 'https://github.com/jewelhuq/kyc-kyb';

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={title}>Identity Verification Required</h3>
        <p style={text}>
          Transactions over <strong>{threshold} TFUSD</strong> require KYC verification.
          Your requested amount: <strong>{amount} TFUSD</strong>.
        </p>
        <p style={text}>
          Complete KYC through our secure partner Ballerine. Once approved, the KYC
          verifier will update your on-chain status.
        </p>
        <div style={actions}>
          <button
            style={primaryBtn}
            onClick={() => {
              window.open(kycUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            Start KYC
          </button>
          <button style={secondaryBtn} onClick={onCheckAgain}>
            I have completed KYC
          </button>
          <button style={ghostBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
  padding: '20px',
};

const modal: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: '16px',
  padding: '24px',
  maxWidth: '440px',
  width: '100%',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
};

const title: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  marginBottom: '12px',
  color: 'var(--text-primary)',
};

const text: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--text-secondary)',
  lineHeight: 1.6,
  marginBottom: '12px',
};

const actions: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  marginTop: '20px',
};

const btnBase: React.CSSProperties = {
  padding: '12px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
  border: 'none',
};

const primaryBtn: React.CSSProperties = {
  ...btnBase,
  background: 'linear-gradient(135deg, var(--accent-cyan), #0088ff)',
  color: '#fff',
};

const secondaryBtn: React.CSSProperties = {
  ...btnBase,
  background: 'rgba(0,255,136,0.1)',
  color: 'var(--accent-green)',
  border: '1px solid rgba(0,255,136,0.3)',
};

const ghostBtn: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border-color)',
};
