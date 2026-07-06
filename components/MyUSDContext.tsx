'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { useNetwork } from './NetworkContext';
import { type NetworkConfig, type NetworkKey } from '@/lib/myusd-config';
import { fetchCrossChainTotalSupply } from '@/lib/cross-chain-supply';
import { TFUSD_ABI } from '@/lib/contract-abi';
import { fetchPoolInfo, fetchPoolOHLCV, getDemoMarketData, getDemoOHLCV, type MarketData, type PricePoint } from '@/lib/geckoterminal';
import { formatNumber, formatPercentage, clamp } from '@/lib/format-utils';
import { addAuditEntry } from '@/lib/dao-config';
import { loadAdminState } from '@/lib/admin-config';
import { useWallet } from './WalletContext';

export interface Alert {
  id: string;
  type: 'depeg' | 'positive-depeg' | 'pool-low' | 'contract-paused' | 'mint-halted' | 'dao-proposal' | 'auto-mint' | 'auto-burn' | 'auto-replenish';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
  acknowledged: boolean;
  data?: Record<string, any>;
}

export interface MintBurnEvent {
  id: string;
  type: 'mint' | 'burn';
  amount: string;
  toOrFrom?: string;
  trigger: 'manual' | 'auto-depeg' | 'auto-positive-depeg' | 'auto-pool-replenish' | 'dao-proposal';
  txHash?: string;
  timestamp: string;
  operator: string;
  pegPriceAtExecution: number;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface PoolState {
  balance: string;
  target: string;
  health: 'healthy' | 'low' | 'critical';
  lastReplenishAt: string | null;
  replenishHistory: { timestamp: string; amount: string; trigger: string }[];
}

export interface MyUSDState {
  // Peg
  currentPrice: number;
  targetPeg: number;
  depegThreshold: number;
  positiveDepegThreshold: number;
  criticalDepegThreshold: number;
  pegStatus: 'stable' | 'depeg' | 'positive-depeg' | 'critical';
  lastDepegAt: string | null;
  priceHistory: PricePoint[];
  priceChange24h: number;

  // Market
  marketData: MarketData | null;
  marketCap: number | null;
  fdv: number;
  volume24h: number;
  reserveUsd: number;
  buys24h: number;
  sells24h: number;

  // Supply
  totalSupply: string;
  circulatingSupply: string;
  burnedSupply: string;
  mintedToday: string;
  burnedToday: string;
  crossChainSupply?: Partial<Record<NetworkKey, string>>;
  crossChainSupplyRaw?: Partial<Record<NetworkKey, bigint>>;

  // Pool
  pool: PoolState;

  // Alerts
  alerts: Alert[];
  unacknowledgedCriticalCount: number;

  // Minting/Burning
  mintingEnabled: boolean;
  burningEnabled: boolean;
  autoMintOnDepeg: boolean;
  autoBurnOnPositiveDepeg: boolean;
  autoReplenishPool: boolean;
  maxAutoMintAmount: string;
  maxAutoBurnAmount: string;

  // Contract
  contractAddress: string;
  network: string;
  decimals: number;
  currency: string;
  paused: boolean;

  // History
  mintHistory: MintBurnEvent[];
  burnHistory: MintBurnEvent[];

  // Loading
  loading: boolean;
  error: string | null;
  lastUpdated: string;
}

export interface MyUSDContextType {
  state: MyUSDState;
  acknowledgeAlert: (id: string) => void;
  acknowledgeAllAlerts: () => void;
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp'>) => void;
  manualMint: (amount: string, to: string, operator: string) => Promise<boolean>;
  manualBurn: (amount: string, operator: string) => Promise<boolean>;
  replenishPool: (amount: string, operator: string) => Promise<boolean>;
  emergencyPause: (operator: string) => void;
  emergencyUnpause: (operator: string) => void;
  refreshData: () => void;
}

const MyUSDContext = createContext<MyUSDContextType | undefined>(undefined);

const STORAGE_KEYS = {
  alerts: 'tfusd_alerts',
  mintHistory: 'tfusd_mint_history',
  burnHistory: 'tfusd_burn_history',
  poolReplenish: 'tfusd_pool_replenish',
};

function generateId(): string {
  return `tfusd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadAlerts(): Alert[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.alerts);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveAlerts(alerts: Alert[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEYS.alerts, JSON.stringify(alerts.slice(-200))); } catch {}
}

function loadMintHistory(): MintBurnEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.mintHistory);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMintHistory(history: MintBurnEvent[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEYS.mintHistory, JSON.stringify(history.slice(-100))); } catch {}
}

function loadBurnHistory(): MintBurnEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.burnHistory);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveBurnHistory(history: MintBurnEvent[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEYS.burnHistory, JSON.stringify(history.slice(-100))); } catch {}
}

function loadReplenishHistory(): { timestamp: string; amount: string; trigger: string }[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.poolReplenish);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveReplenishHistory(history: { timestamp: string; amount: string; trigger: string }[]) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEYS.poolReplenish, JSON.stringify(history.slice(-100))); } catch {}
}

function getDefaultState(networkConfig: NetworkConfig): MyUSDState {
  const adminState = loadAdminState();
  const daoParams = adminState.daoParams;

  return {
    currentPrice: 1.0,
    targetPeg: 1.0,
    depegThreshold: daoParams.depegThreshold,
    positiveDepegThreshold: daoParams.positiveDepegThreshold,
    criticalDepegThreshold: daoParams.criticalDepegThreshold,
    pegStatus: 'stable',
    lastDepegAt: null,
    priceHistory: [],
    priceChange24h: 0,

    marketData: null,
    marketCap: null,
    fdv: 0,
    volume24h: 0,
    reserveUsd: 0,
    buys24h: 0,
    sells24h: 0,

    totalSupply: '1000000000',
    circulatingSupply: '850000000',
    burnedSupply: '150000000',
    mintedToday: '0',
    burnedToday: '0',
    crossChainSupply: {},
    crossChainSupplyRaw: {},

    pool: {
      balance: '800000000',
      target: networkConfig.poolTargetBalance,
      health: 'healthy',
      lastReplenishAt: null,
      replenishHistory: loadReplenishHistory(),
    },

    alerts: loadAlerts(),
    unacknowledgedCriticalCount: 0,

    mintingEnabled: true,
    burningEnabled: true,
    autoMintOnDepeg: daoParams.autoMintOnDepeg,
    autoBurnOnPositiveDepeg: daoParams.autoBurnOnPositiveDepeg,
    autoReplenishPool: daoParams.autoReplenishPool,
    maxAutoMintAmount: daoParams.maxAutoMintAmount,
    maxAutoBurnAmount: daoParams.maxAutoBurnAmount,

    contractAddress: networkConfig.contractAddress,
    network: networkConfig.name,
    decimals: networkConfig.decimals,
    currency: networkConfig.currency,
    paused: false,

    mintHistory: loadMintHistory(),
    burnHistory: loadBurnHistory(),

    loading: false,
    error: null,
    lastUpdated: new Date().toISOString(),
  };
}

function calculatePegStatus(price: number, depegThreshold: number, positiveThreshold: number, criticalThreshold: number): MyUSDState['pegStatus'] {
  if (price < criticalThreshold) return 'critical';
  if (price < depegThreshold) return 'depeg';
  if (price > positiveThreshold) return 'positive-depeg';
  return 'stable';
}

function calculatePoolHealth(balance: number, target: number): PoolState['health'] {
  const ratio = target > 0 ? balance / target : 0;
  if (ratio < 0.2) return 'critical';
  if (ratio < 0.5) return 'low';
  return 'healthy';
}

export function MyUSDProvider({ children }: { children: React.ReactNode }) {
  const { networkConfig } = useNetwork();
  const [state, setState] = useState<MyUSDState>(() => getDefaultState(networkConfig));
  const intervalRef = useRef<number | null>(null);
  const alertSoundRef = useRef<HTMLAudioElement | null>(null);
  const { signer, isConnected, address } = useWallet();

  const getContract = useCallback(() => {
    if (!signer) return null;
    return new ethers.Contract(networkConfig.contractAddress, TFUSD_ABI, signer);
  }, [signer, networkConfig.contractAddress]);

  const addAlert = useCallback((alert: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'> & { acknowledged?: boolean }) => {
    const newAlert: Alert = {
      ...alert,
      acknowledged: alert.acknowledged ?? false,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };
    setState((prev) => {
      const alerts = [newAlert, ...prev.alerts].slice(0, 200);
      saveAlerts(alerts);
      const unacknowledgedCriticalCount = alerts.filter(a => !a.acknowledged && a.severity === 'critical').length;
      return { ...prev, alerts, unacknowledgedCriticalCount };
    });
  }, []);

  const acknowledgeAlert = useCallback((id: string) => {
    setState((prev) => {
      const alerts = prev.alerts.map(a => a.id === id ? { ...a, acknowledged: true } : a);
      saveAlerts(alerts);
      const unacknowledgedCriticalCount = alerts.filter(a => !a.acknowledged && a.severity === 'critical').length;
      return { ...prev, alerts, unacknowledgedCriticalCount };
    });
  }, []);

  const acknowledgeAllAlerts = useCallback(() => {
    setState((prev) => {
      const alerts = prev.alerts.map(a => ({ ...a, acknowledged: true }));
      saveAlerts(alerts);
      return { ...prev, alerts, unacknowledgedCriticalCount: 0 };
    });
  }, []);

  const addMintEvent = useCallback((event: MintBurnEvent) => {
    setState((prev) => {
      const history = [event, ...prev.mintHistory].slice(0, 100);
      saveMintHistory(history);
      const mintedToday = (parseFloat(prev.mintedToday) + parseFloat(event.amount)).toString();
      return { ...prev, mintHistory: history, mintedToday };
    });
  }, []);

  const addBurnEvent = useCallback((event: MintBurnEvent) => {
    setState((prev) => {
      const history = [event, ...prev.burnHistory].slice(0, 100);
      saveBurnHistory(history);
      const burnedToday = (parseFloat(prev.burnedToday) + parseFloat(event.amount)).toString();
      return { ...prev, burnHistory: history, burnedToday };
    });
  }, []);

  const checkAndAutoActions = useCallback((price: number, currentState: MyUSDState) => {
    const adminState = loadAdminState();
    const params = adminState.daoParams;
    const status = calculatePegStatus(price, params.depegThreshold, params.positiveDepegThreshold, params.criticalDepegThreshold);

    // Critical depeg
    if (status === 'critical' && currentState.pegStatus !== 'critical') {
      addAlert({
        type: 'depeg',
        severity: 'critical',
        message: `CRITICAL DEPPEG: TFUSD at $${price.toFixed(4)} (below $${params.criticalDepegThreshold})`,
        data: { price, threshold: params.criticalDepegThreshold },
      });
      addAuditEntry({
        action: 'critical-depeg-alert',
        actor: 'system',
        role: 'auto-monitor',
        details: `Price ${price} below critical threshold ${params.criticalDepegThreshold}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Depeg
    if (status === 'depeg' && currentState.pegStatus !== 'depeg' && currentState.pegStatus !== 'critical') {
      addAlert({
        type: 'depeg',
        severity: 'warning',
        message: `Depeg detected: TFUSD at $${price.toFixed(4)} (below $${params.depegThreshold})`,
        data: { price, threshold: params.depegThreshold },
      });
      if (params.autoMintOnDepeg && currentState.mintingEnabled) {
        const mintAmount = Math.min(parseFloat(params.maxAutoMintAmount), parseFloat(currentState.totalSupply) * 0.01).toString();
        addMintEvent({
          id: generateId(),
          type: 'mint',
          amount: mintAmount,
          trigger: 'auto-depeg',
          timestamp: new Date().toISOString(),
          operator: 'system',
          pegPriceAtExecution: price,
          status: 'pending',
        });
        addAlert({
          type: 'auto-mint',
          severity: 'info',
          message: `Auto-minted ${formatNumber(mintAmount)} TFUSD to pool in response to depeg`,
        });
        addAuditEntry({
          action: 'auto-mint',
          actor: 'system',
          role: 'auto-monitor',
          details: `Auto-mint ${mintAmount} TFUSD at price ${price}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Positive depeg
    if (status === 'positive-depeg' && currentState.pegStatus !== 'positive-depeg') {
      addAlert({
        type: 'positive-depeg',
        severity: 'warning',
        message: `Positive depeg: TFUSD at $${price.toFixed(4)} (above $${params.positiveDepegThreshold})`,
        data: { price, threshold: params.positiveDepegThreshold },
      });
      if (params.autoBurnOnPositiveDepeg && currentState.burningEnabled) {
        const burnAmount = Math.min(parseFloat(params.maxAutoBurnAmount), parseFloat(currentState.totalSupply) * 0.01).toString();
        addBurnEvent({
          id: generateId(),
          type: 'burn',
          amount: burnAmount,
          trigger: 'auto-positive-depeg',
          timestamp: new Date().toISOString(),
          operator: 'system',
          pegPriceAtExecution: price,
          status: 'pending',
        });
        addAlert({
          type: 'auto-burn',
          severity: 'info',
          message: `Auto-burned ${formatNumber(burnAmount)} TFUSD from pool in response to positive depeg`,
        });
        addAuditEntry({
          action: 'auto-burn',
          actor: 'system',
          role: 'auto-monitor',
          details: `Auto-burn ${burnAmount} TFUSD at price ${price}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Pool replenishment check
    if (params.autoReplenishPool) {
      const poolBalance = parseFloat(currentState.pool.balance);
      const poolTarget = parseFloat(currentState.pool.target);
      const poolRatio = poolTarget > 0 ? poolBalance / poolTarget : 0;
      if (poolRatio < params.poolReplenishThreshold && currentState.pool.health !== 'critical') {
        const replenishAmount = Math.min(
          parseFloat(params.maxAutoMintAmount),
          poolTarget * 0.1
        ).toString();
        addMintEvent({
          id: generateId(),
          type: 'mint',
          amount: replenishAmount,
          trigger: 'auto-pool-replenish',
          timestamp: new Date().toISOString(),
          operator: 'system',
          pegPriceAtExecution: price,
          status: 'pending',
        });
        addAlert({
          type: 'auto-replenish',
          severity: 'info',
          message: `Auto-replenished pool with ${formatNumber(replenishAmount)} TFUSD (pool at ${(poolRatio * 100).toFixed(1)}%)`,
        });
        addAuditEntry({
          action: 'auto-replenish',
          actor: 'system',
          role: 'auto-monitor',
          details: `Auto-replenish ${replenishAmount} TFUSD (pool ratio ${poolRatio})`,
          timestamp: new Date().toISOString(),
        });
        setState((prev) => {
          const newBalance = (parseFloat(prev.pool.balance) + parseFloat(replenishAmount)).toString();
          const newHistory = [
            { timestamp: new Date().toISOString(), amount: replenishAmount, trigger: 'auto-pool-replenish' },
            ...prev.pool.replenishHistory,
          ].slice(0, 100);
          saveReplenishHistory(newHistory);
          return {
            ...prev,
            pool: {
              ...prev.pool,
              balance: newBalance,
              health: calculatePoolHealth(parseFloat(newBalance), parseFloat(prev.pool.target)),
              lastReplenishAt: new Date().toISOString(),
              replenishHistory: newHistory,
            },
          };
        });
      }
    }

    return status;
  }, [addAlert, addMintEvent, addBurnEvent]);

  const refreshData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const adminState = loadAdminState();
      const params = adminState.daoParams;

      let marketData: MarketData | null = null;
      let priceHistory: PricePoint[] = [];

      // Try GeckoTerminal first
      if (networkConfig.geckoPoolAddress && networkConfig.geckoNetwork) {
        marketData = await fetchPoolInfo(networkConfig.geckoNetwork, networkConfig.geckoPoolAddress);
        priceHistory = await fetchPoolOHLCV(networkConfig.geckoNetwork, networkConfig.geckoPoolAddress, 'hour', 1) || [];
      }

      // Fallback to demo data if API unavailable
      if (!marketData) {
        marketData = getDemoMarketData();
      }
      if (priceHistory.length === 0) {
        priceHistory = getDemoOHLCV(50);
      }

      const price = marketData.price || 1.0;
      const prevStatus = state.pegStatus;
      const newStatus = checkAndAutoActions(price, state);

      const poolBalance = parseFloat(state.pool.balance);
      const poolTarget = parseFloat(state.pool.target);
      const poolHealth = calculatePoolHealth(poolBalance, poolTarget);

      // Aggregate total supply across all deployed chains. Market data still
      // comes from GeckoTerminal once pools are listed.
      const crossChainSupply = await fetchCrossChainTotalSupply(networkConfig.contractAddress);

      setState((prev) => {
        const fallbackDrift = (Math.random() - 0.5) * 1000000;
        const totalSupply = crossChainSupply
          ? crossChainSupply.totalSupply
          : (parseFloat(prev.totalSupply) + fallbackDrift).toFixed(0);
        const circSupply = (parseFloat(totalSupply) * 0.85).toFixed(0);

        return {
          ...prev,
          currentPrice: price,
          depegThreshold: params.depegThreshold,
          positiveDepegThreshold: params.positiveDepegThreshold,
          criticalDepegThreshold: params.criticalDepegThreshold,
          pegStatus: newStatus,
          lastDepegAt: newStatus !== 'stable' && prevStatus !== newStatus ? new Date().toISOString() : prev.lastDepegAt,
          priceHistory,
          priceChange24h: marketData.priceChange24h || 0,
          marketData,
          marketCap: marketData.marketCap,
          fdv: marketData.fdv,
          volume24h: marketData.volume24h,
          reserveUsd: marketData.reserveUsd,
          buys24h: marketData.buys24h,
          sells24h: marketData.sells24h,
          totalSupply,
          circulatingSupply: circSupply,
          crossChainSupply: crossChainSupply?.perNetwork ?? prev.crossChainSupply,
          crossChainSupplyRaw: crossChainSupply?.perNetworkRaw ?? prev.crossChainSupplyRaw,
          pool: {
            ...prev.pool,
            health: poolHealth,
          },
          autoMintOnDepeg: params.autoMintOnDepeg,
          autoBurnOnPositiveDepeg: params.autoBurnOnPositiveDepeg,
          autoReplenishPool: params.autoReplenishPool,
          maxAutoMintAmount: params.maxAutoMintAmount,
          maxAutoBurnAmount: params.maxAutoBurnAmount,
          loading: false,
          error: null,
          lastUpdated: new Date().toISOString(),
        };
      });
    } catch (e: any) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e?.message || 'Failed to refresh market data',
      }));
    }
  }, [state.pegStatus, checkAndAutoActions, networkConfig]);

  // Cross-component sync check
  function canExecuteMintBurn(): { allowed: boolean; reason: string | null } {
    const adminState = loadAdminState();
    // Check if any DON is offline
    const anyOffline = Object.values(adminState.dons).some((don) => !don.active);
    if (anyOffline) {
      return { allowed: false, reason: 'Minting/burning disabled: one or more DONs are offline' };
    }
    // Check if contract is paused
    if (state.paused) {
      return { allowed: false, reason: 'Contract is paused — minting/burning disabled' };
    }
    // Check if minting is enabled
    if (!state.mintingEnabled) {
      return { allowed: false, reason: 'Minting is currently disabled' };
    }
    return { allowed: true, reason: null };
  }

  // Manual controls
  const manualMint = useCallback(async (amount: string, to: string, operator: string): Promise<boolean> => {
    const sync = canExecuteMintBurn();
    if (!sync.allowed) {
      addAlert({
        type: 'mint-halted',
        severity: 'warning',
        message: `Mint rejected: ${sync.reason}`,
        data: { amount, to, operator },
      });
      return false;
    }

    let txHash: string | undefined;
    if (isConnected && signer && address) {
      try {
        const contract = getContract();
        if (contract) {
          const decimals = await contract.decimals().catch(() => 18);
          const parsed = ethers.parseUnits(amount, decimals);
          const tx = await contract.mint(to, parsed);
          const receipt = await tx.wait();
          txHash = receipt?.hash || tx.hash;
        }
      } catch (e: any) {
        addAlert({
          type: 'mint-halted',
          severity: 'warning',
          message: `On-chain mint failed: ${e?.reason || e?.message || 'unknown error'}`,
          data: { amount, to, operator },
        });
        return false;
      }
    }

    const event: MintBurnEvent = {
      id: generateId(),
      type: 'mint',
      amount,
      toOrFrom: to,
      trigger: 'manual',
      timestamp: new Date().toISOString(),
      operator,
      pegPriceAtExecution: state.currentPrice,
      status: 'confirmed',
      txHash,
    };
    addMintEvent(event);
    addAlert({
      type: 'mint-halted',
      severity: 'info',
      message: `Manual mint: ${formatNumber(amount)} TFUSD to ${to}${txHash ? ` (tx: ${txHash.slice(0, 10)}...)` : ''}`,
      data: { amount, to, operator, txHash },
    });
    addAuditEntry({
      action: 'manual-mint',
      actor: operator,
      role: 'minter',
      details: `Mint ${amount} TFUSD to ${to}${txHash ? ` tx:${txHash}` : ''}`,
      timestamp: new Date().toISOString(),
    });
    return true;
  }, [state.currentPrice, addMintEvent, addAlert, isConnected, signer, address, getContract]);

  const manualBurn = useCallback(async (amount: string, operator: string): Promise<boolean> => {
    const sync = canExecuteMintBurn();
    if (!sync.allowed) {
      addAlert({
        type: 'mint-halted',
        severity: 'warning',
        message: `Burn rejected: ${sync.reason}`,
        data: { amount, operator },
      });
      return false;
    }

    let txHash: string | undefined;
    if (isConnected && signer && address) {
      try {
        const contract = getContract();
        if (contract) {
          const decimals = await contract.decimals().catch(() => 18);
          const parsed = ethers.parseUnits(amount, decimals);
          const tx = await contract.burn(parsed);
          const receipt = await tx.wait();
          txHash = receipt?.hash || tx.hash;
        }
      } catch (e: any) {
        addAlert({
          type: 'mint-halted',
          severity: 'warning',
          message: `On-chain burn failed: ${e?.reason || e?.message || 'unknown error'}`,
          data: { amount, operator },
        });
        return false;
      }
    }

    const event: MintBurnEvent = {
      id: generateId(),
      type: 'burn',
      amount,
      trigger: 'manual',
      timestamp: new Date().toISOString(),
      operator,
      pegPriceAtExecution: state.currentPrice,
      status: 'confirmed',
      txHash,
    };
    addBurnEvent(event);
    addAlert({
      type: 'mint-halted',
      severity: 'info',
      message: `Manual burn: ${formatNumber(amount)} TFUSD${txHash ? ` (tx: ${txHash.slice(0, 10)}...)` : ''}`,
      data: { amount, operator, txHash },
    });
    addAuditEntry({
      action: 'manual-burn',
      actor: operator,
      role: 'minter',
      details: `Burn ${amount} TFUSD${txHash ? ` tx:${txHash}` : ''}`,
      timestamp: new Date().toISOString(),
    });
    return true;
  }, [state.currentPrice, addBurnEvent, addAlert, isConnected, signer, address, getContract]);

  const replenishPool = useCallback(async (amount: string, operator: string): Promise<boolean> => {
    const adminState = loadAdminState();
    const anyOffline = Object.values(adminState.dons).some((don) => !don.active);
    if (anyOffline) {
      addAlert({
        type: 'pool-low',
        severity: 'warning',
        message: `Pool replenish rejected: one or more DONs are offline`,
        data: { amount, operator },
      });
      return false;
    }
    setState((prev) => {
      const newBalance = (parseFloat(prev.pool.balance) + parseFloat(amount)).toString();
      const newHistory = [
        { timestamp: new Date().toISOString(), amount, trigger: 'manual' },
        ...prev.pool.replenishHistory,
      ].slice(0, 100);
      saveReplenishHistory(newHistory);
      return {
        ...prev,
        pool: {
          ...prev.pool,
          balance: newBalance,
          health: calculatePoolHealth(parseFloat(newBalance), parseFloat(prev.pool.target)),
          lastReplenishAt: new Date().toISOString(),
          replenishHistory: newHistory,
        },
      };
    });
    addAlert({
      type: 'auto-replenish',
      severity: 'info',
      message: `Pool replenished with ${formatNumber(amount)} TFUSD by ${operator}`,
      data: { amount, operator },
    });
    addAuditEntry({
      action: 'manual-replenish',
      actor: operator,
      role: 'guardian',
      details: `Replenish pool with ${amount} TFUSD`,
      timestamp: new Date().toISOString(),
    });
    return true;
  }, [addAlert]);

  const emergencyPause = useCallback(async (operator: string) => {
    let txHash: string | undefined;
    if (isConnected && signer) {
      try {
        const contract = getContract();
        if (contract) {
          const tx = await contract.pause();
          const receipt = await tx.wait();
          txHash = receipt?.hash || tx.hash;
        }
      } catch (e: any) {
        addAlert({
          type: 'contract-paused',
          severity: 'warning',
          message: `On-chain pause failed: ${e?.reason || e?.message || 'unknown error'}`,
          data: { operator },
        });
        return;
      }
    }
    setState((prev) => ({
      ...prev,
      paused: true,
      mintingEnabled: false,
      burningEnabled: false,
    }));
    addAlert({
      type: 'contract-paused',
      severity: 'critical',
      message: `EMERGENCY PAUSE executed by ${operator}. All minting and burning halted.${txHash ? ` (tx: ${txHash.slice(0, 10)}...)` : ''}`,
      data: { operator, txHash },
    });
    addAuditEntry({
      action: 'emergency-pause',
      actor: operator,
      role: 'guardian',
      details: `Emergency contract pause executed${txHash ? ` tx:${txHash}` : ''}`,
      timestamp: new Date().toISOString(),
    });
  }, [addAlert, isConnected, signer, getContract]);

  const emergencyUnpause = useCallback(async (operator: string) => {
    let txHash: string | undefined;
    if (isConnected && signer) {
      try {
        const contract = getContract();
        if (contract) {
          const tx = await contract.unpause();
          const receipt = await tx.wait();
          txHash = receipt?.hash || tx.hash;
        }
      } catch (e: any) {
        addAlert({
          type: 'contract-paused',
          severity: 'warning',
          message: `On-chain unpause failed: ${e?.reason || e?.message || 'unknown error'}`,
          data: { operator },
        });
        return;
      }
    }
    setState((prev) => ({
      ...prev,
      paused: false,
      mintingEnabled: true,
      burningEnabled: true,
    }));
    addAlert({
      type: 'contract-paused',
      severity: 'info',
      message: `Contract unpaused by ${operator}. Operations resumed.${txHash ? ` (tx: ${txHash.slice(0, 10)}...)` : ''}`,
      data: { operator, txHash },
    });
    addAuditEntry({
      action: 'emergency-unpause',
      actor: operator,
      role: 'guardian',
      details: `Contract unpaused${txHash ? ` tx:${txHash}` : ''}`,
      timestamp: new Date().toISOString(),
    });
  }, [addAlert, isConnected, signer, getContract]);

  // Reset state when the active network changes
  useEffect(() => {
    setState(getDefaultState(networkConfig));
    refreshData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkConfig.key]);

  // Polling effect
  useEffect(() => {
    refreshData();
    intervalRef.current = window.setInterval(refreshData, networkConfig.pricePollInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshData, networkConfig.pricePollInterval, networkConfig.key]);

  // DON sync polling: disable minting if any DON offline
  useEffect(() => {
    const checkDons = () => {
      const adminState = loadAdminState();
      const anyOffline = Object.values(adminState.dons).some((don) => !don.active);
      setState((prev) => {
        if (anyOffline && prev.mintingEnabled) {
          return { ...prev, mintingEnabled: false, burningEnabled: false };
        }
        if (!anyOffline && !prev.mintingEnabled && !prev.paused) {
          return { ...prev, mintingEnabled: true, burningEnabled: true };
        }
        return prev;
      });
    };
    checkDons();
    const donInterval = window.setInterval(checkDons, 15000); // every 15s
    return () => clearInterval(donInterval);
  }, []);

  // Sync with admin DAO params changes
  useEffect(() => {
    const handleStorage = () => {
      const adminState = loadAdminState();
      setState((prev) => ({
        ...prev,
        depegThreshold: adminState.daoParams.depegThreshold,
        positiveDepegThreshold: adminState.daoParams.positiveDepegThreshold,
        criticalDepegThreshold: adminState.daoParams.criticalDepegThreshold,
        autoMintOnDepeg: adminState.daoParams.autoMintOnDepeg,
        autoBurnOnPositiveDepeg: adminState.daoParams.autoBurnOnPositiveDepeg,
        autoReplenishPool: adminState.daoParams.autoReplenishPool,
        maxAutoMintAmount: adminState.daoParams.maxAutoMintAmount,
        maxAutoBurnAmount: adminState.daoParams.maxAutoBurnAmount,
      }));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return (
    <MyUSDContext.Provider
      value={{
        state,
        acknowledgeAlert,
        acknowledgeAllAlerts,
        addAlert,
        manualMint,
        manualBurn,
        replenishPool,
        emergencyPause,
        emergencyUnpause,
        refreshData,
      }}
    >
      {children}
    </MyUSDContext.Provider>
  );
}

export function useMyUSD() {
  const ctx = useContext(MyUSDContext);
  if (!ctx) throw new Error('useMyUSD must be used within MyUSDProvider');
  return ctx;
}
