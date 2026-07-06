'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  type NetworkKey,
  type NetworkConfig,
  DEFAULT_NETWORK_KEY,
  getNetworkConfig,
  NETWORKS,
} from '@/lib/myusd-config';

export type HeaderNetworkKey = NetworkKey | 'combined';

interface NetworkContextType {
  networkKey: HeaderNetworkKey;
  networkConfig: NetworkConfig;
  setNetwork: (key: HeaderNetworkKey) => void;
  isDeployed: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

const STORAGE_KEY = 'tfusd_selected_network';

const COMBINED_CONFIG: NetworkConfig = {
  ...NETWORKS['bsc-mainnet'],
  key: 'combined' as NetworkKey,
  name: 'Combined',
  shortName: 'Combined',
};

function resolveNetworkConfig(key: HeaderNetworkKey): NetworkConfig {
  if (key === 'combined') return COMBINED_CONFIG;
  return getNetworkConfig(key);
}

function loadSavedNetwork(): HeaderNetworkKey | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return raw as HeaderNetworkKey;
  } catch {
    return null;
  }
}

function saveNetwork(key: HeaderNetworkKey) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {}
}

function isValidNetworkKey(key: string): key is HeaderNetworkKey {
  return ['combined', 'bsc-mainnet', 'ethereum', 'polygon'].includes(key);
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [networkKey, setNetworkKeyState] = useState<HeaderNetworkKey>(DEFAULT_NETWORK_KEY);

  useEffect(() => {
    const saved = loadSavedNetwork();
    if (saved && isValidNetworkKey(saved)) {
      setNetworkKeyState(saved);
    }
  }, []);

  const setNetwork = useCallback((key: HeaderNetworkKey) => {
    setNetworkKeyState(key);
    saveNetwork(key);
  }, []);

  const networkConfig = resolveNetworkConfig(networkKey);
  const isDeployed = networkConfig.contractAddress !== '0x0000000000000000000000000000000000000000';

  return (
    <NetworkContext.Provider value={{ networkKey, networkConfig, setNetwork, isDeployed }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextType {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}
