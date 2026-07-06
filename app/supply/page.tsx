'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthContext';
import { useMyUSD } from '@/components/MyUSDContext';
import Header from '@/components/Header';
import ConnectWallet from '@/components/ConnectWallet';
import NetworkSwitcher from '@/components/NetworkSwitcher';
import { useNetwork } from '@/components/NetworkContext';
import { NETWORKS, NETWORK_KEYS, type NetworkKey } from '@/lib/myusd-config';
import { ethers } from 'ethers';
import { formatUSD, formatNumber, formatCompact, formatPercentage, formatTimeAgo, truncateAddress } from '@/lib/format-utils';
import { sparklinePath, sparklineAreaPath, getMinMax, scaleLinear } from '@/lib/chart-utils';
import { fetchLiveReserves, type LiveReserveData } from '@/lib/reserves';

export default function SupplyPage() {
  const router = useRouter();
  const { isAuthenticated, user, isMinter, isGuardian, isAdmin } = useAuth();
  const { state, acknowledgeAlert, acknowledgeAllAlerts, manualMint, manualBurn, replenishPool, emergencyPause, emergencyUnpause, refreshData } = useMyUSD();
  const { networkKey, networkConfig, isDeployed } = useNetwork();
  const [blacklistAddr, setBlacklistAddr] = useState('');
  const [freezeAddr, setFreezeAddr] = useState('');
  const [dexAddr, setDexAddr] = useState('');
  const [bulkAddresses, setBulkAddresses] = useState('');
  const [bulkAction, setBulkAction] = useState<'blacklist' | 'tradeFreeze' | 'dex'>('blacklist');
  const [minterAddr, setMinterAddr] = useState('');
  const [minterAllowance, setMinterAllowance] = useState('');
  const [rescueToken, setRescueToken] = useState('');
  const [rescueTo, setRescueTo] = useState('');
  const [blacklistedList, setBlacklistedList] = useState<string[]>([]);
  const [frozenList, setFrozenList] = useState<string[]>([]);
  const [dexList, setDexList] = useState<string[]>([]);
  const [mintAmount, setMintAmount] = useState('');
  const [mintTo, setMintTo] = useState('');
  const [burnAmount, setBurnAmount] = useState('');
  const [replenishAmount, setReplenishAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'controls' | 'alerts' | 'history'>('overview');
  const [reserves, setReserves] = useState<LiveReserveData>({ euroAmount: 0, maalAmount: 0, eurcUsd: 0, maalUsd: 0, totalUsd: 0, loading: true, error: null, lastUpdated: null });

  const isCombinedSupply = networkKey === 'combined';
  const { scopeTotalSupply, scopeCirculatingSupply, scopeAvailable } = useMemo(() => {
    const raw = state.crossChainSupplyRaw;
    if (!raw || Object.keys(raw).length === 0) {
      return { scopeTotalSupply: null, scopeCirculatingSupply: null, scopeAvailable: false };
    }
    const keys = isCombinedSupply ? NETWORK_KEYS : [networkKey];
    let totalRaw = BigInt(0);
    let any = false;
    for (const k of keys) {
      const value = raw[k as NetworkKey];
      if (value !== undefined) {
        totalRaw += value;
        any = true;
      }
    }
    if (!any) {
      return { scopeTotalSupply: null, scopeCirculatingSupply: null, scopeAvailable: false };
    }
    const total = ethers.formatUnits(totalRaw, 18);
    const circ = (parseFloat(total) * 0.85).toFixed(0);
    return { scopeTotalSupply: total, scopeCirculatingSupply: circ, scopeAvailable: true };
  }, [state.crossChainSupplyRaw, networkKey, isCombinedSupply]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setReserves((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await fetchLiveReserves();
        if (!cancelled) setReserves({ ...data, loading: false });
      } catch (e: any) {
        if (!cancelled) setReserves((prev) => ({ ...prev, loading: false, error: e?.message || 'Failed to load reserves' }));
      }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
          Authentication Required<br />
          <button onClick={() => router.push('/login')} style={{ marginTop: '12px', background: 'var(--accent-cyan)', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Go to Login</button>
        </div>
      </div>
    );
  }

  const hasMintPermission = isMinter || isGuardian || isAdmin;
  const hasGuardianPermission = isGuardian || isAdmin;

  const handleMint = async () => {
    if (!mintAmount || !mintTo || !user) return;
    await manualMint(mintAmount, mintTo, user.email);
    setMintAmount(''); setMintTo('');
  };

  const handleBurn = async () => {
    if (!burnAmount || !user) return;
    await manualBurn(burnAmount, user.email);
    setBurnAmount('');
  };

  const handleReplenish = async () => {
    if (!replenishAmount || !user) return;
    await replenishPool(replenishAmount, user.email);
    setReplenishAmount('');
  };

  const priceData = state.priceHistory.map(p => p.close);
  const sparklineData = priceData.length > 1 ? sparklinePath(priceData, 700, 120) : '';
  const sparklineArea = priceData.length > 1 ? sparklineAreaPath(priceData, 700, 120) : '';
  const isUp = (state.priceChange24h ?? 0) >= 0;
  const sparkColor = isUp ? '#00ff88' : '#ef4444';

  const alertColors = { info: '#00d4ff', warning: '#fbbf24', critical: '#ef4444' };
  const alertBg = { info: 'rgba(0,212,255,0.05)', warning: 'rgba(245,158,11,0.05)', critical: 'rgba(239,68,68,0.05)' };

  const combinedHistory = [...state.mintHistory, ...state.burnHistory].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const gaugeMin = 0.98;
  const gaugeMax = 1.02;
  const gaugeVal = Math.max(gaugeMin, Math.min(gaugeMax, state.currentPrice));
  const gaugePct = (gaugeVal - gaugeMin) / (gaugeMax - gaugeMin);
  const gaugeAngle = gaugePct * 180;
  const pegStatus = state.pegStatus;
  const pegColor = pegStatus === 'stable' ? '#00ff88' : pegStatus === 'critical' ? '#ef4444' : pegStatus === 'depeg' ? '#ef4444' : '#fbbf24';
  const pegLabel = pegStatus === 'stable' ? 'STABLE' : pegStatus === 'critical' ? 'CRITICAL' : pegStatus === 'depeg' ? 'DEPEG' : 'OVER-PEG';

  const cardStyle: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden' };
  const cardHeaderStyle: React.CSSProperties = { padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
  const cardTitleStyle: React.CSSProperties = { fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' };
  const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '6px', display: 'block' };
  const inputStyle: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace", outline: 'none', width: '100%', marginBottom: '14px' };
  const btnStyle = (bg: string): React.CSSProperties => ({ width: '100%', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', background: bg, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', position: 'relative' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: 'linear-gradient(rgba(0,212,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.08) 1px, transparent 1px)', backgroundSize: '50px 50px', pointerEvents: 'none', zIndex: 0 }} />
      <div style={{ position: 'fixed', top: '-50%', left: '-50%', width: '200%', height: '200%', background: 'radial-gradient(circle at 30% 30%, rgba(0,212,255,0.08) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(168,85,247,0.08) 0%, transparent 50%)', pointerEvents: 'none', zIndex: 0 }} />
      <Header />
      <main style={{ maxWidth: '1600px', margin: '0 auto', padding: '24px', position: 'relative', zIndex: 10 }}>
        {/* Price Banner */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '20px 24px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.1em' }}>TFUSD / USD</div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{formatUSD(state.currentPrice, 4)}</div>
            </div>
            <NetworkSwitcher />
            <ConnectWallet />
          </div>
          <div style={{ padding: '4px 10px', borderRadius: '6px', background: isUp ? 'rgba(0,255,136,0.1)' : 'rgba(239,68,68,0.1)', color: isUp ? '#00ff88' : '#ef4444', fontSize: '13px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
            {formatPercentage(state.priceChange24h)}
          </div>
          <div style={{ display: 'flex', gap: '24px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>MARKET CAP</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{state.marketCap ? formatCompact(state.marketCap) : '--'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>24H VOLUME</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatCompact(state.volume24h)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>FDV</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{formatCompact(state.fdv)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>LAST UPDATED</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent-cyan)', fontFamily: "'JetBrains Mono', monospace" }}>{formatTimeAgo(state.lastUpdated)}</div>
            </div>
          </div>
        </div>

        {/* Unacknowledged Critical Alerts */}
        {state.unacknowledgedCriticalCount > 0 && (
          <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>⚠️</span>
              <span style={{ color: '#ef4444', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}>{state.unacknowledgedCriticalCount} UNACKNOWLEDGED CRITICAL ALERT{state.unacknowledgedCriticalCount > 1 ? 'S' : ''}</span>
            </div>
            <button onClick={acknowledgeAllAlerts} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: '6px', padding: '6px 14px', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 }}>Acknowledge All</button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', padding: '4px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid var(--border-color)', width: 'fit-content' }}>
          {(['overview', 'controls', 'alerts', 'history'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '8px 18px', borderRadius: '8px', border: activeTab === tab ? '1px solid rgba(0,212,255,0.2)' : '1px solid transparent', background: activeTab === tab ? 'rgba(0,212,255,0.08)' : 'transparent', color: activeTab === tab ? 'var(--accent-cyan)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {tab}
            </button>
          ))}
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            {/* Collateralization Status Banner -- supply scope follows the top network dropdown (Combined = all mainnets) */}
            {(() => {
              const hasSupply = !!scopeTotalSupply && parseFloat(scopeTotalSupply) > 0;
              const mintedSupply = scopeTotalSupply ? parseFloat(scopeTotalSupply) || 0 : 0;
              const reserveUsd = reserves.totalUsd;
              const ratio = hasSupply ? (reserveUsd / mintedSupply) * 100 : Infinity;
              const isOver = !hasSupply || reserveUsd >= mintedSupply;
              const diff = reserveUsd - mintedSupply;
              const statusColor = isOver ? '#00ff88' : '#ef4444';
              const statusBg = isOver ? 'rgba(0,255,136,0.08)' : 'rgba(239,68,68,0.08)';
              const statusBorder = isOver ? 'rgba(0,255,136,0.35)' : 'rgba(239,68,68,0.35)';
              return (
                <div style={{ marginBottom: '20px', padding: '24px', borderRadius: '16px', background: isOver ? 'linear-gradient(135deg, rgba(0,255,136,0.08), rgba(0,212,255,0.06))' : 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(245,158,11,0.06))', border: `2px solid ${statusColor}`, boxShadow: `0 0 24px ${statusColor}20` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.1em' }}>Collateralization Ratio</div>
                      <div style={{ fontSize: '42px', fontWeight: 800, color: statusColor, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-0.02em', marginTop: '4px' }}>
                        {!scopeAvailable || reserves.loading ? '---' : (ratio === Infinity ? '∞' : `${ratio.toFixed(2)}%`)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 20px', borderRadius: '24px', background: statusBg, border: `1px solid ${statusBorder}` }}>
                      <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: statusColor, boxShadow: `0 0 12px ${statusColor}` }} />
                      <span style={{ fontSize: '16px', fontWeight: 800, color: statusColor, fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {!hasSupply ? 'No Supply' : isOver ? 'Overcollateralized' : 'Undercollateralized'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginTop: '20px' }}>
                    <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>Minted Supply</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{scopeTotalSupply ? `${formatCompact(scopeTotalSupply)} TFUSD` : '---'}</div>
                    </div>
                    <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>Total Reserves (USD)</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: '#fbbf24', fontFamily: "'JetBrains Mono', monospace" }}>{reserves.loading ? '---' : formatUSD(reserveUsd, 2)}</div>
                    </div>
                    <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>{isOver ? 'Surplus' : 'Gap'}</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: statusColor, fontFamily: "'JetBrains Mono', monospace" }}>{reserves.loading ? '---' : formatUSD(Math.abs(diff), 2)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '6px' }}>
                      <span>0%</span>
                      <span>100% FULLY COLLATERALIZED</span>
                      <span>200%+</span>
                    </div>
                    <div style={{ height: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '5px', overflow: 'hidden', position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '2px', background: 'rgba(255,255,255,0.3)', zIndex: 2 }} />
                      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, ratio / 2))}%`, background: isOver ? 'linear-gradient(90deg, #00ff88, #00d4ff)' : 'linear-gradient(90deg, #ef4444, #fbbf24)', borderRadius: '5px', transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
              {/* Peg Gauge */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>Peg Monitor</div><span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>REAL-TIME</span></div>
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <svg width="200" height="120" viewBox="0 0 200 120">
                  <defs><linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#ef4444" /><stop offset="50%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#00ff88" /></linearGradient></defs>
                  <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" strokeLinecap="round" />
                  <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="12" strokeLinecap="round" strokeDasharray="251.2" strokeDashoffset={`${251.2 - (gaugePct * 251.2)}`} style={{ transition: 'stroke-dashoffset 0.6s' }} />
                  <line x1="100" y1="100" x2={100 + 70 * Math.cos(Math.PI - (gaugeAngle * Math.PI) / 180)} y2={100 - 70 * Math.sin(Math.PI - (gaugeAngle * Math.PI) / 180)} stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                  <circle cx="100" cy="100" r="5" fill="#fff" />
                </svg>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '20px', background: pegColor + '20', border: `1px solid ${pegColor}40`, marginTop: '12px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: pegColor, boxShadow: `0 0 8px ${pegColor}` }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: pegColor, fontFamily: "'JetBrains Mono', monospace" }}>{pegLabel}</span>
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace", marginTop: '6px' }}>{formatUSD(state.currentPrice, 6)}</div>
              </div>
            </div>

            {/* Price Sparkline */}
            <div style={{ ...cardStyle, gridColumn: 'span 3' }}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>Price History</div><span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>24H</span></div>
              <div style={{ padding: '20px' }}>
                {priceData.length > 1 ? (
                  <svg width="100%" height="140" viewBox="0 0 700 140" preserveAspectRatio="none">
                    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={sparkColor} stopOpacity={0.2} /><stop offset="100%" stopColor={sparkColor} stopOpacity={0} /></linearGradient></defs>
                    <path d={sparklineArea} fill="url(#areaGrad)" />
                    <path d={sparklineData} fill="none" stroke={sparkColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <text x="690" y="14" textAnchor="end" fill={sparkColor} fontSize="11" fontFamily="'JetBrains Mono', monospace" fontWeight={700}>{formatPercentage(state.priceChange24h)}</text>
                  </svg>
                ) : <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No price data</div>}
              </div>
            </div>

            {/* Supply Cards */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>Total Supply{networkKey === 'combined' ? ' (Combined)' : ` (${NETWORKS[networkKey].shortName})`}</div></div>
              <div style={{ padding: '20px' }}>
                <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--accent-cyan)', fontFamily: "'JetBrains Mono', monospace" }}>{scopeTotalSupply ? formatCompact(scopeTotalSupply) : '---'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>TFUSD</div>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>Circulating</div></div>
              <div style={{ padding: '20px' }}>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#00ff88', fontFamily: "'JetBrains Mono', monospace" }}>{scopeCirculatingSupply ? formatCompact(scopeCirculatingSupply) : '---'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>TFUSD</div>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>Burned</div></div>
              <div style={{ padding: '20px' }}>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#ef4444', fontFamily: "'JetBrains Mono', monospace" }}>{formatCompact(state.burnedSupply)}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>TFUSD</div>
              </div>
            </div>

            {/* Cross-Chain Supply Breakdown */}
            {Object.keys(state.crossChainSupply || {}).length > 0 && (
              <div style={{ ...cardStyle, gridColumn: 'span 3' }}>
                <div style={cardHeaderStyle}><div style={cardTitleStyle}>Cross-Chain Supply Breakdown</div></div>
                <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  {Object.entries(state.crossChainSupply || {}).map(([key, amount]) => (
                    <div key={key} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '12px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.05em' }}>{NETWORKS[key as NetworkKey].shortName}</div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace", marginTop: '4px' }}>{formatCompact(amount)} TFUSD</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Network & Contracts */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div style={cardTitleStyle}>Network & Contracts</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isDeployed ? '#00ff88' : '#ef4444', boxShadow: `0 0 8px ${isDeployed ? '#00ff88' : '#ef4444'}` }} />
                  <span style={{ fontSize: '10px', fontWeight: 700, color: isDeployed ? '#00ff88' : '#ef4444', fontFamily: "'JetBrains Mono', monospace" }}>
                    {isDeployed ? 'DEPLOYED' : 'NOT DEPLOYED'}
                  </span>
                </div>
              </div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>Network</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{networkConfig.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>Chain ID</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{networkConfig.chainId}</span>
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '4px' }}>TFUSD CONTRACT</div>
                  <a
                    href={`${networkConfig.explorerUrl}/address/${networkConfig.contractAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: "'JetBrains Mono', monospace", textDecoration: 'none', wordBreak: 'break-all' }}
                  >
                    {truncateAddress(networkConfig.contractAddress)}
                  </a>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '4px' }}>DAO CONTRACT</div>
                  <a
                    href={`${networkConfig.explorerUrl}/address/${networkConfig.daoAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: "'JetBrains Mono', monospace", textDecoration: 'none', wordBreak: 'break-all' }}
                  >
                    {truncateAddress(networkConfig.daoAddress)}
                  </a>
                </div>
              </div>
            </div>

            {/* Contract Status */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>Contract Status</div></div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: state.paused ? '#ef4444' : '#00ff88', boxShadow: `0 0 10px ${state.paused ? '#ef4444' : '#00ff88'}` }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: state.paused ? '#ef4444' : '#00ff88', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{state.paused ? 'PAUSED' : 'OPERATIONAL'}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '4px' }}>Minting: {state.mintingEnabled ? '✅' : '❌'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '4px' }}>Burning: {state.burningEnabled ? '✅' : '❌'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '4px' }}>Auto-mint: {state.autoMintOnDepeg ? 'ON' : 'OFF'}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>Auto-burn: {state.autoBurnOnPositiveDepeg ? 'ON' : 'OFF'}</div>
              </div>
            </div>

            {/* Total USD Reserves */}
            <div style={{ ...cardStyle, gridColumn: 'span 2' }}>
              <div style={cardHeaderStyle}>
                <div style={cardTitleStyle}>Total USD Reserves</div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>LIVE</span>
              </div>
              <div style={{ padding: '20px' }}>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#fbbf24', fontFamily: "'JetBrains Mono', monospace" }}>
                  {reserves.loading ? '...' : formatUSD(reserves.totalUsd, 2)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginTop: '16px' }}>
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>EURO CASH</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>€{formatNumber(reserves.euroAmount)}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>@ {formatUSD(reserves.eurcUsd, 4)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>MAAL</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{formatCompact(reserves.maalAmount.toString())} MAAL</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>@ {formatUSD(reserves.maalUsd, 4)}</div>
                  </div>
                </div>
                {reserves.error && <div style={{ marginTop: '12px', fontSize: '11px', color: '#ef4444', fontFamily: "'JetBrains Mono', monospace" }}>{reserves.error}</div>}
              </div>
            </div>

            {/* 24H Activity */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>24H Activity</div></div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Minted</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#00ff88', fontFamily: "'JetBrains Mono', monospace" }}>+{formatCompact(state.mintedToday)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Burned</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#ef4444', fontFamily: "'JetBrains Mono', monospace" }}>-{formatCompact(state.burnedToday)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Buys</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#00ff88', fontFamily: "'JetBrains Mono', monospace" }}>{formatNumber(state.buys24h)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sells</span>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#ef4444', fontFamily: "'JetBrains Mono', monospace" }}>{formatNumber(state.sells24h)}</span>
                </div>
              </div>
            </div>

            {/* Pool Status */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}><div style={cardTitleStyle}>Pool Status</div></div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: state.pool.health === 'healthy' ? '#00ff88' : state.pool.health === 'low' ? '#fbbf24' : '#ef4444', boxShadow: `0 0 10px ${state.pool.health === 'healthy' ? '#00ff88' : state.pool.health === 'low' ? '#fbbf24' : '#ef4444'}` }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{state.pool.health}</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}>{formatCompact(state.pool.balance)}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Target: {formatCompact(state.pool.target)}</div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden', marginTop: '12px' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (parseFloat(state.pool.balance) / parseFloat(state.pool.target)) * 100)}%`, background: state.pool.health === 'healthy' ? 'linear-gradient(90deg, #00ff88, #00d4ff)' : state.pool.health === 'low' ? 'linear-gradient(90deg, #fbbf24, #ff9500)' : 'linear-gradient(90deg, #ef4444, #ff3366)', borderRadius: '3px', transition: 'width 0.3s' }} />
                </div>
                {state.pool.lastReplenishAt && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px', fontFamily: "'JetBrains Mono', monospace" }}>Last replenish: {formatTimeAgo(state.pool.lastReplenishAt)}</div>}
              </div>
            </div>

          </div>
          </>
        )}

        {/* CONTROLS TAB */}
        {activeTab === 'controls' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
            {hasMintPermission && (
              <>
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Mint TFUSD</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>Amount</label>
                    <input value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} placeholder="1000000" style={inputStyle} />
                    <label style={labelStyle}>Recipient Address</label>
                    <input value={mintTo} onChange={(e) => setMintTo(e.target.value)} placeholder="0x..." style={inputStyle} />
                    <button onClick={handleMint} disabled={!mintAmount || !mintTo} style={{ ...btnStyle('linear-gradient(135deg, #00ff88, #00aa66)'), opacity: !mintAmount || !mintTo ? 0.5 : 1 }}>Mint</button>
                  </div>
                </div>
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Burn TFUSD</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>Amount</label>
                    <input value={burnAmount} onChange={(e) => setBurnAmount(e.target.value)} placeholder="1000000" style={inputStyle} />
                    <button onClick={handleBurn} disabled={!burnAmount} style={{ ...btnStyle('linear-gradient(135deg, #ef4444, #ff3366)'), opacity: !burnAmount ? 0.5 : 1 }}>Burn</button>
                  </div>
                </div>
              </>
            )}
            {hasGuardianPermission && (
              <>
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Replenish Pool</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>Amount</label>
                    <input value={replenishAmount} onChange={(e) => setReplenishAmount(e.target.value)} placeholder="1000000" style={inputStyle} />
                    <button onClick={handleReplenish} disabled={!replenishAmount} style={{ ...btnStyle('linear-gradient(135deg, #00d4ff, #0088ff)'), opacity: !replenishAmount ? 0.5 : 1 }}>Replenish</button>
                  </div>
                </div>
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Emergency Controls</div></div>
                  <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <button onClick={() => user && emergencyPause(user.email)} style={btnStyle('linear-gradient(135deg, #ef4444, #ff3366)')}>🚨 Emergency Pause</button>
                    <button onClick={() => user && emergencyUnpause(user.email)} style={btnStyle('linear-gradient(135deg, #00ff88, #00aa66)')}>✅ Unpause Contract</button>
                  </div>
                </div>

                {/* Blacklist Management */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Blacklist Management</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>Address</label>
                    <input value={blacklistAddr} onChange={(e) => setBlacklistAddr(e.target.value)} placeholder="0x..." style={inputStyle} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { if (blacklistAddr) { setBlacklistedList([...blacklistedList, blacklistAddr]); setBlacklistAddr(''); } }} style={{ ...btnStyle('linear-gradient(135deg, #ef4444, #ff3366)'), flex: 1, padding: '10px' }}>Add Blacklist</button>
                      <button onClick={() => { setBlacklistedList(blacklistedList.filter(a => a !== blacklistAddr)); setBlacklistAddr(''); }} style={{ ...btnStyle('linear-gradient(135deg, #00ff88, #00aa66)'), flex: 1, padding: '10px' }}>Remove</button>
                    </div>
                    {blacklistedList.length > 0 && (
                      <div style={{ marginTop: '12px', maxHeight: '120px', overflowY: 'auto', padding: '8px', background: 'rgba(239,68,68,0.05)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.15)' }}>
                        {blacklistedList.map((addr, i) => (
                          <div key={i} style={{ fontSize: '11px', color: '#ef4444', fontFamily: "'JetBrains Mono', monospace", padding: '2px 0' }}>{truncateAddress(addr)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Trade Freeze Management */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Trade Freeze Management</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>Address</label>
                    <input value={freezeAddr} onChange={(e) => setFreezeAddr(e.target.value)} placeholder="0x..." style={inputStyle} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { if (freezeAddr) { setFrozenList([...frozenList, freezeAddr]); setFreezeAddr(''); } }} style={{ ...btnStyle('linear-gradient(135deg, #fbbf24, #ff9500)'), flex: 1, padding: '10px' }}>Add Freeze</button>
                      <button onClick={() => { setFrozenList(frozenList.filter(a => a !== freezeAddr)); setFreezeAddr(''); }} style={{ ...btnStyle('linear-gradient(135deg, #00ff88, #00aa66)'), flex: 1, padding: '10px' }}>Remove</button>
                    </div>
                    {frozenList.length > 0 && (
                      <div style={{ marginTop: '12px', maxHeight: '120px', overflowY: 'auto', padding: '8px', background: 'rgba(251,191,36,0.05)', borderRadius: '8px', border: '1px solid rgba(251,191,36,0.15)' }}>
                        {frozenList.map((addr, i) => (
                          <div key={i} style={{ fontSize: '11px', color: '#fbbf24', fontFamily: "'JetBrains Mono', monospace", padding: '2px 0' }}>{truncateAddress(addr)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* DEX Registry */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>DEX Registry</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>DEX Address</label>
                    <input value={dexAddr} onChange={(e) => setDexAddr(e.target.value)} placeholder="0x..." style={inputStyle} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => { if (dexAddr) { setDexList([...dexList, dexAddr]); setDexAddr(''); } }} style={{ ...btnStyle('linear-gradient(135deg, #00d4ff, #0088ff)'), flex: 1, padding: '10px' }}>Register DEX</button>
                      <button onClick={() => { setDexList(dexList.filter(a => a !== dexAddr)); setDexAddr(''); }} style={{ ...btnStyle('linear-gradient(135deg, #666, #444)'), flex: 1, padding: '10px' }}>Remove</button>
                    </div>
                    {dexList.length > 0 && (
                      <div style={{ marginTop: '12px', maxHeight: '120px', overflowY: 'auto', padding: '8px', background: 'rgba(0,212,255,0.05)', borderRadius: '8px', border: '1px solid rgba(0,212,255,0.15)' }}>
                        {dexList.map((addr, i) => (
                          <div key={i} style={{ fontSize: '11px', color: '#00d4ff', fontFamily: "'JetBrains Mono', monospace", padding: '2px 0' }}>{truncateAddress(addr)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bulk Operations */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Bulk Operations</div></div>
                  <div style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      {(['blacklist', 'tradeFreeze', 'dex'] as const).map((a) => (
                        <button key={a} onClick={() => setBulkAction(a)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: bulkAction === a ? 'rgba(0,212,255,0.1)' : 'transparent', color: bulkAction === a ? 'var(--accent-cyan)' : 'var(--text-muted)', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600, textTransform: 'uppercase' }}>{a}</button>
                      ))}
                    </div>
                    <label style={labelStyle}>Addresses (one per line)</label>
                    <textarea value={bulkAddresses} onChange={(e) => setBulkAddresses(e.target.value)} placeholder="0x...\n0x...\n0x..." style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} />
                    <button onClick={() => {
                      const addrs = bulkAddresses.split('\n').map(a => a.trim()).filter(a => a.startsWith('0x'));
                      if (bulkAction === 'blacklist') setBlacklistedList([...blacklistedList, ...addrs]);
                      else if (bulkAction === 'tradeFreeze') setFrozenList([...frozenList, ...addrs]);
                      else setDexList([...dexList, ...addrs]);
                      setBulkAddresses('');
                    }} style={{ ...btnStyle('linear-gradient(135deg, #a855f7, #7c3aed)'), padding: '10px' }}>Execute Bulk {bulkAction === 'blacklist' ? 'Blacklist' : bulkAction === 'tradeFreeze' ? 'Trade Freeze' : 'DEX Register'}</button>
                  </div>
                </div>

                {/* Minter Management */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Minter Management</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>Minter Address</label>
                    <input value={minterAddr} onChange={(e) => setMinterAddr(e.target.value)} placeholder="0x..." style={inputStyle} />
                    <label style={labelStyle}>Allowance (TFUSD)</label>
                    <input value={minterAllowance} onChange={(e) => setMinterAllowance(e.target.value)} placeholder="100000000" style={inputStyle} />
                    <button onClick={() => { setMinterAddr(''); setMinterAllowance(''); }} style={{ ...btnStyle('linear-gradient(135deg, #00d4ff, #0088ff)'), padding: '10px' }}>Configure Minter</button>
                  </div>
                </div>

                {/* Rescue Stuck Funds */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}><div style={cardTitleStyle}>Rescue Stuck Funds</div></div>
                  <div style={{ padding: '20px' }}>
                    <label style={labelStyle}>Token Address (0x0 for native)</label>
                    <input value={rescueToken} onChange={(e) => setRescueToken(e.target.value)} placeholder="0x..." style={inputStyle} />
                    <label style={labelStyle}>Recipient Address</label>
                    <input value={rescueTo} onChange={(e) => setRescueTo(e.target.value)} placeholder="0x..." style={inputStyle} />
                    <button onClick={() => { setRescueToken(''); setRescueTo(''); }} style={{ ...btnStyle('linear-gradient(135deg, #fbbf24, #ff9500)'), padding: '10px' }}>Rescue Funds</button>
                  </div>
                </div>
              </>
            )}
            {!hasMintPermission && (
              <div style={{ ...cardStyle, gridColumn: '1 / -1', textAlign: 'center', padding: '40px' }}>
                <div style={{ color: 'var(--text-muted)' }}>You need MINTER or GUARDIAN role to access minting/burning controls.</div>
              </div>
            )}
          </div>
        )}

        {/* ALERTS TAB */}
        {activeTab === 'alerts' && (
          <div style={cardStyle}>
            <div style={{ ...cardHeaderStyle, justifyContent: 'space-between' }}>
              <div style={cardTitleStyle}>Alert Feed ({state.alerts.length})</div>
              <button onClick={acknowledgeAllAlerts} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer' }}>Acknowledge All</button>
            </div>
            <div style={{ padding: 0, maxHeight: '600px', overflowY: 'auto' }}>
              {state.alerts.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}>No alerts</div>}
              {state.alerts.map((alert) => (
                <div key={alert.id} style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)', background: alert.acknowledged ? 'transparent' : alertBg[alert.severity], display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: alertColors[alert.severity], boxShadow: `0 0 8px ${alertColors[alert.severity]}`, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: alertColors[alert.severity], marginBottom: '2px' }}>[{alert.type.toUpperCase()}]</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{alert.message}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginTop: '2px' }}>{formatTimeAgo(alert.timestamp)}</div>
                    </div>
                  </div>
                  {!alert.acknowledged && <button onClick={() => acknowledgeAlert(alert.id)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '6px', padding: '4px 10px', fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', flexShrink: 0 }}>Ack</button>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === 'history' && (
          <div style={cardStyle}>
            <div style={cardHeaderStyle}><div style={cardTitleStyle}>Transaction History</div></div>
            <div style={{ padding: 0, maxHeight: '600px', overflowY: 'auto' }}>
              {combinedHistory.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '13px' }}>No history</div>}
              {combinedHistory.map((tx) => (
                <div key={tx.id} style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: tx.type === 'mint' ? '#00ff88' : '#ef4444', boxShadow: `0 0 8px ${tx.type === 'mint' ? '#00ff88' : '#ef4444'}`, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: tx.type === 'mint' ? '#00ff88' : '#ef4444', fontFamily: "'JetBrains Mono', monospace" }}>{tx.type === 'mint' ? '+' : '-'}{formatNumber(tx.amount)} TFUSD</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>{tx.trigger} | {truncateAddress(tx.operator)} | Peg: ${tx.pegPriceAtExecution.toFixed(4)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", textAlign: 'right' }}>
                    {formatTimeAgo(tx.timestamp)}<br />
                    <span style={{ color: tx.status === 'confirmed' ? '#00ff88' : tx.status === 'pending' ? '#fbbf24' : '#ef4444' }}>{tx.status.toUpperCase()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
