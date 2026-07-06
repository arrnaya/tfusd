'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const terminalSequence = [
  { text: '', delay: 100 },
  { text: 'DEUTSCHE BANK AG — SECURE TERMINAL SESSION', delay: 200, color: '#00ff88', bold: true },
  { text: '════════════════════════════════════════════════════════════════', delay: 100 },
  { text: 'NETWORK:         SWIFT NET', delay: 60 },
  { text: 'PRINTED DATE:    02/06/2025', delay: 60 },
  { text: 'PRINTED TIME:    10:01:23', delay: 60 },
  { text: 'PRINTER LABEL:   PRINTER IN 2025-06', delay: 60 },
  { text: 'DOCUMENT REF:    000000000SRT-NR-102-INTERNAL COPY', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- MESSAGE HEADER ---', delay: 100, color: '#00d4ff' },
  { text: 'FUNDS TYPE:           M1 FUNDS', delay: 60 },
  { text: 'UPLOAD FORMAT:        S2S UPLOAD FORMAT', delay: 60 },
  { text: 'FILE EXTENSION:       AES', delay: 60 },
  { text: 'FILE FORMAT:          FIN', delay: 60 },
  { text: 'FORMAT OPTION:        CEF', delay: 60 },
  { text: 'ENCODING:             UTF-8', delay: 60 },
  { text: 'CURRENCY:             EUR (EURO)', delay: 60 },
  { text: 'AMOUNT:               5,993,828,116.00', delay: 60, color: '#00ff88', bold: true },
  { text: 'DATE:                 02/06/2025', delay: 60 },
  { text: 'TIME:                 10:01:23', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- TRANSACTION CODES ---', delay: 100, color: '#00d4ff' },
  { text: 'REFERENCE NUMBER:              DEUT56323524814238', delay: 60 },
  { text: 'TRANSACTION CODE:              144A:S:G4639DVY8', delay: 60 },
  { text: 'CLEARING CODE:                 DE73148564856465443', delay: 60 },
  { text: 'TRANSFER ENCRYPTION CODE:      DE90343042854584564889', delay: 60 },
  { text: 'UPLOAD CODE:                   DE4092374937259872598', delay: 60 },
  { text: 'PERMIT CODE:                   DE3092579841759437505', delay: 60 },
  { text: 'FINAL RELEASE CODE:            CR38828530', delay: 60 },
  { text: 'DOWNLOADING CODE:              AM-7256-L-75962-98563-98281', delay: 60 },
  { text: 'ACCESS CODE:                   bar 1588623', delay: 60 },
  { text: 'INTERBANKING BLOCKING CODE:    DE70948754831758990437045', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- SERVER INFO ---', delay: 100, color: '#00d4ff' },
  { text: 'IDENTITY CODE:                 27C-DB-FR-DE-17BEH', delay: 60 },
  { text: 'SERVER GLOBAL ID ORIGIN:       AS6223', delay: 60 },
  { text: 'SERVER GLOBAL IP:              193.150.166.0/24 193.150.166.0/243', delay: 60 },
  { text: 'CLIENT NUMBER:                 00000000000000FGN470DEUTDEFF00000001244', delay: 60 },
  { text: 'PERMIT ARRIVAL MONEY NUMBER:   DE498323759847507347385954', delay: 60 },
  { text: 'WINDOWS TERMINAL SERVER:       S0200235', delay: 60 },
  { text: 'LOGIN DOMAIN:                  DEUTDESS604', delay: 60 },
  { text: 'LOGON SERVER:                  43987453', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- FARM AND USER ---', delay: 100, color: '#00d4ff' },
  { text: 'FARM NAME:            FARM 42', delay: 60 },
  { text: 'USER NAME:            493069K1', delay: 60 },
  { text: 'USER ID:              FGN470', delay: 60 },
  { text: 'CLEARING HOUSE NUMBER: DE40382403859050', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- TRANSACTION IDENTIFIERS ---', delay: 100, color: '#00d4ff' },
  { text: 'TRANSACTION ID:            DE9347983725927893', delay: 60 },
  { text: 'FINAL BLOCKING CODE:       CR38828530', delay: 60 },
  { text: 'TRANSFER CODE:             DE4403840938483950495', delay: 60 },
  { text: 'UNIQUE TRANSACTION NUMBER: DE9328095849584980958', delay: 60 },
  { text: 'IMAD NUMBER:               27473436565', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- SENDER / ORDERING CUSTOMER ---', delay: 100, color: '#00d4ff' },
  { text: 'BANK NAME:      DEUTSCHE BANK AG', delay: 60 },
  { text: 'BANK ADDRESS:   TAUNUSANLAGE 12, 60325 FRANKFURT AM MAIN, GERMANY', delay: 60 },
  { text: 'ACCOUNT NAME:   KRONENTHAL GMBH', delay: 60 },
  { text: 'ACCOUNT NUMBER: DE96604700820065434300', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- UPLOAD STATUS ---', delay: 100, color: '#00d4ff' },
  { text: 'IP/SVR TYPE:     S2S UPLOAD ACCESS', delay: 60 },
  { text: 'STATUS:          FUNDS UPLOAD SUCCESSFUL', delay: 60, color: '#00ff88', bold: true },
  { text: 'AMOUNT:          5,993,828,116.00', delay: 60, color: '#00ff88', bold: true },
  { text: 'CURRENCY:        EUR (EURO)', delay: 60 },
  { text: 'IP/IP VERSION:   IPV4/IPV6', delay: 60 },
  { text: '', delay: 60 },
  { text: 'PROGRESS:', delay: 60 },
  { text: '  [ 10%] SVR1  ▓▓░░░░░░░░', delay: 40 },
  { text: '  [ 40%] SVR2  ▓▓▓▓▓▓▓▓░░', delay: 40 },
  { text: '  [ 80%] SVR3  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░', delay: 40 },
  { text: '  [100%] SVR4  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓', delay: 40, color: '#00ff88' },
  { text: '', delay: 60 },
  { text: 'ACCESS GRANTED:  true', delay: 60, color: '#00ff88' },
  { text: '', delay: 100 },
  { text: '--- LICENSE ACTIVATIONS ---', delay: 100, color: '#00d4ff' },
  { text: '[1] LANG4XGEPAY01 — active port-basic slot activated', delay: 60 },
  { text: '[2] LANG8GEPAYG01 — active port-basic slot activated', delay: 60 },
  { text: '[3] LANG2XGEPAY01 — active port-basic slot activated', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- HARDWARE VERSIONS ---', delay: 100, color: '#00d4ff' },
  { text: 'PCB VERSION:  435435435 REV A', delay: 60 },
  { text: 'EPLD VERSION: V120', delay: 60 },
  { text: 'FPGA VERSION: V130', delay: 60 },
  { text: 'INFO VERSION: 37489837 REV D', delay: 60 },
  { text: '', delay: 100 },
  { text: '--- CERTIFICATE CHAIN ---', delay: 100, color: '#00d4ff' },
  { text: 'BEGIN CERTIFICATE', delay: 60, color: '#fbbf24' },
  { text: '  adfby4x7n841y185x7780y4187x5y4784mnxh3r2uh0784byr780xhn4877xhnt74hf78x7480', delay: 30 },
  { text: '  13471xurb47ctrb7x6ucw78w467c45by7nx74s8ry74850c4cn574xn84nl758ny5nx4hnu8hn', delay: 30 },
  { text: '  xf74tnt4t7482mx2thf9xjfhnunhd2d2xny47fy4gnx7x4g7g4h9g7y49ggh334706c378v84', delay: 30 },
  { text: '  365v4bd543dr8978f6g95f6h57gj479hj48hj4j3kgooej3xm49cn57c64b78xn7s847nc47b6', delay: 30 },
  { text: '  ns39n5v84747667b478s3texgcgx3tbq7xrc38n85nv4n589038n4bx376z78n4x49c4nn8c89', delay: 30 },
  { text: '  4579466b46b5987598357908579465bc60b09xn03x5c0256087202935Z039x3n5chsb93bx3b', delay: 30 },
  { text: '  4b23362c502650750928159164cbx95902565b0cb54xnxn50x4n56457b6bc50xnn2x5n2305', delay: 30 },
  { text: '  xn0202nxn032n5cbb0556577602562678 5bc6x0xnxn54c7xn532705620c545b4c508460c38', delay: 30 },
  { text: '  0cb63476c587630b45xx5n045n04sj57d07v805bqcxn05e5h5cwb8vb56xn05sn785q2989677', delay: 30 },
  { text: '  4635926bx38n5z94875cb97b5c89c5b9756cb9468c5bcb1072362365b7862587b2872875178', delay: 30 },
  { text: '  2b551xb0b505bx47805b087c5b08xbn5s230j7hf20326056325175c6055cbb62b665275785', delay: 30 },
  { text: '  20121016060157605178560115647384357834658b04053435b8x48x5b4378b4c5b745cb78cb', delay: 30 },
  { text: '  3c5b3478c45cb478c56bcb543c5bc5948374372749bc3c7475cn579nv797v36838705652021', delay: 30 },
  { text: '  6 7x2b6368b256873286374674072 86b6x5025x62705607010177287367 20b6x51263x4xn0', delay: 30 },
  { text: '  xjjdj0djd0h6ch2570602813756h382250hxh7056c0326x77012x012580250x6x5017806x50', delay: 30 },
  { text: '  16hc65056c16xh4178468h65c5dhd5jsj594dj6507627652b876585hs2257837h6783687603', delay: 30 },
  { text: '  47676 36h563sh2h6011aff', delay: 30 },
  { text: 'END CERTIFICATE', delay: 60, color: '#fbbf24' },
  { text: '', delay: 100 },
  { text: '--- COMPLETION ---', delay: 100, color: '#00d4ff' },
  { text: 'ACCESS STATUS:      ALL ACCESS HAS BEEN GRANTED', delay: 60, color: '#00ff88', bold: true },
  { text: 'PROGRESS COMPLETED: 100%', delay: 60, color: '#00ff88', bold: true },
  { text: 'FINAL ACCESS:       ACCESS GRANTED', delay: 60, color: '#00ff88', bold: true },
  { text: '', delay: 100 },
  { text: '════════════════════════════════════════════════════════════════', delay: 100 },
  { text: 'END OF MESSAGE  |  DATE: 02/06/2025  |  TIME: 10:05:36', delay: 100, color: '#00ff88' },
  { text: '', delay: 100 },
  { text: '_', delay: 500, blink: true },
];

export default function BlackScreenPage() {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showCursor, setShowCursor] = useState(true);
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    setSessionId(Math.random().toString(36).substring(2, 14).toUpperCase());
  }, []);

  useEffect(() => {
    let current = 0;
    const timeouts: number[] = [];

    const scheduleNext = () => {
      if (current >= terminalSequence.length) return;
      const t = window.setTimeout(() => {
        setVisibleCount((prev) => prev + 1);
        current++;
        scheduleNext();
      }, terminalSequence[current].delay);
      timeouts.push(t);
    };

    scheduleNext();

    const cursorInterval = window.setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);

    return () => {
      timeouts.forEach(clearTimeout);
      clearInterval(cursorInterval);
    };
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.scanline} />
      <div style={styles.glow} />

      <div style={styles.header}>
        <Link href="/" style={styles.backLink}>← BACK TO DASHBOARD</Link>
        <span style={styles.headerTitle}>DEUTSCHE BANK — SECURE BLACK SCREEN TERMINAL</span>
        <span style={styles.sessionId}>SESSION: {sessionId || 'LOADING...'}</span>
      </div>

      <div style={styles.terminal}>
        {terminalSequence.slice(0, visibleCount).map((line, i) => (
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
            {line.blink && showCursor && <span style={styles.cursor}>█</span>}
          </div>
        ))}
        {visibleCount >= terminalSequence.length && (
          <div style={styles.line}>
            <span style={{ ...styles.cursor, opacity: showCursor ? 1 : 0 }}>█</span>
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <span>SECURE CONNECTION  |  TLS 1.3  |  SWIFT NET  |  ORIGIN: ICUSD-DONS.NETLIFY.APP</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: '#000000',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'JetBrains Mono', monospace",
    position: 'relative',
    overflow: 'hidden',
  },
  scanline: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15), rgba(0,0,0,0.15) 1px, transparent 1px, transparent 2px)',
    pointerEvents: 'none',
    zIndex: 5,
  },
  glow: {
    position: 'fixed',
    top: '-30%',
    left: '-30%',
    width: '160%',
    height: '160%',
    background: 'radial-gradient(circle at 50% 50%, rgba(0, 255, 136, 0.04) 0%, transparent 60%)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 24px',
    borderBottom: '1px solid #113311',
    background: 'rgba(0, 20, 0, 0.6)',
    zIndex: 10,
    flexWrap: 'wrap',
    gap: '10px',
  },
  backLink: {
    color: '#00ff88',
    textDecoration: 'none',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.05em',
  },
  headerTitle: {
    color: '#00ff88',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.1em',
  },
  sessionId: {
    color: '#3f6212',
    fontSize: '11px',
  },
  terminal: {
    flex: 1,
    padding: '24px 32px',
    overflowY: 'auto',
    zIndex: 2,
  },
  line: {
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  cursor: {
    color: '#00ff88',
    textShadow: '0 0 8px rgba(0, 255, 136, 0.8)',
  },
  footer: {
    padding: '10px 24px',
    borderTop: '1px solid #113311',
    background: 'rgba(0, 20, 0, 0.6)',
    color: '#3f6212',
    fontSize: '10px',
    textAlign: 'center',
    letterSpacing: '0.08em',
    zIndex: 10,
  },
};
