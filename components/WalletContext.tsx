'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { useNetwork } from './NetworkContext';
import { type NetworkConfig } from '@/lib/myusd-config';

export interface EIP6963ProviderInfo {
  name: string;
  icon: string;
  rdns: string;
  uuid: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: any;
}

interface WalletContextType {
  provider: any | null;
  ethersProvider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  address: string | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  availableProviders: EIP6963ProviderDetail[];
  connect: () => Promise<void>;
  connectWalletConnect: () => Promise<void>;
  selectProvider: (detail: EIP6963ProviderDetail) => Promise<void>;
  dismissProviderSelection: () => void;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

function getWalletName(p: any): string {
  if (p.isTrust) return 'Trust Wallet';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isRabby) return 'Rabby';
  if (p.isPhantom) return 'Phantom';
  if (p.isMetaMask) return 'MetaMask';
  return 'Browser Wallet';
}

function getWalletRdns(p: any): string {
  if (p.isTrust) return 'com.trustwallet.app';
  if (p.isBraveWallet) return 'com.brave.wallet';
  if (p.isCoinbaseWallet) return 'com.coinbase.wallet';
  if (p.isRabby) return 'io.rabby';
  if (p.isPhantom) return 'app.phantom';
  if (p.isMetaMask) return 'io.metamask';
  return 'browser.wallet';
}

function chainIdToHex(chainId: number): string {
  return '0x' + chainId.toString(16);
}

async function switchToNetwork(browserProvider: any, config: NetworkConfig): Promise<void> {
  const chainIdHex = chainIdToHex(config.chainId);
  try {
    await browserProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError: any) {
    // 4902 = chain not added
    if (switchError?.code === 4902) {
      await browserProvider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: config.name,
            nativeCurrency: { name: config.currency, symbol: config.currency, decimals: config.decimals },
            rpcUrls: [config.rpcUrl],
            blockExplorerUrls: [config.explorerUrl],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { networkConfig } = useNetwork();

  const [provider, setProvider] = useState<any | null>(null);
  const [ethersProvider, setEthersProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<EIP6963ProviderDetail[]>([]);

  const reset = useCallback(() => {
    setProvider(null);
    setEthersProvider(null);
    setSigner(null);
    setAddress(null);
    setChainId(null);
    setIsConnected(false);
    setError(null);
  }, []);

  const updateState = useCallback(async (web3Provider: any) => {
    try {
      const browserProvider = new ethers.BrowserProvider(web3Provider);
      const newSigner = await browserProvider.getSigner();
      const newAddress = await newSigner.getAddress();
      const network = await browserProvider.getNetwork();

      setEthersProvider(browserProvider);
      setSigner(newSigner);
      setAddress(newAddress);
      setChainId(Number(network.chainId));
      setIsConnected(true);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to get wallet state');
      reset();
    }
  }, [reset]);

  const attachProviderListeners = useCallback((browserProvider: any) => {
    browserProvider.on('accountsChanged', (accounts: string[]) => {
      if (accounts.length === 0) {
        reset();
      } else {
        setAddress(accounts[0]);
      }
    });

    browserProvider.on('chainChanged', (chainIdHex: string) => {
      setChainId(parseInt(chainIdHex, 16));
    });

    browserProvider.on('disconnect', () => {
      reset();
    });
  }, [reset]);

  const discoverWallets = useCallback(async (): Promise<EIP6963ProviderDetail[]> => {
    if (typeof window === 'undefined') return [];

    const providers: EIP6963ProviderDetail[] = [];
    const seen = new Set<string>();

    const addProvider = (info: EIP6963ProviderInfo, p: any) => {
      const key = info.rdns || info.uuid || info.name;
      if (!key || seen.has(key)) return;
      seen.add(key);
      providers.push({ info, provider: p });
    };

    // EIP-6963 multi-wallet discovery
    const handler = (event: any) => {
      const detail = event?.detail;
      if (detail && detail.info && detail.provider) {
        addProvider(detail.info, detail.provider);
      }
    };
    window.addEventListener('eip6963:announceProvider', handler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    window.removeEventListener('eip6963:announceProvider', handler);

    // Legacy injected providers (MetaMask, Trust, Brave, etc.)
    const eth = (window as any).ethereum;
    if (eth) {
      const legacyProviders = eth.providers && Array.isArray(eth.providers) ? eth.providers : [eth];
      legacyProviders.forEach((p: any) => {
        const name = getWalletName(p);
        const rdns = getWalletRdns(p);
        addProvider({ name, icon: '', rdns, uuid: rdns }, p);
      });
    }

    setAvailableProviders(providers);
    return providers;
  }, []);

  const selectProvider = useCallback(async (detail: EIP6963ProviderDetail) => {
    setIsConnecting(true);
    setError(null);
    setAvailableProviders([]);
    try {
      const browserProvider = detail.provider;

      const accounts: string[] = await browserProvider.request({
        method: 'eth_requestAccounts',
      });

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts returned from wallet.');
      }

      await switchToNetwork(browserProvider, networkConfig);
      attachProviderListeners(browserProvider);
      setProvider(browserProvider);
      await updateState(browserProvider);
    } catch (e: any) {
      setError(e?.message || 'Wallet connection failed');
      reset();
    } finally {
      setIsConnecting(false);
    }
  }, [attachProviderListeners, updateState, reset, networkConfig]);

  const connectWalletConnect = useCallback(async () => {
    setAvailableProviders([]);
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    if (!projectId || projectId === 'YOUR_PROJECT_ID') {
      throw new Error('WalletConnect Project ID not configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env');
    }

    const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');
    const wcProvider = await EthereumProvider.init({
      projectId,
      chains: [networkConfig.chainId],
      showQrModal: true,
      methods: ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData'],
      events: ['chainChanged', 'accountsChanged'],
      metadata: {
        name: 'Treuhand Finanzgruppe USD Dashboard',
        description: 'TFUSD Decentralized Oracle Network',
        url: 'https://tfusd.io',
        icons: ['https://tfusd.io/logo.png'],
      },
    });

    await wcProvider.enable();

    wcProvider.on('accountsChanged', (accounts: string[]) => {
      if (accounts.length === 0) {
        reset();
      } else {
        setAddress(accounts[0]);
      }
    });

    wcProvider.on('chainChanged', (chainIdHex: string) => {
      setChainId(parseInt(chainIdHex, 16));
    });

    wcProvider.on('disconnect', () => {
      reset();
    });

    setProvider(wcProvider);
    await updateState(wcProvider);
  }, [reset, updateState, networkConfig]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const found = await discoverWallets();
      if (found.length === 0) {
        await connectWalletConnect();
      } else if (found.length === 1) {
        await selectProvider(found[0]);
      }
    } catch (e: any) {
      setError(e?.message || 'Wallet connection failed');
      reset();
    } finally {
      setIsConnecting(false);
    }
  }, [discoverWallets, connectWalletConnect, selectProvider, reset]);

  const dismissProviderSelection = useCallback(() => {
    setAvailableProviders([]);
    setIsConnecting(false);
  }, []);

  // If the user switches the target network while connected, ask the wallet to
  // switch to the matching chain (best-effort).
  useEffect(() => {
    if (!provider || !isConnected) return;
    if (provider.isWalletConnect) return; // WalletConnect sessions manage their own chain
    switchToNetwork(provider, networkConfig).catch(() => {
      // User may reject the switch; leave the mismatch visible in the UI.
    });
  }, [networkConfig.key, provider, isConnected, networkConfig]);

  const disconnect = useCallback(async () => {
    try {
      if (provider?.disconnect) {
        await provider.disconnect();
      }
    } catch {}
    reset();
  }, [provider, reset]);

  useEffect(() => {
    return () => {
      if (provider?.removeAllListeners) {
        provider.removeAllListeners();
      }
    };
  }, [provider]);

  return (
    <WalletContext.Provider
      value={{
        provider,
        ethersProvider,
        signer,
        address,
        chainId,
        isConnected,
        isConnecting,
        error,
        availableProviders,
        connect,
        connectWalletConnect,
        selectProvider,
        dismissProviderSelection,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
