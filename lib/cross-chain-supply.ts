// Cross-chain total supply aggregation for Treuhand Finanzgruppe USD (TFUSD).
// Queries totalSupply() on every configured network and returns the sum in
// token-decimal units (e.g. "1234.5" for 18-decimal contracts).

import { ethers } from 'ethers';
import { NETWORKS, type NetworkKey } from './myusd-config';
import { TFUSD_ABI } from './contract-abi';

const RPC_TIMEOUT_MS = 10000;

export interface CrossChainSupplyResult {
  /** Aggregated total supply across all reachable networks (token units). */
  totalSupply: string;
  /** Aggregated total supply as raw uint256 (base units). */
  totalSupplyRaw: bigint;
  /** Per-network supply values (token units), only for successful calls. */
  perNetwork: Partial<Record<NetworkKey, string>>;
  /** Per-network raw supply values (base units), only for successful calls. */
  perNetworkRaw: Partial<Record<NetworkKey, bigint>>;
  /** Networks whose RPC calls succeeded. */
  succeeded: NetworkKey[];
  /** Networks whose RPC calls failed, with a short error message. */
  errors: Partial<Record<NetworkKey, string>>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('RPC timeout')), ms)
    ),
  ]);
}

/**
 * Fetch the aggregated totalSupply() of the TFUSD token across all networks.
 * Failures for individual networks are captured in errors and do not abort the
 * aggregation. If no network can be reached, returns null.
 */
export async function fetchCrossChainTotalSupply(
  tokenAddress?: string
): Promise<CrossChainSupplyResult | null> {
  const address = tokenAddress || NETWORKS['bsc-mainnet'].contractAddress;
  const networkKeys = Object.keys(NETWORKS) as NetworkKey[];

  const results = await Promise.allSettled(
    networkKeys.map(async (key) => {
      const config = NETWORKS[key];
      const provider = new ethers.JsonRpcProvider(
        config.rpcUrl,
        config.chainId,
        { staticNetwork: true }
      );
      const contract = new ethers.Contract(address, TFUSD_ABI, provider);
      const raw = await withTimeout(contract.totalSupply(), RPC_TIMEOUT_MS);
      return { key, raw: BigInt(raw.toString()) };
    })
  );

  let totalSupplyRaw = BigInt(0);
  const perNetwork: Partial<Record<NetworkKey, string>> = {};
  const perNetworkRaw: Partial<Record<NetworkKey, bigint>> = {};
  const succeeded: NetworkKey[] = [];
  const errors: Partial<Record<NetworkKey, string>> = {};

  results.forEach((result, index) => {
    const key = networkKeys[index];
    if (result.status === 'fulfilled') {
      const raw = result.value.raw;
      totalSupplyRaw += raw;
      perNetwork[key] = ethers.formatUnits(raw, NETWORKS[key].decimals);
      perNetworkRaw[key] = raw;
      succeeded.push(key);
    } else {
      const message =
        result.reason?.message || result.reason?.toString() || 'unknown error';
      errors[key] = message;
    }
  });

  if (succeeded.length === 0) {
    return null;
  }

  return {
    totalSupply: ethers.formatUnits(totalSupplyRaw, 18),
    totalSupplyRaw,
    perNetwork,
    perNetworkRaw,
    succeeded,
    errors,
  };
}
