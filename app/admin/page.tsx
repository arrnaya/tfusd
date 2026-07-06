'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthContext';
import { useAdmin } from '@/components/AdminContext';
import Header from '@/components/Header';
import { updateDAOParams, loadAdminState, saveAdminState } from '@/lib/admin-config';

export default function AdminPage() {
  const { isAuthenticated, user, logout } = useAuth();
  const { adminState, isAdmin, loading, error, shutdownDon, resumeDon, resetDons, setDon4Assets } = useAdmin();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [daoForm, setDaoForm] = useState(() => {
    const s = loadAdminState();
    return { ...s.daoParams };
  });

  const updateDaoParam = (key: string, value: any) => {
    setDaoForm((prev: any) => ({ ...prev, [key]: value }));
  };

  const saveDaoParams = () => {
    if (!adminState) return;
    const next = updateDAOParams(adminState, { ...daoForm });
    saveAdminState(next);
    window.dispatchEvent(new StorageEvent('storage'));
  };

  useEffect(() => {
    const timer = setTimeout(() => setChecked(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (checked && (!isAuthenticated || !isAdmin)) {
      router.replace('/login');
    }
  }, [checked, isAuthenticated, isAdmin, router]);

  if (!checked || !isAuthenticated || !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' }}>
          Checking admin access...
        </div>
      </div>
    );
  }

  const anyOffline = adminState
    ? Object.entries(adminState.dons).some(([_, state]) => !state.active)
    : false;

  async function handleShutdown(id: number) {
    await shutdownDon(id);
  }

  async function handleResume(id: number) {
    await resumeDon(id);
  }

  async function handleReset() {
    await resetDons();
  }

  async function handleShutdownAll() {
    await shutdownDon(1);
    await shutdownDon(2);
    await shutdownDon(3);
    await shutdownDon(4);
  }

  async function handleToggleAsset(asset: 'euro' | 'maal') {
    if (!adminState) return;
    const next = {
      euroEnabled: adminState.don4.euroEnabled,
      maalEnabled: adminState.don4.maalEnabled,
    };
    if (asset === 'euro') next.euroEnabled = !next.euroEnabled;
    if (asset === 'maal') next.maalEnabled = !next.maalEnabled;
    await setDon4Assets(next.euroEnabled, next.maalEnabled);
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <div style={styles.bgGrid} />
      <div style={styles.bgGlow} />

      <Header />

      <main style={{ maxWidth: '1600px', margin: '0 auto', padding: '20px', position: 'relative', zIndex: 10 }}>
        <div style={styles.pageHeader}>
          <div>
            <h1 style={styles.title}>DON Control Plane</h1>
            <p style={styles.subtitle}>Shutdown or resume individual DONs. All other DONs will enter sync-error state automatically.</p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleReset} disabled={loading} style={styles.resumeAllBtn}>Resume All</button>
            <button onClick={handleShutdownAll} disabled={loading} style={styles.shutdownAllBtn}>Emergency Shutdown All</button>
            <button onClick={logout} style={styles.logoutBtn}>Logout</button>
          </div>
        </div>

        {error && (
          <div style={styles.errorBanner}>
            ⚠ Admin API Error: {error}
          </div>
        )}

        <div style={styles.statusBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: anyOffline ? 'var(--danger)' : 'var(--success)',
                boxShadow: anyOffline ? '0 0 10px var(--danger)' : '0 0 10px var(--success)',
                animation: 'pulse 2s infinite',
              }}
            />
            <span style={{ color: anyOffline ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
              {anyOffline ? 'SYNC COMPROMISED' : 'ALL DONS OPERATIONAL'}
            </span>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace" }}>
            Last sync: {adminState?.updatedAt ? new Date(adminState.updatedAt).toLocaleTimeString() : '--'}
          </span>
        </div>

        <section style={styles.grid}>
          {[1, 2, 3, 4].map((id) => {
            const donState = adminState?.dons[id] || { active: true, error: null };
            const isDown = !donState.active;

            return (
              <div key={id} style={{ ...styles.card, borderColor: isDown ? 'rgba(239,68,68,0.4)' : 'var(--border-color)' }}>
                <div style={styles.cardHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ ...styles.donIcon, background: isDown ? 'var(--danger)' : gradients[id] }}>{id}</div>
                    <div>
                      <h3 style={styles.cardTitle}>DON-{id}</h3>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
                        {isDown ? 'OFFLINE' : donState.error ? 'SYNC ERROR' : 'OPERATIONAL'}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: isDown ? 'var(--danger)' : donState.error ? 'var(--warning)' : 'var(--success)',
                      boxShadow: isDown ? '0 0 8px var(--danger)' : donState.error ? '0 0 8px var(--warning)' : '0 0 8px var(--success)',
                    }}
                  />
                </div>

                <div style={styles.cardBody}>
                  {donState.error && !isDown && (
                    <div style={styles.cascadeError}>{donState.error}</div>
                  )}
                  {isDown && (
                    <div style={styles.offlineMessage}>This DON has been shut down by an admin. Its API calls are paused.</div>
                  )}
                </div>

                <div style={styles.cardFooter}>
                  {isDown ? (
                    <button onClick={() => handleResume(id)} disabled={loading} style={styles.resumeBtn}>Resume DON-{id}</button>
                  ) : (
                    <button onClick={() => handleShutdown(id)} disabled={loading} style={styles.shutdownBtn}>Shutdown DON-{id}</button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section style={styles.assetPanel}>
          <h2 style={styles.assetTitle}>DON-4 Asset Sources</h2>
          <div style={styles.assetGrid}>
            <label style={styles.assetToggle}>
              <input type="checkbox" checked={adminState?.don4.euroEnabled ?? true} onChange={() => handleToggleAsset('euro')} disabled={loading} />
              <span>EURO FIAT Assets</span>
            </label>
            <label style={styles.assetToggle}>
              <input type="checkbox" checked={adminState?.don4.maalEnabled ?? true} onChange={() => handleToggleAsset('maal')} disabled={loading} />
              <span>MAAL Digital Assets</span>
            </label>
          </div>
          <p style={styles.assetHint}>
            Current label: <strong style={{ color: 'var(--accent-cyan)' }}>
              {adminState?.don4.euroEnabled && adminState?.don4.maalEnabled ? 'Digital + FIAT Assets' : adminState?.don4.maalEnabled ? 'Digital Assets' : adminState?.don4.euroEnabled ? 'FIAT Assets' : 'Assets Display Disabled'}
            </strong>
          </p>
        </section>

        <section style={styles.assetPanel}>
          <h2 style={styles.assetTitle}>DAO Parameter Configuration</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            {[
              { key: 'depegThreshold', label: 'Depeg Threshold', type: 'number', step: 0.001 },
              { key: 'positiveDepegThreshold', label: 'Positive Depeg Threshold', type: 'number', step: 0.001 },
              { key: 'criticalDepegThreshold', label: 'Critical Depeg Threshold', type: 'number', step: 0.001 },
              { key: 'poolReplenishThreshold', label: 'Pool Replenish Threshold', type: 'number', step: 0.01 },
              { key: 'maxAutoMintAmount', label: 'Max Auto-Mint Amount', type: 'text' },
              { key: 'maxAutoBurnAmount', label: 'Max Auto-Burn Amount', type: 'text' },
              { key: 'mintPauseDurationMinutes', label: 'Mint Pause Duration (min)', type: 'number' },
              { key: 'guardianQuorum', label: 'Guardian Quorum', type: 'number' },
              { key: 'proposalTimelockHours', label: 'Proposal Timelock (hrs)', type: 'number' },
              { key: 'votingPeriodHours', label: 'Voting Period (hrs)', type: 'number' },
            ].map((field) => (
              <div key={field.key}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '6px', display: 'block' }}>{field.label}</label>
                <input
                  type={field.type}
                  step={field.step}
                  value={(daoForm as any)[field.key]}
                  onChange={(e) => updateDaoParam(field.key, field.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace", outline: 'none', width: '100%' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>Auto-Mint on Depeg</label>
              <button onClick={() => updateDaoParam('autoMintOnDepeg', !daoForm.autoMintOnDepeg)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: daoForm.autoMintOnDepeg ? 'rgba(0,255,136,0.1)' : 'transparent', color: daoForm.autoMintOnDepeg ? '#00ff88' : 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 }}>{daoForm.autoMintOnDepeg ? 'ON' : 'OFF'}</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>Auto-Burn on Positive Depeg</label>
              <button onClick={() => updateDaoParam('autoBurnOnPositiveDepeg', !daoForm.autoBurnOnPositiveDepeg)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: daoForm.autoBurnOnPositiveDepeg ? 'rgba(0,255,136,0.1)' : 'transparent', color: daoForm.autoBurnOnPositiveDepeg ? '#00ff88' : 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 }}>{daoForm.autoBurnOnPositiveDepeg ? 'ON' : 'OFF'}</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>Auto-Replenish Pool</label>
              <button onClick={() => updateDaoParam('autoReplenishPool', !daoForm.autoReplenishPool)} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: daoForm.autoReplenishPool ? 'rgba(0,255,136,0.1)' : 'transparent', color: daoForm.autoReplenishPool ? '#00ff88' : 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 }}>{daoForm.autoReplenishPool ? 'ON' : 'OFF'}</button>
            </div>
          </div>
          <button onClick={saveDaoParams} disabled={loading} style={{ background: 'var(--accent-cyan)', color: '#000', border: 'none', borderRadius: '8px', padding: '10px 24px', fontSize: '13px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer' }}>Save DAO Parameters</button>
        </section>
      </main>
    </div>
  );
}

const gradients: Record<number, string> = {
  1: 'linear-gradient(135deg, var(--accent-cyan), #0088ff)',
  2: 'linear-gradient(135deg, var(--accent-purple), #7c3aed)',
  3: 'linear-gradient(135deg, var(--accent-orange), #ff5500)',
  4: 'linear-gradient(135deg, var(--accent-green), #00aa66)',
};

const styles: Record<string, React.CSSProperties> = {
  bgGrid: {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    backgroundImage: 'linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px)',
    backgroundSize: '50px 50px', pointerEvents: 'none', zIndex: 0,
  },
  bgGlow: {
    position: 'fixed', top: '-50%', left: '-50%', width: '200%', height: '200%',
    background: 'radial-gradient(circle at 30% 30%, rgba(0, 212, 255, 0.05) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)',
    pointerEvents: 'none', zIndex: 0, animation: 'glowRotate 30s linear infinite',
  },
  pageHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px',
  },
  title: { fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' },
  subtitle: { fontSize: '13px', color: 'var(--text-muted)' },
  logoutBtn: { background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer' },
  resumeAllBtn: { background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--success)', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 },
  shutdownAllBtn: { background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger)', borderRadius: '6px', padding: '8px 16px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 },
  errorBanner: { background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger)', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', fontFamily: "'JetBrains Mono', monospace" },
  statusBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 20px', marginBottom: '20px', fontFamily: "'JetBrains Mono', monospace" },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  cardHeader: { padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255, 255, 255, 0.02)' },
  donIcon: { width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px', color: 'white' },
  cardTitle: { fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' },
  cardBody: { padding: '16px 20px', flex: 1 },
  cascadeError: { background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: 'var(--warning)', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace" },
  offlineMessage: { background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger)', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace" },
  cardFooter: { padding: '14px 20px', borderTop: '1px solid var(--border-color)' },
  resumeBtn: { width: '100%', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--success)', borderRadius: '8px', padding: '10px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 },
  shutdownBtn: { width: '100%', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger)', borderRadius: '8px', padding: '10px', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', fontWeight: 600 },
  assetPanel: { background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '20px', marginBottom: '24px' },
  assetTitle: { fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' },
  assetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' },
  assetToggle: { display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer' },
  assetHint: { marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" },
};
