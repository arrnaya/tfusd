'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthContext';
import { useAdmin } from '@/components/AdminContext';
import Header from '@/components/Header';
import DonCard from '@/components/DonCard';
import Don1Panel from '@/components/Don1Panel';
import Don2Panel from '@/components/Don2Panel';
import Don3Panel from '@/components/Don3Panel';
import Don4Panel from '@/components/Don4Panel';

interface LogEntry {
  timestamp: string;
  source: string;
  level: string;
  message: string;
}

export default function Home() {
  const { isAuthenticated, user, logout, stage } = useAuth();
  const { adminState } = useAdmin();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [heartbeatTimer, setHeartbeatTimer] = useState(15000);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // Wait for auth hydration before deciding redirect
    const timer = setTimeout(() => setChecked(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (checked && !isAuthenticated && stage === 'idle') {
      router.replace('/login');
    }
  }, [checked, isAuthenticated, stage, router]);

  const addLog = useCallback((source: string, level: string, message: string) => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    setLogs((prev) => {
      const next = [{ timestamp, source, level, message }, ...prev];
      return next.slice(0, 100);
    });
  }, []);

  const handleTimerChange = useCallback((timer: number, tick: number) => {
    setHeartbeatTimer(timer);
    setRefreshTick(tick);
  }, []);

  const HEARTBEAT_INTERVAL = 15000;
  const pct = ((HEARTBEAT_INTERVAL - heartbeatTimer) / HEARTBEAT_INTERVAL) * 100;

  function getStageText(timer: number): { text: string; color: string } {
    if (timer > 10000) return { text: '▸ FETCHING SECURE BLACKSCREEN SNAPSHOT...', color: 'var(--accent-cyan)' };
    if (timer > 4000)  return { text: '▸ DECRYPTING SWIFT CRYPTOHOST M1 FIN PAYLOAD...', color: 'var(--accent-purple)' };
    if (timer > 1000)  return { text: '▸ VERIFYING DTC ORACLE NODE SIGNATURE...', color: 'var(--accent-orange, #f97316)' };
    return { text: '▸ SYNCHRONIZING — SNAPSHOT INCOMING', color: 'var(--success)' };
  }
  const progressStage = getStageText(heartbeatTimer);

  const offlineDonId = adminState
    ? Number(Object.entries(adminState.dons).find(([_, s]) => !s.active)?.[0] || 0)
    : 0;
  const cascadeError = adminState && !offlineDonId
    ? Object.entries(adminState.dons).find(([_, s]) => s.error)?.[1]?.error || ''
    : '';
  const syncBroken = offlineDonId > 0 || !!cascadeError;

  if (!checked || (!isAuthenticated && stage === 'idle')) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' }}>
          Authenticating...
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* Background effects */}
      <div style={styles.bgGrid} />
      <div style={styles.bgGlow} />

      <Header />

      {user && (
        <div style={styles.userBar}>
          <div style={styles.userInfo}>
            <span style={styles.userName}>{user.name}</span>
            <span style={styles.userEmail}>{user.email}</span>
          </div>
          <button onClick={logout} style={styles.logoutBtn}>
            Logout
          </button>
        </div>
      )}

      <main style={{ maxWidth: '1600px', margin: '0 auto', }}>
        <div style={{ padding: '20px', paddingBottom: 0 }}>
          {syncBroken && (
            <div
              style={{
                marginBottom: '12px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--danger)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>⚠</span>
              <span>
                {offlineDonId > 0
                  ? `DON-${offlineDonId} OFFLINE — SYNC COMPROMISED`
                  : cascadeError}
              </span>
            </div>
          )}
          <div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
              <div
                key={refreshTick}
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-purple))',
                  borderRadius: '3px',
                  transition: 'width 0.1s linear',
                  boxShadow: '0 0 10px rgba(0, 212, 255, 0.5)',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px' }}>
              <span style={{ color: progressStage.color, fontWeight: 600 }}>
                {progressStage.text}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>Next ping in {(heartbeatTimer / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>

        <section style={styles.dashboard}>
          <DonCard number={1} title="DON-1: DEUTSCHE BANK Blackscreen" subtitle="Oracle Node — 15s Polling" badge="● Live" badgeClass="live">
            <Don1Panel onTimerChange={handleTimerChange} />
          </DonCard>

          <DonCard number={2} title="DON-2: Oracle Data Fetcher" subtitle="Funds API Poller — Auto Refresh" badge="⟳ Refresh" badgeClass="code">
            <Don2Panel onLog={addLog} onTimerChange={handleTimerChange} />
          </DonCard>

          <DonCard number={3} title="DON-3: Process Monitor" subtitle="PM2 Log Stream" badge="📋 Logs" badgeClass="logs" bodyHeight="600px">
            <Don3Panel logs={logs} addLog={addLog} />
          </DonCard>

          <DonCard number={4} title="DON-4: PoR & Minting Sync" subtitle="Proof of Reserves Validation" badge="🔄 Sync" badgeClass="sync" bodyHeight="600px">
            <Don4Panel onLog={addLog} />
          </DonCard>
        </section>
      </main>

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
  userBar: {
    position: 'relative',
    zIndex: 10,
    maxWidth: '1600px',
    margin: '0 auto',
    padding: '12px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--border-color)',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  userName: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  userEmail: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid var(--border-color)',
    color: 'var(--text-muted)',
    borderRadius: '6px',
    padding: '6px 14px',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  dashboard: {
    position: 'relative',
    zIndex: 10,
    padding: '20px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: 'auto auto',
    gap: '20px',
    maxWidth: '1600px',
    margin: '0 auto',
  }
};
