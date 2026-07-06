'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useMyUSD } from './MyUSDContext';

export interface AuditCategory {
  name: string;
  score: number; // 0-100
  weight: number;
  status: 'healthy' | 'warning' | 'critical';
  details: string;
}

export interface AuditResult {
  overallScore: number;
  grade: string; // A+, A, B, C, D, F
  categories: AuditCategory[];
  recommendations: string[];
  lastRun: string;
  alerts: { severity: 'info' | 'warning' | 'critical'; message: string }[];
}

interface AuditContextType {
  result: AuditResult;
  runAudit: () => void;
  isRunning: boolean;
}

const defaultResult: AuditResult = {
  overallScore: 100,
  grade: 'A+',
  categories: [],
  recommendations: [],
  lastRun: new Date().toISOString(),
  alerts: [],
};

const AuditContext = createContext<AuditContextType>({
  result: defaultResult,
  runAudit: () => {},
  isRunning: false,
});

function calculateGrade(score: number): string {
  if (score >= 98) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 60) return 'D';
  return 'F';
}

function scoreToStatus(score: number): AuditCategory['status'] {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'warning';
  return 'critical';
}

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const { state } = useMyUSD();
  const [result, setResult] = useState<AuditResult>(defaultResult);
  const [isRunning, setIsRunning] = useState(false);

  const runAudit = useCallback(() => {
    setIsRunning(true);

    const categories: AuditCategory[] = [];
    const recommendations: string[] = [];
    const alerts: AuditResult['alerts'] = [];

    // 1. Peg Stability (weight: 25)
    let pegScore = 100;
    const pegDeviation = Math.abs(state.currentPrice - 1.0);
    if (pegDeviation > 0.02) { pegScore = 0; alerts.push({ severity: 'critical', message: `Peg critically depegged: $${state.currentPrice.toFixed(4)}` }); }
    else if (pegDeviation > 0.01) { pegScore = 40; alerts.push({ severity: 'warning', message: `Peg warning: $${state.currentPrice.toFixed(4)}` }); }
    else if (pegDeviation > 0.005) { pegScore = 70; alerts.push({ severity: 'info', message: `Peg deviation: $${state.currentPrice.toFixed(4)}` }); }
    if (pegScore < 80) recommendations.push('Monitor peg closely and consider auto-mint/burn actions');
    categories.push({ name: 'Peg Stability', score: pegScore, weight: 25, status: scoreToStatus(pegScore), details: `Price: $${state.currentPrice.toFixed(4)} (target: $1.00)` });

    // 2. Pool Health (weight: 20)
    let poolScore = 100;
    const poolRatio = parseFloat(state.pool.target) > 0 ? (parseFloat(state.pool.balance) / parseFloat(state.pool.target)) : 0;
    if (poolRatio < 0.2) { poolScore = 20; alerts.push({ severity: 'critical', message: `Pool critically low: ${(poolRatio * 100).toFixed(1)}%` }); }
    else if (poolRatio < 0.5) { poolScore = 50; alerts.push({ severity: 'warning', message: `Pool low: ${(poolRatio * 100).toFixed(1)}%` }); }
    else if (poolRatio < 0.8) { poolScore = 75; }
    if (poolScore < 80) recommendations.push('Consider pool replenishment');
    categories.push({ name: 'Pool Health', score: poolScore, weight: 20, status: scoreToStatus(poolScore), details: `Balance: ${state.pool.balance} / Target: ${state.pool.target}` });

    // 3. Contract Security (weight: 20)
    let securityScore = 100;
    if (state.paused) { securityScore = 60; alerts.push({ severity: 'warning', message: 'Contract is currently paused' }); recommendations.push('Contract is paused — investigate before resuming'); }
    if (!state.mintingEnabled) { securityScore -= 10; }
    if (!state.burningEnabled) { securityScore -= 10; }
    categories.push({ name: 'Contract Security', score: Math.max(0, securityScore), weight: 20, status: scoreToStatus(securityScore), details: `Paused: ${state.paused ? 'Yes' : 'No'} | Minting: ${state.mintingEnabled ? 'ON' : 'OFF'} | Burning: ${state.burningEnabled ? 'ON' : 'OFF'}` });

    // 4. Supply Health (weight: 15)
    let supplyScore = 100;
    const total = parseFloat(state.totalSupply);
    const circ = parseFloat(state.circulatingSupply);
    const burned = parseFloat(state.burnedSupply);
    const burnRatio = total > 0 ? burned / total : 0;
    if (burnRatio < 0.05) supplyScore = 85; // low burn ratio
    if (burnRatio > 0.5) { supplyScore = 50; alerts.push({ severity: 'warning', message: 'High burn ratio detected' }); }
    categories.push({ name: 'Supply Health', score: supplyScore, weight: 15, status: scoreToStatus(supplyScore), details: `Total: ${state.totalSupply} | Burned: ${state.burnedSupply}` });

    // 5. Alert Health (weight: 10)
    let alertScore = 100;
    if (state.unacknowledgedCriticalCount > 0) { alertScore = 30; alerts.push({ severity: 'critical', message: `${state.unacknowledgedCriticalCount} unacknowledged critical alerts` }); recommendations.push('Acknowledge critical alerts immediately'); }
    else if (state.alerts.filter(a => !a.acknowledged && a.severity === 'warning').length > 3) { alertScore = 60; }
    categories.push({ name: 'Alert Health', score: alertScore, weight: 10, status: scoreToStatus(alertScore), details: `${state.unacknowledgedCriticalCount} critical | ${state.alerts.filter(a => !a.acknowledged).length} total unacknowledged` });

    // 6. Market Activity (weight: 5)
    let activityScore = 100;
    if (state.volume24h < 100000) { activityScore = 60; alerts.push({ severity: 'info', message: 'Low 24h trading volume' }); }
    if (state.buys24h === 0 && state.sells24h === 0) { activityScore = 30; }
    categories.push({ name: 'Market Activity', score: activityScore, weight: 5, status: scoreToStatus(activityScore), details: `Vol: ${state.volume24h} | Buys: ${state.buys24h} | Sells: ${state.sells24h}` });

    // 7. Governance Health (weight: 3)
    let govScore = 100;
    // Check DAO params are within reasonable ranges
    if (state.depegThreshold < 0.99 || state.depegThreshold > 0.999) { govScore = 70; recommendations.push('Review depeg threshold configuration'); }
    if (state.criticalDepegThreshold < 0.95) { govScore = 50; recommendations.push('Critical depeg threshold may be too low'); }
    categories.push({ name: 'Governance Health', score: govScore, weight: 3, status: scoreToStatus(govScore), details: `Depeg: ${state.depegThreshold} | Critical: ${state.criticalDepegThreshold}` });

    // 8. Auto-Action Health (weight: 2)
    let autoScore = 100;
    if (!state.autoMintOnDepeg) { autoScore -= 15; recommendations.push('Auto-mint on depeg is disabled — consider enabling'); }
    if (!state.autoBurnOnPositiveDepeg) { autoScore -= 15; }
    if (!state.autoReplenishPool) { autoScore -= 10; }
    categories.push({ name: 'Auto-Actions', score: Math.max(0, autoScore), weight: 2, status: scoreToStatus(autoScore), details: `Mint: ${state.autoMintOnDepeg ? 'ON' : 'OFF'} | Burn: ${state.autoBurnOnPositiveDepeg ? 'ON' : 'OFF'} | Replenish: ${state.autoReplenishPool ? 'ON' : 'OFF'}` });

    // Calculate weighted overall score
    const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
    const overallScore = categories.reduce((sum, c) => sum + (c.score * c.weight / totalWeight), 0);

    setResult({
      overallScore: Math.round(overallScore),
      grade: calculateGrade(overallScore),
      categories,
      recommendations,
      lastRun: new Date().toISOString(),
      alerts,
    });

    setIsRunning(false);
  }, [state]);

  // Auto-run audit every 30 seconds
  useEffect(() => {
    runAudit();
    const interval = setInterval(runAudit, 30000);
    return () => clearInterval(interval);
  }, [runAudit]);

  return (
    <AuditContext.Provider value={{ result, runAudit, isRunning }}>
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit() {
  return useContext(AuditContext);
}
