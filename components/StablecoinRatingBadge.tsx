'use client';

import { useState } from 'react';
import { useAudit, type AuditCategory } from './AuditContext';
import Modal from './Modal';
import { formatDateTime } from '@/lib/format-utils';

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'var(--accent-green)';
  if (grade.startsWith('B')) return 'var(--accent-cyan)';
  if (grade.startsWith('C')) return 'var(--warning)';
  return 'var(--danger)';
}

function statusColor(status: AuditCategory['status']): string {
  if (status === 'healthy') return 'var(--accent-green)';
  if (status === 'warning') return 'var(--warning)';
  return 'var(--danger)';
}

export default function StablecoinRatingBadge() {
  const { result } = useAudit();
  const [open, setOpen] = useState(false);

  const color = gradeColor(result.grade);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          ...badgeStyle,
          borderColor: color,
          color: color,
          background: `${color}15`,
          boxShadow: `0 0 12px ${color}25`,
        }}
        title="Internal stability assessment — click for details"
      >
        <span
          style={{
            ...gradeCircleStyle,
            background: color,
          }}
        >
          {result.grade}
        </span>
        <span>Internal Rating</span>
      </button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="TFUSD Internal Stability Assessment"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={headerStyle}>
            <div
              style={{
                ...bigGradeStyle,
                color: color,
                borderColor: color,
                background: `${color}10`,
                boxShadow: `0 0 24px ${color}25`,
              }}
            >
              {result.grade}
            </div>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {result.overallScore} / 100
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Last updated: {formatDateTime(result.lastRun)}
              </div>
            </div>
          </div>

          <div style={sourceBannerStyle}>
            <strong>Source:</strong> Internal assessment derived from verifiable
            on-chain and off-chain metrics (peg deviation, pool health, contract
            state, supply/burn ratios, alerts, market activity, governance
            parameters, and auto-actions). This is not a third-party credit
            rating.
          </div>

          <div style={categoriesStyle}>
            {result.categories.map((cat) => (
              <div key={cat.name} style={categoryRowStyle}>
                <div style={categoryHeaderStyle}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {cat.name}
                  </span>
                  <span style={{ color: statusColor(cat.status), fontWeight: 700 }}>
                    {cat.score}/100
                  </span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Weight {cat.weight}% · {cat.status}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {cat.details}
                </div>
              </div>
            ))}
          </div>

          {result.recommendations.length > 0 && (
            <div style={recommendationsStyle}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Recommendations
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)' }}>
                {result.recommendations.map((rec, i) => (
                  <li key={i} style={{ marginBottom: '4px', lineHeight: 1.5 }}>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

const badgeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  borderRadius: '20px',
  border: '1px solid',
  fontSize: '11px',
  fontWeight: 700,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: 'pointer',
  transition: 'transform 0.15s, box-shadow 0.15s',
};

const gradeCircleStyle: React.CSSProperties = {
  width: '22px',
  height: '22px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '10px',
  fontWeight: 800,
  color: '#fff',
  flexShrink: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  padding: '16px',
  background: 'var(--bg-secondary)',
  borderRadius: '12px',
  border: '1px solid var(--border-color)',
};

const bigGradeStyle: React.CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '24px',
  fontWeight: 800,
  border: '2px solid',
  flexShrink: 0,
};

const sourceBannerStyle: React.CSSProperties = {
  padding: '12px',
  borderRadius: '8px',
  background: 'rgba(0, 136, 255, 0.08)',
  border: '1px solid rgba(0, 136, 255, 0.25)',
  color: 'var(--text-secondary)',
  fontSize: '11px',
  lineHeight: 1.5,
};

const categoriesStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const categoryRowStyle: React.CSSProperties = {
  padding: '12px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: '10px',
};

const categoryHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '4px',
  fontSize: '13px',
};

const recommendationsStyle: React.CSSProperties = {
  padding: '12px',
  background: 'rgba(245, 158, 11, 0.08)',
  border: '1px solid rgba(245, 158, 11, 0.25)',
  borderRadius: '8px',
  fontSize: '12px',
};
