'use client';

import { useState, useRef, useEffect } from 'react';
import { useNetwork } from './NetworkContext';
import { NETWORK_KEYS, NETWORKS, type NetworkKey } from '@/lib/myusd-config';

export default function NetworkSwitcher() {
  const { networkKey, networkConfig, setNetwork, isDeployed } = useNetwork();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 14px',
    borderRadius: '10px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    fontSize: '12px',
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  };

  const itemBtnStyle = (active: boolean): React.CSSProperties => ({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    borderRadius: '8px',
    border: 'none',
    background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
  });

  const labelStyle = (active: boolean): React.CSSProperties => ({
    fontSize: '13px',
    fontWeight: 700,
    color: active ? 'var(--accent-cyan)' : 'var(--text-primary)',
    fontFamily: "'JetBrains Mono', monospace",
  });

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={btnStyle}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: networkConfig.isTestnet ? '#fbbf24' : '#00ff88',
            boxShadow: `0 0 8px ${networkConfig.isTestnet ? '#fbbf24' : '#00ff88'}`,
          }}
        />
        {networkConfig.name}
        <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 100,
            width: '260px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '8px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          }}
        >
          {/* Combined option */}
          <button
            onClick={() => {
              setNetwork('combined');
              setOpen(false);
            }}
            style={itemBtnStyle(networkKey === 'combined')}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#a855f7',
                boxShadow: '0 0 6px #a855f7',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={labelStyle(networkKey === 'combined')}>Combined</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                All mainnet chains
              </div>
            </div>
            {networkKey === 'combined' && <span style={{ color: 'var(--accent-cyan)', fontSize: '12px' }}>✓</span>}
          </button>

          {NETWORK_KEYS.map((key) => {
            const net = NETWORKS[key];
            const active = key === networkKey;
            const deployed = net.contractAddress !== '0x0000000000000000000000000000000000000000';
            return (
              <button
                key={key}
                onClick={() => {
                  setNetwork(key);
                  setOpen(false);
                }}
                disabled={!deployed}
                style={{
                  ...itemBtnStyle(active),
                  cursor: deployed ? 'pointer' : 'not-allowed',
                  opacity: deployed ? 1 : 0.5,
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: net.isTestnet ? '#fbbf24' : '#00ff88',
                    boxShadow: `0 0 6px ${net.isTestnet ? '#fbbf24' : '#00ff88'}`,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={labelStyle(active)}>{net.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Chain ID {net.chainId} · {deployed ? 'Deployed' : 'Not deployed'}
                  </div>
                </div>
                {active && <span style={{ color: 'var(--accent-cyan)', fontSize: '12px' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {!isDeployed && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 99,
            width: '260px',
            padding: '10px',
            borderRadius: '8px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444',
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          TFUSD not deployed on {networkConfig.name}. Switch to a deployed network to use supply data.
        </div>
      )}
    </div>
  );
}
