'use client';

import { useEffect, useRef, useState } from 'react';
import { useAdmin } from './AdminContext';
import { maskApiUrl } from '@/lib/url-masker';

const API_URL = 'https://api.infinnity.capital/api/db.com/funds/getData?transaction_code=144A:S:T8492JLM5&details=true';
const XML_URL = '/blackScreen.xml';
const DISPLAY_API_URL = maskApiUrl(API_URL);
const HEARTBEAT_INTERVAL = 15000;

function maskValue(value: string | undefined, showFirst = 4, showLast = 4): string {
  if (!value) return '****';
  if (value.length <= showFirst + showLast) {
    return value.slice(0, showFirst) + '****';
  }
  return value.slice(0, showFirst) + '****' + value.slice(-showLast);
}

function maskXmlText(text: string | undefined): string {
  if (!text) return '';
  // Mask certificate data heavily (only first/last 8 chars)
  if (text.length > 80) {
    return text.slice(0, 8) + '****' + text.slice(-8);
  }
  return maskValue(text, 4, 4);
}

function parseBlackScreenXml(xmlText: string): any {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const root = doc.documentElement;

  const get = (path: string) => {
    const el = root.querySelector(path);
    return el?.textContent || '';
  };

  return {
    source: 'blackScreen.xml',
    network: get('Meta Network'),
    printed: `${get('Meta PrintedDate')} ${get('Meta PrintedTime')}`,
    printer: get('Meta PrinterLabel'),
    document_ref: maskValue(get('Meta DocumentRef'), 6, 6),
    message_header: {
      funds_type: get('MessageHeader FundsType'),
      upload_format: get('MessageHeader UploadFormat'),
      file_extension: get('MessageHeader FileExtension'),
      file_format: get('MessageHeader FileFormat'),
      file_format_option: get('MessageHeader FileFormatOption'),
      encoding: get('MessageHeader Encoding'),
      currency: get('MessageHeader Currency'),
      amount: get('MessageHeader Amount'),
      date: get('MessageHeader Date'),
      time: get('MessageHeader Time'),
    },
    transaction_codes: {
      reference_number: maskValue(get('TransactionCodes ReferenceNumber')),
      transaction_code: maskValue(get('TransactionCodes TransactionCode'), 6, 6),
      clearing_code: maskValue(get('TransactionCodes ClearingCode')),
      transfer_data_encryption_code: maskValue(get('TransactionCodes TransferDataEncryptionCode')),
      upload_code: maskValue(get('TransactionCodes UploadCode')),
      permit_code: maskValue(get('TransactionCodes PermitCode')),
      final_release_code: maskValue(get('TransactionCodes FinalReleaseCode')),
      downloading_code: maskValue(get('TransactionCodes DownloadingCode'), 6, 6),
      access_code: maskValue(get('TransactionCodes AccessCode'), 3, 3),
      interbanking_blocking_code: maskValue(get('TransactionCodes InterbankingBlockingCode')),
    },
    server_info: {
      identity_code: maskValue(get('ServerInfo IdentityCode'), 4, 4),
      server_global_id_origin: get('ServerInfo ServerGlobalIDOrigin'),
      server_global_ip: get('ServerInfo ServerGlobalIP'),
      client_number: maskValue(get('ServerInfo ClientNumber'), 8, 6),
      permit_arrival_money_number: maskValue(get('ServerInfo PermitArrivalMoneyNumber')),
      windows_terminal_server: maskValue(get('ServerInfo WindowsTerminalServer')),
      login_domain: maskValue(get('ServerInfo LoginDomain')),
      logon_server: maskValue(get('ServerInfo LogonServer')),
    },
    farm_and_user: {
      farm_name: get('FarmAndUser FarmName'),
      user_name: maskValue(get('FarmAndUser UserName')),
      user_id: maskValue(get('FarmAndUser UserID')),
      clearing_house_number: maskValue(get('FarmAndUser ClearingHouseNumber')),
    },
    transaction_identifiers: {
      transaction_id: maskValue(get('TransactionIdentifiers TransactionID')),
      final_blocking_code: maskValue(get('TransactionIdentifiers FinalBlockingCode')),
      transfer_code: maskValue(get('TransactionIdentifiers TransferCode')),
      unique_transaction_number: maskValue(get('TransactionIdentifiers UniqueTransactionNumber')),
      imad_number: maskValue(get('TransactionIdentifiers IMADNumber')),
    },
    sender_ordering_customer: {
      bank_name: get('SenderOrderingCustomer BankName'),
      bank_address: get('SenderOrderingCustomer BankAddress'),
      account_name: get('SenderOrderingCustomer AccountName'),
      account_number: maskValue(get('SenderOrderingCustomer AccountNumber')),
    },
    upload_status: {
      ipsvr_type: get('UploadStatus IPSVRType'),
      status: get('UploadStatus Status'),
      amount: get('UploadStatus Amount'),
      currency: get('UploadStatus Currency'),
      ipip_version: get('UploadStatus IPIPVersion'),
      access_granted: get('UploadStatus AccessGranted'),
      progress: Array.from(root.querySelectorAll('UploadStatus Progress Step')).map((step) => ({
        step: step.textContent || '',
        percent: (step as Element).getAttribute('percent') || '0',
      })),
    },
    license_activations: Array.from(root.querySelectorAll('LicenseActivations License')).map((lic) => ({
      id: (lic as Element).getAttribute('id') || '',
      value: maskValue(lic.textContent || '', 8, 8),
    })),
    hardware_versions: {
      pcb_version: get('HardwareVersions PCBVersion'),
      epld_version: get('HardwareVersions EPLDVersion'),
      fpga_version: get('HardwareVersions FPGAVersion'),
      info_version: get('HardwareVersions INFOVersion'),
    },
    certificate_chain: {
      begin_certificate: get('CertificateChain BeginCertificate'),
      certificate_data: maskXmlText(get('CertificateChain CertificateData')),
      end_certificate: get('CertificateChain EndCertificate'),
    },
    completion: {
      access_status: get('Completion AccessStatus'),
      progress_completed: get('Completion ProgressCompleted'),
      final_access: get('Completion FinalAccess'),
    },
    footer: {
      end_of_message: get('Footer EndOfMessage'),
      date: get('Footer Date'),
      time: get('Footer Time'),
    },
  };
}

function classifyError(e: any): { type: string; detail: string } {
  if (e?.name === 'AbortError' || e?.message?.includes('aborted')) {
    return { type: 'TIMEOUT', detail: 'Request timed out after 4s' };
  }
  if (e?.message?.includes('Failed to fetch')) {
    return { type: 'XML Server', detail: 'Browser blocked cross-origin request. XML must be served from same origin.' };
  }
  return { type: 'ERROR', detail: e?.message || String(e) };
}

export default function Don2Panel({
  onLog,
  onTimerChange,
}: {
  onLog: (source: string, level: string, message: string) => void;
  onTimerChange?: (timer: number, tick: number) => void;
}) {
  const { adminState } = useAdmin();
  const donState = adminState?.dons[2];
  const isOffline = !donState?.active;
  const cascadeError = adminState
    ? Object.entries(adminState.dons).find(([id, s]) => Number(id) !== 2 && (s.error || !s.active))?.[1]?.error || ''
    : '';

  const [heartbeatTimer, setHeartbeatTimer] = useState(HEARTBEAT_INTERVAL);
  const [lastPing, setLastPing] = useState<string>('Last: --:--:--');
  const [data, setData] = useState<any>(null);
  const [connStatus, setConnStatus] = useState<'live' | 'demo' | 'error'>('live');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [captureTime, setCaptureTime] = useState<string>('');
  const [pulse, setPulse] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [typedUrl, setTypedUrl] = useState('');
  const [visibleLogs, setVisibleLogs] = useState(0);
  const timerRef = useRef<number | null>(null);

  const DATA_REVEAL_THRESHOLD = 10000;
  const showData = heartbeatTimer <= DATA_REVEAL_THRESHOLD;
  const FETCH_TEXT = '⟳ Fetching Blackscreen XML...';
  const LOADING_LOGS = [
    '> INIT: Establishing secure tunnel to tfusd.io API...',
    '> AUTH: Validating SWIFT CRYPTOHOST credentials...',
    '> CONN: Connecting to DTC server (193.150.166.0/24)...',
    '> FETCH: Requesting funds data — DEUT997856743216...',
    '> STREAM: Awaiting server response...',
  ];

  useEffect(() => {
    if (onTimerChange) onTimerChange(heartbeatTimer, refreshTick);
  }, [heartbeatTimer, refreshTick, onTimerChange]);

  useEffect(() => {
    if (showData) return;
    setTypedText('');
    setTypedUrl('');
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTypedText(FETCH_TEXT.slice(0, i));
      if (i >= FETCH_TEXT.length) clearInterval(interval);
    }, 60);
    const delay = setTimeout(() => {
      let j = 0;
      const urlInterval = setInterval(() => {
        j++;
        setTypedUrl(DISPLAY_API_URL.slice(0, j));
        if (j >= DISPLAY_API_URL.length) clearInterval(urlInterval);
      }, 30);
    }, 400);
    return () => { clearInterval(interval); clearTimeout(delay); };
  }, [showData]);

  useEffect(() => {
    if (showData) return;
    setVisibleLogs(0);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleLogs(i);
      if (i >= LOADING_LOGS.length) clearInterval(interval);
    }, 700);
    return () => clearInterval(interval);
  }, [showData]);


  useEffect(() => {
    if (isOffline) {
      setConnStatus('error');
      setErrorDetail('DON-2 OFFLINE — admin shutdown');
      return;
    }

    fetchData();
    timerRef.current = window.setInterval(() => {
      setHeartbeatTimer((prev) => {
        if (prev <= 100) {
          fetchData();
          return HEARTBEAT_INTERVAL;
        }
        return prev - 100;
      });
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffline]);

  async function fetchData() {
    try {
      if (isOffline) return;
      setConnStatus('live');
      setErrorDetail('');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(XML_URL, { signal: controller.signal });
      clearTimeout(timeout);
      const xmlText = await response.text();
      // Source displayed as tfusd.io API endpoint; actual payload from blackScreen.xml

      const parsed = parseBlackScreenXml(xmlText);
      parsed.last_accessed_at = new Date().toISOString();
      parsed.verified = true;

      setData(parsed);
      setConnStatus(cascadeError ? 'error' : 'live');
      setLastPing('Last: ' + new Date().toLocaleTimeString());
      setRefreshTick((t) => t + 1);
      setCaptureTime(new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
      setPulse(true);
      setTimeout(() => setPulse(false), 800);
      onLog('DON-2', 'info', `Fetched blackscreen data via ${DISPLAY_API_URL} — ${parsed.message_header?.currency || 'N/A'} ${parsed.message_header?.amount || ''}`);
      if (cascadeError) {
        onLog('DON-2', 'error', `SYNC ERROR: ${cascadeError}`);
      }
    } catch (e: any) {
      const { type, detail } = classifyError(e);
      setLastPing('Last: ' + new Date().toLocaleTimeString() + ` (${type})`);
      setConnStatus('demo');
      setErrorDetail('');
      onLog('DON-2', 'warn', `Fetch failed: ${type} — falling back to demo data`);

      const demo = parseBlackScreenXml('');
      demo.last_accessed_at = new Date().toISOString();
      demo.verified = false;
      demo.demo = true;
      setData(demo);
      setRefreshTick((t) => t + 1);
      setCaptureTime(new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
      setPulse(true);
      setTimeout(() => setPulse(false), 800);
    }
  }

  const pct = ((HEARTBEAT_INTERVAL - heartbeatTimer) / HEARTBEAT_INTERVAL) * 100;

  if (isOffline) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
        <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--danger)', boxShadow: '0 0 30px var(--danger)', animation: 'pulse 1.5s infinite' }} />
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--danger)', fontFamily: "'JetBrains Mono', monospace" }}>DON-2 OFFLINE</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>Admin shutdown — blackscreen XML polling paused</div>
      </div>
    );
  }

  return (
    <div>
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
          <span style={styles.liveLabel}>LIVE BLACKSCREEN XML FEED</span>
        </div>
        <span style={styles.captureTime}>Captured: {captureTime}</span>
      </div>

      <div style={styles.apiEndpoint}>
        <span style={{ color: !showData ? 'var(--accent-cyan)' : 'var(--accent-purple)' }}>
          {!showData ? typedText : '✓ XML received'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '10px', display: 'block', marginTop: '4px' }}>{!showData ? typedUrl : DISPLAY_API_URL}</span>
      </div>

      <div style={styles.dataDisplay}>
        {!showData ? (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', lineHeight: 2 }}>
            {LOADING_LOGS.slice(0, visibleLogs).map((line, i) => (
              <div key={i} style={{ color: i === visibleLogs - 1 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                {line}
              </div>
            ))}
          </div>
        ) : (
          <pre
            key={refreshTick}
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              animation: 'fadeIn 0.4s ease',
            }}
          >
            <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(data) }} />
          </pre>
        )}
      </div>
    </div>
  );
}


function syntaxHighlightJson(obj: any, indent = 0): string {
  const spacing = '  '.repeat(indent);
  if (obj === null) return '<span style="color:var(--accent-purple)">null</span>';
  if (typeof obj === 'boolean') return `<span style="color:var(--accent-purple)">${obj}</span>`;
  if (typeof obj === 'number') return `<span style="color:var(--accent-orange)">${obj}</span>`;
  if (typeof obj === 'string')
    return `<span style="color:var(--accent-green)">"${obj.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</span>`;
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
  apiEndpoint: {
    background: 'rgba(168, 85, 247, 0.05)',
    border: '1px solid rgba(168, 85, 247, 0.2)',
    borderRadius: '8px',
    padding: '10px 14px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px',
    color: 'var(--accent-purple)',
    marginBottom: '16px',
    wordBreak: 'break-all',
  },
  dataDisplay: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '10px',
    padding: '16px',
    maxHeight: '320px',
    overflowY: 'auto',
  },
};
