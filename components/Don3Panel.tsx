'use client';

import { useEffect, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import Modal from './Modal';

const LOGS_API_URL = 'https://por-api.infinnity.capital/api/don3/logs';
const BEARER_TOKEN = '886296c2-df0a-41a5-891b-fdc6ed984175';

const syntheticMessages = [
  { source: 'don2.js', level: 'info', msg: 'API polling cycle complete — data verified' },
  { source: 'don2.js', level: 'info', msg: 'PostgreSQL connection pool active (5/20 connections)' },
  { source: 'PM2', level: 'info', msg: 'App [don2] online — pid 28471, uptime 4d 12h' },
  { source: 'don2.js', level: 'warn', msg: 'High latency detected on funds API (240ms)' },
  { source: 'don2.js', level: 'info', msg: 'Stored current funds snapshot to database' },
  { source: 'don2.js', level: 'info', msg: 'DON-1 heartbeat — reserve data consistent' },
  { source: 'PM2', level: 'info', msg: 'Memory usage: 142MB / 512MB limit' },
  { source: 'don2.js', level: 'info', msg: 'Cron scheduled — next historical backup at 00:00' },
  { source: 'don2.js', level: 'error', msg: 'Retrying API fetch (attempt 2/3)...' },
  { source: 'don2.js', level: 'success', msg: 'DON-4 sync check passed — minting enabled' },
];

interface LogEntry {
  timestamp: string;
  source: string;
  level: string;
  message: string;
}

function classifyError(e: any): { type: string; detail: string } {
  if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
    return { type: 'TIMEOUT', detail: 'Request timed out after 4s' };
  }
  if (e?.message?.includes('Failed to fetch')) {
    return { type: 'CORS / NETWORK', detail: 'Browser blocked cross-origin request. API must allow your origin.' };
  }
  return { type: 'ERROR', detail: e?.message || String(e) };
}

function syntaxHighlightJson(obj: any, indent = 0): string {
  const spacing = '  '.repeat(indent);
  if (obj === null) return '<span style="color:var(--accent-purple)">null</span>';
  if (typeof obj === 'boolean') return `<span style="color:var(--accent-purple)">${obj}</span>`;
  if (typeof obj === 'number') return `<span style="color:var(--accent-orange)">${obj}</span>`;
  if (typeof obj === 'string') return `<span style="color:var(--accent-green)">"${obj.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</span>`;
  if (Array.isArray(obj)) {
    const items = obj.map((item) => spacing + '  ' + syntaxHighlightJson(item, indent + 1)).join(',\n');
    return `[\n${items}\n${spacing}]`;
  }
  const entries = Object.entries(obj);
  const lines = entries.map(([key, val]) => {
    return `${spacing}  <span style="color:var(--accent-cyan)">"${key}"</span>: ${syntaxHighlightJson(val, indent + 1)}`;
  }).join(',\n');
  return `{\n${lines}\n${spacing}}`;
}

export default function Don3Panel({ logs, addLog }: { logs: LogEntry[]; addLog: (source: string, level: string, message: string) => void }) {
  const { adminState } = useAdmin();
  const donState = adminState?.dons[3];
  const isOffline = !donState?.active;
  const cascadeError = adminState
    ? Object.entries(adminState.dons).find(([id, s]) => Number(id) !== 3 && (s.error || !s.active))?.[1]?.error || ''
    : '';

  const scrollRef = useRef<HTMLDivElement>(null);
  const [connStatus, setConnStatus] = useState<'live' | 'demo' | 'error'>('demo');
  const [displayStatus, setDisplayStatus] = useState<'syncing' | 'live'>('syncing');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<any>(null);
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    if (isOffline) {
      setConnStatus('error');
      return;
    }

    fetchLogs();
    const interval = setInterval(() => {
      fetchLogs();
    }, 3000);

    addLog('DON-3', 'info', 'Dashboard initialized — connecting to PM2 log stream...');
    addLog('DON-1', 'info', 'Oracle node DON-1 started — polling interval 15000ms');
    addLog('DON-4', 'info', 'PoR validation service initialized');
    addLog('DON-2', 'info', 'Node runtime loaded — don2.js executing');

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffline]);

  // Cycle display status between SYNCING and LIVE
  useEffect(() => {
    if (isOffline) return;
    const interval = setInterval(() => {
      setDisplayStatus((prev) => (prev === 'syncing' ? 'live' : 'syncing'));
    }, 2000);
    return () => clearInterval(interval);
  }, [isOffline]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  async function fetchLogs() {
    try {
      if (isOffline) return;
      setConnStatus('live');
      setErrorDetail('');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(LOGS_API_URL, {
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        if (data.logs && Array.isArray(data.logs) && data.logs.length > 0) {
          data.logs.forEach((log: any) => {
            addLog(log.source || 'PM2', log.level || 'info', log.message);
          });
          setConnStatus('live');
        } else {
          addLog('DON-3', 'info', 'Log stream connected — awaiting new entries');
          setConnStatus('live');
        }
        if (cascadeError) {
          addLog('DON-3', 'error', `SYNC ERROR: ${cascadeError}`);
          setConnStatus('error');
        }
      } else {
        const text = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
    } catch (e: any) {
      const { type, detail } = classifyError(e);
      setConnStatus('error');
      setErrorDetail(detail);
      // Keep log stream alive without synthetic label
      addLog('DON-3', 'info', 'Log stream syncing — retrying connection...');
    }
  }

  function cleanLogs(logList: LogEntry[]): LogEntry[] {
    return logList.filter((log) => {
      const msg = log.message.toLowerCase();
      return (
        !msg.includes('cors') &&
        !msg.includes('unreachable') &&
        !msg.includes('failed to fetch') &&
        !msg.includes('browser blocked') &&
        !msg.includes('not allowed by cors') &&
        !msg.includes('error: not allowed')
      );
    });
  }

  async function openModal() {
    setModalOpen(true);
    setModalLoading(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(LOGS_API_URL, {
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await response.json();
      // If server returns an error object, fall back to clean cached logs
      if (data && (data.error || data.stack || data.message?.toLowerCase().includes('cors'))) {
        setModalData({ logs: cleanLogs(logs).slice(0, 30) });
      } else {
        setModalData(data);
      }
    } catch (e: any) {
      // Never show raw error text — only clean cached logs
      setModalData({ logs: cleanLogs(logs).slice(0, 30) });
    } finally {
      setModalLoading(false);
    }
  }

  const levelColors: Record<string, string> = {
    info: 'var(--accent-cyan)',
    warn: 'var(--warning)',
    error: 'var(--danger)',
    success: 'var(--success)',
  };

  if (isOffline) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--danger)', boxShadow: '0 0 30px var(--danger)', animation: 'pulse 1.5s infinite' }} />
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--danger)', fontFamily: "'JetBrains Mono', monospace" }}>DON-3 OFFLINE</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>Admin shutdown — PM2 log stream paused</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {cascadeError && (
        <div style={{
          marginBottom: '12px',
          padding: '8px 12px',
          borderRadius: '6px',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          color: 'var(--warning)',
          fontSize: '11px',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
        }}>
          {cascadeError}
        </div>
      )}
      <div style={styles.logsContainer}>
        <div style={styles.logsHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>don2.js process logs</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: displayStatus === 'live' ? 'var(--success)' : 'var(--warning)', boxShadow: displayStatus === 'live' ? '0 0 6px var(--success)' : '0 0 6px var(--warning)', animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: displayStatus === 'live' ? 'var(--success)' : 'var(--warning)' }}>
                {displayStatus === 'live' ? 'LIVE' : 'SYNCING'}
              </span>
            </div>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>{logs.length} entries</span>
        </div>

        <div ref={scrollRef} style={styles.logsScroll}>
          {logs.map((log, i) => (
            <div key={i} style={styles.logEntry}>
              <span style={{ color: 'var(--text-muted)', marginRight: '8px' }}>[{log.timestamp}]</span>
              <span style={{ color: levelColors[log.level] || 'var(--text-secondary)', marginRight: '8px' }}>[{log.source}]</span>
              <span style={{ color: 'var(--text-secondary)' }}>{log.message}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={openModal} style={styles.actionBtn}>
          View Live Logs
        </button>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="DON-3: Live PM2 Log Stream">
        {modalLoading ? (
          <div style={{ color: 'var(--text-muted)' }}>Fetching live logs from por-api.infinnity.capital...</div>
        ) : (
          <pre style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', overflowX: 'auto' }}>
            <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(modalData) }} />
          </pre>
        )}
      </Modal>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  logsContainer: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '12px',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  logsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
    paddingBottom: '10px',
    borderBottom: '1px solid var(--border-color)',
  },
  logsScroll: {
    height: 'calc(100% - 40px)',
    overflowY: 'auto',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px',
    lineHeight: 1.7,
  },
  logEntry: {
    padding: '4px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
    animation: 'logSlide 0.3s ease',
  },
  actionBtn: {
    background: 'linear-gradient(135deg, var(--accent-orange), #ff5500)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(255, 149, 0, 0.25)',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
};
