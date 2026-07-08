// Treuhand Finanzgruppe USD (TFUSD) Stablecoin Contract Configuration
// Multi-network configuration. Add new deployed networks here and the UI will
// automatically list them in the network switcher.

export type NetworkKey = 'bsc-mainnet' | 'bsc-testnet' | 'ethereum' | 'polygon';

export interface NetworkConfig {
  key: NetworkKey;
  name: string;
  shortName: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  decimals: number;
  currency: string;
  symbol: string;
  nameToken: string;
  contractAddress: string;
  daoAddress: string;
  poolAddress: string;
  poolTargetBalance: string;
  geckoNetwork?: string;
  geckoPoolAddress?: string;
  geckoTokenAddress?: string;
  pricePollInterval: number;
  isTestnet: boolean;
}

// Helper so a single env var can be used as a fallback without repeating logic.
const env = (key: string, fallback: string): string => process.env[key] || fallback;

// The same CREATE3 deterministic addresses are used on every chain.
const TFUSD_CONTRACT_ADDRESS = env('NEXT_PUBLIC_TFUSD_CONTRACT', '0x1794F2bb542c28c4Cf14872c39C2E31f740dd102');
const DAO_CONTRACT_ADDRESS = env('NEXT_PUBLIC_DAO_CONTRACT', '0x441db754421AA93C7441732bf37FdA4e61b252e3');

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  'bsc-testnet': {
    key: 'bsc-testnet',
    name: 'BSC Testnet',
    shortName: 'BSC Testnet',
    chainId: 97,
    rpcUrl: env('NEXT_PUBLIC_BSC_TESTNET_RPC', 'https://bsc-testnet-rpc.publicnode.com'),
    explorerUrl: 'https://testnet.bscscan.com',
    decimals: 18,
    currency: 'USD',
    symbol: 'TFUSD',
    nameToken: 'Treuhand Finanzgruppe USD',
    contractAddress: env('NEXT_PUBLIC_TFUSD_CONTRACT_TESTNET', '0x12d7bf12dF9A59f8494f6b8899BC434d59a965AC'),
    daoAddress: env('NEXT_PUBLIC_DAO_CONTRACT_TESTNET', '0x7A60547269b245e8D430bb101f531bEBe164CDB7'),
    poolAddress: env('NEXT_PUBLIC_POOL_CONTRACT_BSC_TESTNET', '0x0000000000000000000000000000000000000000'),
    poolTargetBalance: '1000000000',
    geckoNetwork: env('NEXT_PUBLIC_GECKO_NETWORK_BSC_TESTNET', 'bsc'),
    geckoPoolAddress: env('NEXT_PUBLIC_GECKO_POOL_BSC_TESTNET', ''),
    geckoTokenAddress: env('NEXT_PUBLIC_GECKO_TOKEN_BSC_TESTNET', ''),
    pricePollInterval: 30000,
    isTestnet: true,
  },
  'bsc-mainnet': {
    key: 'bsc-mainnet',
    name: 'BSC Mainnet',
    shortName: 'BSC',
    chainId: 56,
    rpcUrl: env('NEXT_PUBLIC_BSC_MAINNET_RPC', 'https://bsc-rpc.publicnode.com'),
    explorerUrl: 'https://bscscan.com',
    decimals: 18,
    currency: 'USD',
    symbol: 'TFUSD',
    nameToken: 'Treuhand Finanzgruppe USD',
    contractAddress: TFUSD_CONTRACT_ADDRESS,
    daoAddress: DAO_CONTRACT_ADDRESS,
    poolAddress: env(
      'NEXT_PUBLIC_POOL_CONTRACT_BSC_MAINNET',
      '0x92e6f8a2a99a86c44d44461693231d091084c7b1ec4f2372c352893caeb4aa84'
    ),
    poolTargetBalance: '1000000000',
    geckoNetwork: env('NEXT_PUBLIC_GECKO_NETWORK_BSC_MAINNET', 'bsc'),
    geckoPoolAddress: env(
      'NEXT_PUBLIC_GECKO_POOL_BSC_MAINNET',
      '0x92e6f8a2a99a86c44d44461693231d091084c7b1ec4f2372c352893caeb4aa84'
    ),
    geckoTokenAddress: env('NEXT_PUBLIC_GECKO_TOKEN_BSC_MAINNET', TFUSD_CONTRACT_ADDRESS),
    pricePollInterval: 30000,
    isTestnet: false,
  },
  // Cross-chain mainnet networks share the same CREATE3 deterministic addresses.
  ethereum: {
    key: 'ethereum',
    name: 'Ethereum Mainnet',
    shortName: 'Ethereum',
    chainId: 1,
    rpcUrl: env('NEXT_PUBLIC_ETHEREUM_RPC', 'https://ethereum-rpc.publicnode.com'),
    explorerUrl: 'https://etherscan.io',
    decimals: 18,
    currency: 'USD',
    symbol: 'TFUSD',
    nameToken: 'Treuhand Finanzgruppe USD',
    contractAddress: TFUSD_CONTRACT_ADDRESS,
    daoAddress: DAO_CONTRACT_ADDRESS,
    poolAddress: env('NEXT_PUBLIC_POOL_CONTRACT_ETHEREUM', '0x0000000000000000000000000000000000000000'),
    poolTargetBalance: '1000000000',
    geckoNetwork: env('NEXT_PUBLIC_GECKO_NETWORK_ETHEREUM', 'eth'),
    geckoPoolAddress: env('NEXT_PUBLIC_GECKO_POOL_ETHEREUM', ''),
    geckoTokenAddress: env('NEXT_PUBLIC_GECKO_TOKEN_ETHEREUM', ''),
    pricePollInterval: 30000,
    isTestnet: false,
  },
  polygon: {
    key: 'polygon',
    name: 'Polygon PoS',
    shortName: 'Polygon',
    chainId: 137,
    rpcUrl: env('NEXT_PUBLIC_POLYGON_RPC', 'https://polygon-bor-rpc.publicnode.com'),
    explorerUrl: 'https://polygonscan.com',
    decimals: 18,
    currency: 'USD',
    symbol: 'TFUSD',
    nameToken: 'Treuhand Finanzgruppe USD',
    contractAddress: TFUSD_CONTRACT_ADDRESS,
    daoAddress: DAO_CONTRACT_ADDRESS,
    poolAddress: env('NEXT_PUBLIC_POOL_CONTRACT_POLYGON', '0x0000000000000000000000000000000000000000'),
    poolTargetBalance: '1000000000',
    geckoNetwork: env('NEXT_PUBLIC_GECKO_NETWORK_POLYGON', 'polygon_pos'),
    geckoPoolAddress: env('NEXT_PUBLIC_GECKO_POOL_POLYGON', ''),
    geckoTokenAddress: env('NEXT_PUBLIC_GECKO_TOKEN_POLYGON', ''),
    pricePollInterval: 30000,
    isTestnet: false,
  },
};

export const NETWORK_KEYS: NetworkKey[] = Object.keys(NETWORKS) as NetworkKey[];
export const DEFAULT_NETWORK_KEY: NetworkKey = 'bsc-testnet';

export function getNetworkConfig(key: NetworkKey): NetworkConfig {
  return NETWORKS[key] ?? NETWORKS[DEFAULT_NETWORK_KEY];
}

// Backward-compatible default config (BSC Testnet) for code that has not yet
// been migrated to the NetworkContext.
export const TFUSD_CONFIG = NETWORKS['bsc-testnet'];
export const MYUSD_CONFIG = TFUSD_CONFIG;

// Default DAO governance parameters
export const DEFAULT_DAO_PARAMS = {
  depegThreshold: 0.995,
  positiveDepegThreshold: 1.005,
  criticalDepegThreshold: 0.98,
  poolReplenishThreshold: 0.5,
  autoMintOnDepeg: true,
  autoBurnOnPositiveDepeg: true,
  autoReplenishPool: true,
  maxAutoMintAmount: '100000000',
  maxAutoBurnAmount: '100000000',
  mintPauseDurationMinutes: 60,
  guardianQuorum: 2,
  proposalTimelockHours: 24,
  votingPeriodHours: 72,
};

export type DAOParams = typeof DEFAULT_DAO_PARAMS;

export enum TFUSDRole {
  VIEWER = 'viewer',
  OPERATOR = 'operator',
  MINTER = 'minter',
  GUARDIAN = 'guardian',
  ADMIN = 'admin',
}

export const MyUSDRole = TFUSDRole;

export const ROLE_PERMISSIONS: Record<TFUSDRole, string[]> = {
  [TFUSDRole.VIEWER]: ['view:dashboard', 'view:supply', 'view:dao'],
  [TFUSDRole.OPERATOR]: ['view:dashboard', 'view:supply', 'view:dao', 'ack:alerts', 'view:history'],
  [TFUSDRole.MINTER]: ['view:dashboard', 'view:supply', 'view:dao', 'ack:alerts', 'view:history', 'action:mint', 'action:burn'],
  [TFUSDRole.GUARDIAN]: ['view:dashboard', 'view:supply', 'view:dao', 'ack:alerts', 'view:history', 'action:mint', 'action:burn', 'config:params', 'config:thresholds', 'action:replenish', 'action:emergency-pause'],
  [TFUSDRole.ADMIN]: ['*'],
};

export function hasPermission(role: TFUSDRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}
