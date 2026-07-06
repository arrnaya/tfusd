'use client';

import { useEffect, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import BlackScreenMini from './BlackScreenMini';

const HEARTBEAT_INTERVAL = 15000;
const PDF_REVEAL_THRESHOLD = 10000;


export default function Don1Panel({
  onTimerChange,
}: {
  onTimerChange?: (timer: number, tick: number) => void;
}) {
  const { adminState } = useAdmin();
  const donState = adminState?.dons[1];
  const isOffline = !donState?.active;
  const cascadeError = adminState
    ? Object.entries(adminState.dons).find(([id, s]) => Number(id) !== 1 && (s.error || !s.active))?.[1]?.error || ''
    : '';

  const [captureTime, setCaptureTime] = useState<string>('');
  const [pulse, setPulse] = useState(false);
  const [cursorOn, setCursorOn] = useState(true);
  const [heartbeatTimer, setHeartbeatTimer] = useState(HEARTBEAT_INTERVAL);
  const [refreshTick, setRefreshTick] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOffline) return;

    const update = () => {
      const now = new Date();
      setCaptureTime(now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
      setPulse(true);
      setTimeout(() => setPulse(false), 800);
      setRefreshTick((t) => t + 1);
    };
    update();
    timerRef.current = window.setInterval(() => {
      setHeartbeatTimer((prev) => {
        if (prev <= 100) {
          update();
          return HEARTBEAT_INTERVAL;
        }
        return prev - 100;
      });
    }, 100);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isOffline]);

  useEffect(() => {
    if (onTimerChange) onTimerChange(heartbeatTimer, refreshTick);
  }, [heartbeatTimer, refreshTick, onTimerChange]);

  useEffect(() => {
    const blink = setInterval(() => setCursorOn((p) => !p), 530);
    return () => clearInterval(blink);
  }, []);

  const pct = ((HEARTBEAT_INTERVAL - heartbeatTimer) / HEARTBEAT_INTERVAL) * 100;
  const showPdf = heartbeatTimer <= PDF_REVEAL_THRESHOLD;

  if (isOffline) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
        <div style={{ ...styles.offlineDot, boxShadow: '0 0 30px var(--danger)' }} />
        <div style={styles.offlineTitle}>DON-1 OFFLINE</div>
        <div style={styles.offlineSub}>Admin shutdown — heartbeat and blackscreen feed paused</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {cascadeError && (
        <div style={styles.cascadeBanner}>{cascadeError}</div>
      )}
      <div style={styles.metaRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              ...styles.pulseDot,
              background: pulse ? 'var(--accent-cyan)' : 'var(--success)',
              boxShadow: pulse
                ? '0 0 14px var(--accent-cyan)'
                : '0 0 8px var(--success)',
            }}
          />
          <span style={styles.liveLabel}>IRON CODE: LIVE FEED</span>
        </div>
        <span style={styles.captureTime}>Captured: {captureTime}</span>
      </div>

      {/* Synced progress bar */}
      {/* <div style={{ marginBottom: '12px' }}>
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
          <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
            Next ping in {(heartbeatTimer / 1000).toFixed(1)}s
          </span>
          <span style={{ color: 'var(--text-muted)' }}>Refresh: 15s</span>
        </div>
      </div> */}

      <div style={styles.splitContainer}>
        {/* Upper: PDF (revealed only when progress bar ends) */}
        <div style={styles.pdfSection}>
          {showPdf ? (
            <>
              <div style={styles.pdfOverlay}>
                <span style={styles.pdfLabel}>Blackscreen Feed</span>
              </div>
              <embed
                src="/500M.pdf"
                type="application/pdf"
                style={styles.iframe}
                title="500M PDF Snapshot"
              />
            </>
          ) : (
            <div style={styles.processingPlaceholder}>
              <div style={styles.processingText}>
                <span style={{ color: '#00ff88' }}>▸</span> AWAITING BLACKSCREEN SNAPSHOT...
              </div>
              <div style={styles.processingSub}>
                Processing DEUTSCHE BANK secure stream
              </div>
              <div style={styles.processingBarTrack}>
                <div
                  style={{
                    ...styles.processingBarFill,
                    width: `${pct}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Lower: Blackscreen (only when PDF is revealed) */}
        <div style={styles.blackscreenSection}>
          {showPdf ? (
            <BlackScreenMini />
          ) : (
            <div style={styles.waitingPlaceholder}>
              <div style={styles.scanline} />
              <div style={styles.glow} />
              <div style={styles.waitingText}>
                <span style={{ color: '#00ff88' }}>⏵</span> STANDBY_MODE
                <span style={{ ...styles.cursor, opacity: cursorOn ? 1 : 0 }}>█</span>
              </div>
              <div style={styles.waitingSub}>
                Awaiting secure blackscreen snapshot...
              </div>
              <div style={styles.waitingStatus}>
                [ {heartbeatTimer > PDF_REVEAL_THRESHOLD ? 'IDLE' : 'ACTIVE'} ]  SESSION: {Math.random().toString(36).substring(2, 8).toUpperCase()}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={styles.footerRow}>
        <span style={styles.footerItem}>Source: DTC server fetch</span>
        <span style={styles.footerItem}>Refresh: 15s</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
    flexWrap: 'wrap',
    gap: '8px',
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    transition: 'background 0.3s, box-shadow 0.3s',
  },
  liveLabel: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent-cyan)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.05em',
  },
  captureTime: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  splitContainer: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    gap: '0',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  pdfSection: {
    position: 'relative',
    height: '55%',
    minHeight: 0,
    borderBottom: '1px solid var(--border-color)',
    background: '#000',
  },
  blackscreenSection: {
    height: '45%',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  pdfOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    padding: '8px 12px',
    background: 'linear-gradient(to bottom, rgba(10,14,23,0.9), transparent)',
    display: 'flex',
    alignItems: 'center',
  },
  pdfLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    background: '#000',
  },
  processingPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    background: '#000',
    fontFamily: "'JetBrains Mono', monospace",
  },
  processingText: {
    fontSize: '12px',
    color: '#00ff88',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textShadow: '0 0 8px rgba(0, 255, 136, 0.4)',
  },
  processingSub: {
    fontSize: '10px',
    color: '#3f6212',
  },
  processingBarTrack: {
    width: '60%',
    height: '4px',
    background: 'rgba(0, 255, 136, 0.1)',
    borderRadius: '2px',
    marginTop: '6px',
    overflow: 'hidden',
  },
  processingBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #00ff88, #00d4ff)',
    borderRadius: '2px',
    transition: 'width 0.1s linear',
  },
  waitingPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    background: '#000',
    fontFamily: "'JetBrains Mono', monospace",
    position: 'relative',
    overflow: 'hidden',
  },
  scanline: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15), rgba(0,0,0,0.15) 1px, transparent 1px, transparent 2px)',
    pointerEvents: 'none',
    zIndex: 5,
  },
  glow: {
    position: 'absolute',
    top: '-30%',
    left: '-30%',
    width: '160%',
    height: '160%',
    background: 'radial-gradient(circle at 50% 50%, rgba(0, 255, 136, 0.04) 0%, transparent 60%)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  waitingText: {
    fontSize: '13px',
    color: '#00ff88',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textShadow: '0 0 12px rgba(0, 255, 136, 0.6), 0 0 4px rgba(0, 255, 136, 0.3)',
    zIndex: 2,
  },
  cursor: {
    color: '#00ff88',
    textShadow: '0 0 8px rgba(0, 255, 136, 0.8)',
    marginLeft: '4px',
  },
  waitingSub: {
    fontSize: '10px',
    color: '#00d4ff',
    letterSpacing: '0.08em',
    textShadow: '0 0 8px rgba(0, 212, 255, 0.4)',
    zIndex: 2,
  },
  waitingStatus: {
    fontSize: '9px',
    color: '#3f6212',
    letterSpacing: '0.06em',
    marginTop: '4px',
    zIndex: 2,
  },
  footerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '12px',
    flexWrap: 'wrap',
    gap: '8px',
  },
  footerItem: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  cascadeBanner: {
    marginBottom: '12px',
    padding: '8px 12px',
    borderRadius: '6px',
    background: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    color: 'var(--warning)',
    fontSize: '11px',
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 600,
  },
  offlineDot: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: 'var(--danger)',
    animation: 'pulse 1.5s infinite',
  },
  offlineTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--danger)',
    fontFamily: "'JetBrains Mono', monospace",
  },
  offlineSub: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: 'center',
  },
};
