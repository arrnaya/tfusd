'use client';

import { useEffect, useState } from 'react';
import { useWallet, type EIP6963ProviderDetail } from './WalletContext';
import { truncateAddress } from '@/lib/format-utils';

function hasBrowserWallet(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).ethereum);
}

function walletEmoji(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('metamask')) return '🦊';
  if (lower.includes('trust')) return '🛡️';
  if (lower.includes('brave')) return '🦁';
  if (lower.includes('coinbase')) return '🅲';
  if (lower.includes('rabby')) return '🐰';
  if (lower.includes('phantom')) return '👻';
  return '💼';
}

export default function ConnectWallet() {
  const {
    isConnected,
    isConnecting,
    address,
    error,
    availableProviders,
    connect,
    connectWalletConnect,
    selectProvider,
    dismissProviderSelection,
    disconnect,
  } = useWallet();
  const [browserWallet, setBrowserWallet] = useState(false);

  useEffect(() => {
    setBrowserWallet(hasBrowserWallet());
  }, []);

  const btnStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, var(--accent-cyan), #0088ff)',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 18px',
    fontSize: '13px',
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0, 212, 255, 0.25)',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const secondaryStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    borderRadius: '10px',
    padding: '8px 14px',
    fontSize: '11px',
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    transition: 'all 0.2s',
  };

  const connectedStyle: React.CSSProperties = {
    background: 'rgba(0, 255, 136, 0.1)',
    border: '1px solid rgba(0, 255, 136, 0.3)',
    color: '#00ff88',
    borderRadius: '10px',
    padding: '10px 18px',
    fontSize: '13px',
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const handleBrowserConnect = async () => {
    await connect();
  };

  const handleSelect = async (detail: EIP6963ProviderDetail) => {
    await selectProvider(detail);
  };

  const handleWalletConnect = async () => {
    dismissProviderSelection();
    await connectWalletConnect();
  };

  if (isConnected && address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {error && (
          <span style={{ color: '#ef4444', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>
            {error}
          </span>
        )}
        <button onClick={disconnect} style={connectedStyle}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00ff88', boxShadow: '0 0 8px #00ff88' }} />
          {truncateAddress(address)}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', position: 'relative' }}>
      {error && (
        <span style={{ color: '#ef4444', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>
          {error}
        </span>
      )}

      {browserWallet ? (
        <>
          <button onClick={handleBrowserConnect} disabled={isConnecting} style={{ ...btnStyle, opacity: isConnecting ? 0.7 : 1 }}>
            {isConnecting && availableProviders.length === 0 ? 'Detecting...' : '🦊 Connect Browser Wallet'}
          </button>
          <button onClick={handleWalletConnect} disabled={isConnecting} style={secondaryStyle}>
            WalletConnect
          </button>
        </>
      ) : (
        <button onClick={handleWalletConnect} disabled={isConnecting} style={{ ...btnStyle, opacity: isConnecting ? 0.7 : 1 }}>
          {isConnecting ? 'Connecting...' : '🔗 Connect Wallet'}
        </button>
      )}

      {/* Wallet selector modal */}
      {availableProviders.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 12px)',
            right: 0,
            zIndex: 100,
            width: '320px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '16px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>
              Select Wallet
            </span>
            <button
              onClick={dismissProviderSelection}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {availableProviders.map((detail) => (
              <button
                key={detail.info.rdns || detail.info.uuid}
                onClick={() => handleSelect(detail)}
                disabled={isConnecting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  opacity: isConnecting ? 0.6 : 1,
                }}
              >
                {detail.info.icon ? (
                  <img src={detail.info.icon} alt={detail.info.name} style={{ width: '28px', height: '28px', borderRadius: '6px' }} />
                ) : (
                  <span style={{ fontSize: '22px' }}>{walletEmoji(detail.info.name)}</span>
                )}
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {detail.info.name}
                </span>
              </button>
            ))}

            <button
              onClick={handleWalletConnect}
              disabled={isConnecting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                borderRadius: '12px',
                background: 'transparent',
                border: '1px dashed var(--border-color)',
                cursor: 'pointer',
                textAlign: 'left',
                marginTop: '4px',
              }}
            >
              <span style={{ fontSize: '22px' }}>📱</span>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                WalletConnect (QR)
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
