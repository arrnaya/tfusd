'use client';

import { useEffect, useState } from 'react';
import { useWallet } from './WalletContext';
import ConnectWallet from './ConnectWallet';

const SIGNATURE_KEY = 'tfusd_wallet_signature';

interface StoredSignature {
  address: string;
  message: string;
  signature: string;
  signedAt: number;
}

export default function WalletGate({ children }: { children: React.ReactNode }) {
  const { signer, address, isConnected } = useWallet();
  const [signed, setSigned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setSigned(false);
      return;
    }
    try {
      const raw = localStorage.getItem(SIGNATURE_KEY);
      if (raw) {
        const stored: StoredSignature = JSON.parse(raw);
        if (stored.address.toLowerCase() === address.toLowerCase() && stored.signature) {
          setSigned(true);
          return;
        }
      }
    } catch {
      // ignore parse errors
    }
    setSigned(false);
  }, [isConnected, address]);

  const handleSign = async () => {
    if (!signer || !address) return;
    setLoading(true);
    setError(null);
    try {
      const message = `I approve connecting wallet ${address} to the TFUSD dApp and confirm that I comply with the terms of use.`;
      const signature = await signer.signMessage(message);
      const stored: StoredSignature = {
        address,
        message,
        signature,
        signedAt: Date.now(),
      };
      localStorage.setItem(SIGNATURE_KEY, JSON.stringify(stored));
      setSigned(true);
    } catch (e: any) {
      setError(e?.message || 'Signature was rejected. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div style={card}>
        <h1 style={heading}>Connect Wallet</h1>
        <p style={sub}>Connect your wallet to access TFUSD Mint & Stake.</p>
        <ConnectWallet />
      </div>
    );
  }

  if (!signed) {
    return (
      <div style={card}>
        <h1 style={heading}>Approve Connection</h1>
        <p style={sub}>
          Sign a message to confirm that you comply with the TFUSD terms of use and approve this
          wallet connection. This signature is only used for access gating and is never sent to a
          server.
        </p>
        <div style={addressBox}>
          <span style={muted}>Connected wallet</span>
          <strong>{address}</strong>
        </div>
        <button onClick={handleSign} disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Waiting for signature...' : 'Sign & Continue'}
        </button>
        {error && <div style={errorStyle}>{error}</div>}
      </div>
    );
  }

  return <>{children}</>;
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: '16px',
  padding: '28px',
  maxWidth: '520px',
  margin: '40px auto',
};

const heading: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: '8px',
};

const sub: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--text-muted)',
  marginBottom: '20px',
  lineHeight: 1.5,
};

const addressBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '12px',
  background: 'rgba(255,255,255,0.03)',
  borderRadius: '10px',
  border: '1px solid var(--border-color)',
  fontSize: '13px',
  fontFamily: "'JetBrains Mono', monospace",
  wordBreak: 'break-all',
  marginBottom: '20px',
};

const primaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, var(--accent-cyan), #0088ff)',
  color: '#fff',
  border: 'none',
  fontSize: '15px',
  fontWeight: 700,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  marginTop: '14px',
  color: 'var(--danger)',
  fontSize: '13px',
};

const muted: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '12px',
};
