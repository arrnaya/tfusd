// Treasury + collateral configuration per network.
// Set NEXT_PUBLIC_TREASURY_ADDRESS to the proxy address deployed on each chain.
// Collateral addresses are canonical mainnet stablecoins.

import { type NetworkKey, NETWORKS } from './myusd-config';

export const TFUSD_CONTRACT_ADDRESS = NETWORKS['bsc-mainnet'].contractAddress;

export interface CollateralToken {
  symbol: string;
  address: string;
  decimals: number;
  icon: string;
}

export interface TreasuryNetworkConfig {
  treasuryAddress: string;
  tfusdAddress: string;
  collaterals: CollateralToken[];
}

const env = (key: string, fallback: string): string => process.env[key] || fallback;

export const TREASURY_NETWORKS: Record<NetworkKey, TreasuryNetworkConfig> = {
  'bsc-mainnet': {
    treasuryAddress: env('NEXT_PUBLIC_TREASURY_ADDRESS_BSC', '0x0000000000000000000000000000000000000000'),
    tfusdAddress: NETWORKS['bsc-mainnet'].contractAddress,
    collaterals: [
      {
        symbol: 'USDT',
        address: '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18,
        icon: '💲',
      },
      {
        symbol: 'USDC',
        address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        decimals: 18,
        icon: '💵',
      },
    ],
  },
  ethereum: {
    treasuryAddress: env('NEXT_PUBLIC_TREASURY_ADDRESS_ETHEREUM', '0x0000000000000000000000000000000000000000'),
    tfusdAddress: NETWORKS.ethereum.contractAddress,
    collaterals: [
      {
        symbol: 'USDT',
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
        icon: '💲',
      },
      {
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6,
        icon: '💵',
      },
    ],
  },
  polygon: {
    treasuryAddress: env('NEXT_PUBLIC_TREASURY_ADDRESS_POLYGON', '0x0000000000000000000000000000000000000000'),
    tfusdAddress: NETWORKS.polygon.contractAddress,
    collaterals: [
      {
        symbol: 'USDT',
        address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        decimals: 6,
        icon: '💲',
      },
      {
        symbol: 'USDC',
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        decimals: 6,
        icon: '💵',
      },
    ],
  },
};

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address sender, address recipient, uint256 amount) returns (bool)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
] as const;

export function getTreasuryConfig(networkKey: NetworkKey): TreasuryNetworkConfig {
  return TREASURY_NETWORKS[networkKey] ?? TREASURY_NETWORKS['bsc-mainnet'];
}

export function formatUnits(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, -decimals) || '0';
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

export function parseUnits(value: string, decimals: number): bigint {
  const [int = '0', frac = ''] = value.split('.');
  const cleanFrac = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(int) * BigInt(10 ** decimals) + BigInt(cleanFrac);
}
