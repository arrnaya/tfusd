'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import { type PricePoint, type PriceTimeframe } from '@/lib/geckoterminal';

interface PriceChartProps {
  data: PricePoint[];
  timeframe: PriceTimeframe;
  onTimeframeChange: (timeframe: PriceTimeframe) => void;
  loading?: boolean;
}

const TIMEFRAMES: { key: PriceTimeframe; label: string }[] = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '1m', label: '1M' },
  { key: '1y', label: '1Y' },
  { key: 'max', label: 'MAX' },
];

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 220;
const MARGIN = { top: 24, right: 30, bottom: 44, left: 56 };
const PLOT_WIDTH = VIEW_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = VIEW_HEIGHT - MARGIN.top - MARGIN.bottom;

function formatPrice(value: number): string {
  return value.toFixed(4);
}

function formatTimeLabel(timestamp: number, timeframe: PriceTimeframe): string {
  const date = new Date(timestamp);
  if (timeframe === '24h' || timeframe === '7d') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function PriceChart({ data, timeframe, onTimeframeChange, loading }: PriceChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { linePath, areaPath, xTicks, yTicks, minPrice, maxPrice, firstTs, lastTs } = useMemo(() => {
    if (data.length < 2) {
      return { linePath: '', areaPath: '', xTicks: [], yTicks: [], minPrice: 0, maxPrice: 0, firstTs: 0, lastTs: 0 };
    }

    const prices = data.map((d) => d.close);
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    const padding = Math.max((max - min) * 0.1, 0.005);
    min = Math.max(0, min - padding);
    max = max + padding;

    const firstTs = data[0].timestamp;
    const lastTs = data[data.length - 1].timestamp;
    const timeRange = Math.max(lastTs - firstTs, 1);
    const priceRange = Math.max(max - min, 0.0001);

    const x = (ts: number) => MARGIN.left + ((ts - firstTs) / timeRange) * PLOT_WIDTH;
    const y = (price: number) => MARGIN.top + PLOT_HEIGHT - ((price - min) / priceRange) * PLOT_HEIGHT;

    let linePath = '';
    data.forEach((point, i) => {
      const px = x(point.timestamp);
      const py = y(point.close);
      linePath += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
    });

    const areaPath = `${linePath} L ${x(lastTs)} ${MARGIN.top + PLOT_HEIGHT} L ${x(firstTs)} ${MARGIN.top + PLOT_HEIGHT} Z`;

    const xTicks = [0, Math.floor((data.length - 1) / 4), Math.floor((data.length - 1) / 2), Math.floor((data.length - 1) * 3 / 4), data.length - 1]
      .filter((i, idx, arr) => arr.indexOf(i) === idx)
      .map((i) => ({ index: i, x: x(data[i].timestamp), label: formatTimeLabel(data[i].timestamp, timeframe) }));

    const yTickCount = 5;
    const yTicks = Array.from({ length: yTickCount }, (_, i) => {
      const price = min + (i / (yTickCount - 1)) * priceRange;
      return { y: y(price), label: formatPrice(price) };
    });

    return { linePath, areaPath, xTicks, yTicks, minPrice: min, maxPrice: max, firstTs, lastTs };
  }, [data, timeframe]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || data.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotX = (x / rect.width) * VIEW_WIDTH;
    const relativeX = Math.min(Math.max(plotX - MARGIN.left, 0), PLOT_WIDTH);
    const ratio = relativeX / PLOT_WIDTH;
    const index = Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1))));
    setHoverIndex(index);
  }, [data.length]);

  const handleMouseLeave = useCallback(() => setHoverIndex(null), []);

  const hoveredPoint = hoverIndex != null ? data[hoverIndex] : null;

  const isPositive = data.length >= 2 && data[data.length - 1].close >= data[0].close;
  const lineColor = isPositive ? '#00ff88' : '#ef4444';

  return (
    <div style={{ ...cardStyle, gridColumn: 'span 3' }}>
      <div style={cardHeaderStyle}>
        <div style={cardTitleStyle}>Price History</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.key}
              onClick={() => onTimeframeChange(tf.key)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: timeframe === tf.key ? '1px solid rgba(0,212,255,0.3)' : '1px solid transparent',
                background: timeframe === tf.key ? 'rgba(0,212,255,0.12)' : 'transparent',
                color: timeframe === tf.key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: '20px', position: 'relative' }}>
        {loading || data.length < 2 ? (
          <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', fontFamily: "'JetBrains Mono', monospace" }}>
            {loading ? 'Loading chart data...' : 'No price data'}
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="priceAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {yTicks.map((tick, i) => (
              <line key={`h-${i}`} x1={MARGIN.left} y1={tick.y} x2={MARGIN.left + PLOT_WIDTH} y2={tick.y} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
            ))}
            {xTicks.map((tick, i) => (
              <line key={`v-${i}`} x1={tick.x} y1={MARGIN.top} x2={tick.x} y2={MARGIN.top + PLOT_HEIGHT} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
            ))}

            {/* Axes */}
            <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + PLOT_HEIGHT} stroke="rgba(255,255,255,0.1)" />
            <line x1={MARGIN.left} y1={MARGIN.top + PLOT_HEIGHT} x2={MARGIN.left + PLOT_WIDTH} y2={MARGIN.top + PLOT_HEIGHT} stroke="rgba(255,255,255,0.1)" />

            {/* Area */}
            <path d={areaPath} fill="url(#priceAreaGradient)" />

            {/* Line */}
            <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {/* Y-axis labels */}
            {yTicks.map((tick, i) => (
              <text key={`yl-${i}`} x={MARGIN.left - 10} y={tick.y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">
                {tick.label}
              </text>
            ))}

            {/* X-axis labels */}
            {xTicks.map((tick, i) => (
              <text key={`xl-${i}`} x={tick.x} y={MARGIN.top + PLOT_HEIGHT + 20} textAnchor="middle" fill="var(--text-muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">
                {tick.label}
              </text>
            ))}

            {/* Hover crosshair and point */}
            {hoveredPoint && (
              <>
                <line
                  x1={MARGIN.left + ((hoveredPoint.timestamp - firstTs) / Math.max(lastTs - firstTs, 1)) * PLOT_WIDTH}
                  y1={MARGIN.top}
                  x2={MARGIN.left + ((hoveredPoint.timestamp - firstTs) / Math.max(lastTs - firstTs, 1)) * PLOT_WIDTH}
                  y2={MARGIN.top + PLOT_HEIGHT}
                  stroke="rgba(255,255,255,0.2)"
                  strokeDasharray="4 4"
                />
                <circle
                  cx={MARGIN.left + ((hoveredPoint.timestamp - firstTs) / Math.max(lastTs - firstTs, 1)) * PLOT_WIDTH}
                  cy={MARGIN.top + PLOT_HEIGHT - ((hoveredPoint.close - minPrice) / Math.max(maxPrice - minPrice, 0.0001)) * PLOT_HEIGHT}
                  r="5"
                  fill={lineColor}
                  stroke="#fff"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>
        )}

        {/* Tooltip */}
        {hoveredPoint && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'rgba(0,0,0,0.7)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '11px',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text-primary)',
              pointerEvents: 'none',
            }}
          >
            <div style={{ color: 'var(--text-muted)' }}>{new Date(hoveredPoint.timestamp).toLocaleString()}</div>
            <div style={{ fontWeight: 700, color: lineColor }}>${formatPrice(hoveredPoint.close)}</div>
            <div style={{ color: 'var(--text-muted)' }}>Vol: {Math.round(hoveredPoint.volume).toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: '16px',
  overflow: 'hidden',
};

const cardHeaderStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid var(--border-color)',
  background: 'rgba(255,255,255,0.02)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: 'var(--text-primary)',
};
