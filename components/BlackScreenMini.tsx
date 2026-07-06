'use client';

import { useEffect, useRef, useState } from 'react';
import { getFallbackMaskedData, parseBlackScreenXml, type MaskedBlackScreenData } from '@/lib/blackscreen-parser';

function buildTerminalLines(data: MaskedBlackScreenData): { text: string; color?: string; bold?: boolean }[] {
  const lines: { text: string; color?: string; bold?: boolean }[] = [];
  
  lines.push({ text: 'DEUTSCHE BANK AG — SECURE TERMINAL SESSION', color: '#00ff88', bold: true });
  lines.push({ text: '' });
  lines.push({ text: '--- META ---', color: '#00d4ff' });
  lines.push({ text: `NETWORK:         ${data.meta.network}` });
  lines.push({ text: `PRINTED DATE:    ${data.meta.printedDate}` });
  lines.push({ text: `PRINTER:         ${data.meta.printerLabel}` });
  lines.push({ text: `DOCUMENT REF:    ${data.meta.documentRef}` });
  lines.push({ text: '' });
  lines.push({ text: '--- MESSAGE HEADER ---', color: '#00d4ff' });
  lines.push({ text: `FUNDS TYPE:           ${data.messageHeader.fundsType}` });
  lines.push({ text: `UPLOAD FORMAT:        ${data.messageHeader.uploadFormat}` });
  lines.push({ text: `FILE FORMAT:          ${data.messageHeader.fileFormat}` });
  lines.push({ text: `ENCODING:             ${data.messageHeader.encoding}` });
  lines.push({ text: `CURRENCY:             ${data.messageHeader.currency}` });
  lines.push({ text: `AMOUNT:               ${data.messageHeader.amount}`, color: '#00ff88', bold: true });
  lines.push({ text: `DATE:                 ${data.messageHeader.date}` });
  lines.push({ text: '' });
  lines.push({ text: '--- TRANSACTION CODES ---', color: '#00d4ff' });
  Object.entries(data.transactionCodes).forEach(([key, val]) => {
    lines.push({ text: `${key.toUpperCase().replace(/([A-Z])([A-Z]+)/g, '$1$2').padEnd(25)} ${val}` });
  });
  lines.push({ text: '' });
  lines.push({ text: '--- SERVER INFO ---', color: '#00d4ff' });
  Object.entries(data.serverInfo).forEach(([key, val]) => {
    lines.push({ text: `${key.replace(/([A-Z])/g, ' $1').toUpperCase().trim().padEnd(25)} ${val}` });
  });
  lines.push({ text: '' });
  lines.push({ text: '--- FARM AND USER ---', color: '#00d4ff' });
  Object.entries(data.farmAndUser).forEach(([key, val]) => {
    lines.push({ text: `${key.replace(/([A-Z])/g, ' $1').toUpperCase().trim().padEnd(25)} ${val}` });
  });
  lines.push({ text: '' });
  lines.push({ text: '--- TRANSACTION IDENTIFIERS ---', color: '#00d4ff' });
  Object.entries(data.transactionIdentifiers).forEach(([key, val]) => {
    lines.push({ text: `${key.replace(/([A-Z])/g, ' $1').toUpperCase().trim().padEnd(25)} ${val}` });
  });
  lines.push({ text: '' });
  lines.push({ text: '--- SENDER / ORDERING CUSTOMER ---', color: '#00d4ff' });
  Object.entries(data.senderOrderingCustomer).forEach(([key, val]) => {
    lines.push({ text: `${key.replace(/([A-Z])/g, ' $1').toUpperCase().trim().padEnd(25)} ${val}` });
  });
  lines.push({ text: '' });
  lines.push({ text: '--- UPLOAD STATUS ---', color: '#00d4ff' });
  lines.push({ text: `STATUS:          ${data.uploadStatus.status}`, color: '#00ff88', bold: true });
  lines.push({ text: `AMOUNT:          ${data.uploadStatus.amount}`, color: '#00ff88', bold: true });
  lines.push({ text: `IP/IP VERSION:   ${data.uploadStatus.ipipVersion}` });
  lines.push({ text: '' });
  lines.push({ text: 'PROGRESS:', color: '#00d4ff' });
  data.uploadStatus.progress.forEach((p) => {
    const bar = '▓'.repeat(Math.round(p.percent / 5)) + '░'.repeat(20 - Math.round(p.percent / 5));
    lines.push({ text: `  [${p.percent.toString().padStart(3)}%] ${p.step.padEnd(6)} ${bar}` });
  });
  lines.push({ text: '' });
  lines.push({ text: `ACCESS GRANTED:  ${data.uploadStatus.accessGranted}`, color: '#00ff88' });
  lines.push({ text: '' });
  lines.push({ text: '--- LICENSE ACTIVATIONS ---', color: '#00d4ff' });
  data.licenseActivations.forEach((lic) => {
    lines.push({ text: `  [${lic.id}] ${lic.text}` });
  });
  lines.push({ text: '' });
  lines.push({ text: '--- HARDWARE VERSIONS ---', color: '#00d4ff' });
  Object.entries(data.hardwareVersions).forEach(([key, val]) => {
    lines.push({ text: `${key.replace(/([A-Z])/g, ' $1').toUpperCase().trim().padEnd(25)} ${val}` });
  });
  lines.push({ text: '' });
  lines.push({ text: '--- CERTIFICATE CHAIN ---', color: '#00d4ff' });
  lines.push({ text: `  ${data.certificateChain.beginCertificate}` });
  lines.push({ text: `  ${data.certificateChain.certificateData}` });
  lines.push({ text: `  ${data.certificateChain.endCertificate}` });
  lines.push({ text: '' });
  lines.push({ text: '--- COMPLETION ---', color: '#00d4ff' });
  lines.push({ text: `ACCESS STATUS:      ${data.completion.accessStatus}`, color: '#00ff88', bold: true });
  lines.push({ text: `PROGRESS COMPLETED: ${data.completion.progressCompleted}`, color: '#00ff88', bold: true });
  lines.push({ text: '' });
  lines.push({ text: `END OF MESSAGE  |  DATE: ${data.footer.date}  |  TIME: ${data.footer.time}`, color: '#00ff88' });
  
  return lines;
}

export default function BlackScreenMini() {
  const [data, setData] = useState<MaskedBlackScreenData | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    async function fetchAndParse() {
      try {
        const res = await fetch('/blackScreen.xml');
        if (res.ok) {
          const xmlText = await res.text();
          const parsed = parseBlackScreenXml(xmlText);
          if (parsed) {
            setData(parsed);
          } else {
            setData(getFallbackMaskedData());
          }
        } else {
          setData(getFallbackMaskedData());
        }
      } catch {
        setData(getFallbackMaskedData());
      } finally {
        setLoading(false);
      }
    }
    fetchAndParse();
  }, []);

  const lines = data ? buildTerminalLines(data) : [];

  useEffect(() => {
    if (loading || !data) return;
    let current = 0;
    timeoutsRef.current = [];

    const scheduleNext = () => {
      if (current >= lines.length) return;
      const t = window.setTimeout(() => {
        setVisibleCount((prev) => prev + 1);
        current++;
        scheduleNext();
      }, 80);
      timeoutsRef.current.push(t);
    };

    scheduleNext();

    const cursorInterval = window.setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      clearInterval(cursorInterval);
    };
  }, [loading, data, lines.length]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleCount]);

  if (loading) {
    return (
      <div style={styles.wrap}>
        <div style={styles.scanline} />
        <div style={styles.glow} />
        <div style={styles.terminal}>
          <div style={{ ...styles.line, color: '#00ff88' }}>▸ LOADING BLACKSCREEN DATA...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.scanline} />
      <div style={styles.glow} />
      <div ref={containerRef} style={styles.terminal}>
        {lines.slice(0, visibleCount).map((line, i) => (
          <div
            key={i}
            style={{
              ...styles.line,
              color: line.color || '#a3e635',
              fontWeight: line.bold ? 700 : 400,
              textShadow: line.bold ? '0 0 8px rgba(0, 255, 136, 0.5)' : '0 0 4px rgba(0, 255, 136, 0.4)',
            }}
          >
            {line.text}
          </div>
        ))}
        <div style={styles.line}>
          <span style={{ ...styles.cursor, opacity: showCursor ? 1 : 0 }}>█</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'relative',
    background: '#000000',
    borderRadius: '0 0 10px 10px',
    overflow: 'hidden',
    height: '100%',
    fontFamily: "'JetBrains Mono', monospace",
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
  terminal: {
    position: 'relative',
    zIndex: 2,
    padding: '10px 12px',
    overflowY: 'auto',
    height: '100%',
    fontSize: '10px',
    lineHeight: 1.6,
  },
  line: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  cursor: {
    color: '#00ff88',
    textShadow: '0 0 8px rgba(0, 255, 136, 0.8)',
  },
};
