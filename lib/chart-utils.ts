// SVG chart utilities for lightweight, dependency-free charting
// All charts render as SVG elements — no external chart library needed

export interface Point {
  x: number;
  y: number;
}

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const scale = (r1 - r0) / (d1 - d0);
  return (value: number) => r0 + (value - d0) * scale;
}

export function getMinMax(data: number[]): [number, number] {
  if (data.length === 0) return [0, 1];
  const min = Math.min(...data);
  const max = Math.max(...data);
  if (min === max) return [min - 1, max + 1];
  // Add small padding
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

export function linePath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

export function areaPath(points: Point[], bottomY: number): string {
  if (points.length === 0) return '';
  const line = linePath(points);
  return `${line} L ${points[points.length - 1].x} ${bottomY} L ${points[0].x} ${bottomY} Z`;
}

export function sparklinePath(data: number[], width: number, height: number, padding: ChartPadding = { top: 4, right: 4, bottom: 4, left: 4 }): string {
  if (data.length === 0) return '';
  const [min, max] = getMinMax(data);
  const xScale = scaleLinear([0, data.length - 1], [padding.left, width - padding.right]);
  const yScale = scaleLinear([min, max], [height - padding.bottom, padding.top]);
  const points = data.map((d, i) => ({ x: xScale(i), y: yScale(d) }));
  return linePath(points);
}

export function sparklineAreaPath(data: number[], width: number, height: number, padding: ChartPadding = { top: 4, right: 4, bottom: 4, left: 4 }): string {
  if (data.length === 0) return '';
  const [min, max] = getMinMax(data);
  const xScale = scaleLinear([0, data.length - 1], [padding.left, width - padding.right]);
  const yScale = scaleLinear([min, max], [height - padding.bottom, padding.top]);
  const points = data.map((d, i) => ({ x: xScale(i), y: yScale(d) }));
  return areaPath(points, height - padding.bottom);
}

export function barRects(data: number[], width: number, height: number, padding: ChartPadding = { top: 4, right: 4, bottom: 4, left: 4 }): { x: number; y: number; w: number; h: number }[] {
  if (data.length === 0) return [];
  const [min, max] = getMinMax(data);
  const xScale = scaleLinear([0, data.length - 1], [padding.left, width - padding.right]);
  const yScale = scaleLinear([min, max], [height - padding.bottom, padding.top]);
  const barWidth = Math.max(1, ((width - padding.left - padding.right) / data.length) * 0.7);
  return data.map((d, i) => ({
    x: xScale(i) - barWidth / 2,
    y: yScale(d),
    w: barWidth,
    h: height - padding.bottom - yScale(d),
  }));
}

export function gaugeArc(value: number, min: number, max: number, radius: number): { path: string; color: string } {
  const angleScale = scaleLinear([min, max], [Math.PI * 0.75, Math.PI * 2.25]);
  const angle = angleScale(value);
  const cx = radius + 10;
  const cy = radius + 10;
  const endX = cx + radius * Math.cos(angle);
  const endY = cy + radius * Math.sin(angle);
  
  // Determine color based on value
  const mid = (min + max) / 2;
  const range = max - min;
  const deviation = Math.abs(value - mid) / (range / 2);
  let color = '#00ff88'; // green (stable)
  if (deviation > 0.3) color = '#fbbf24'; // yellow (warning)
  if (deviation > 0.6) color = '#ef4444'; // red (critical)
  
  const path = `M ${cx + radius * Math.cos(Math.PI * 0.75)} ${cy + radius * Math.sin(Math.PI * 0.75)} A ${radius} ${radius} 0 1 1 ${endX} ${endY}`;
  return { path, color };
}

export function generateGridLines(min: number, max: number, count: number): number[] {
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

export function niceNumber(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / Math.pow(10, exponent);
  let niceFraction: number;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * Math.pow(10, exponent);
}
