// Cross-chain total supply aggregation for Treuhand Finanzgruppe USD (TFUSD).
// Queries totalSupply() on every configured network and returns the sum in
// token-decimal units (e.g. "1234.5" for 18-decimal contracts).

import { ethers } from 'ethers';
import { NETWORKS, type NetworkKey } from './myusd-config';
import { TFUSD_ABI } from './contract-abi';

const RPC_TIMEOUT_MS = 10000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Scanning every block from genesis is too heavy on public RPCs. We look back
// a configurable window and paginate getLogs requests to avoid range limits.
const MINTED_BURNED_LOOKBACK_BLOCKS = 50_000;
const MINTED_BURNED_CHUNK_SIZE = 5_000;

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

export interface CrossChainMintedBurnedResult {
  /** Aggregated minted supply across all reachable networks (token units). */
  minted: string;
  /** Aggregated minted supply as raw uint256 (base units). */
  mintedRaw: bigint;
  /** Aggregated burned supply across all reachable networks (token units). */
  burned: string;
  /** Aggregated burned supply as raw uint256 (base units). */
  burnedRaw: bigint;
  /** Per-network minted values (token units), only for successful calls. */
  perNetworkMinted: Partial<Record<NetworkKey, string>>;
  /** Per-network minted values (base units), only for successful calls. */
  perNetworkMintedRaw: Partial<Record<NetworkKey, bigint>>;
  /** Per-network burned values (token units), only for successful calls. */
  perNetworkBurned: Partial<Record<NetworkKey, string>>;
  /** Per-network burned values (base units), only for successful calls. */
  perNetworkBurnedRaw: Partial<Record<NetworkKey, bigint>>;
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

/**
 * Fetch aggregated minted and burned TFUSD supply across all configured networks.
 *
 * Minted = sum of all Transfer events from 0x0 (minting).
 * Burned = sum of all Transfer events to 0x0 (burning).
 *
 * Failures for individual networks are captured in errors. If no network can be
 * reached, returns null.
 */
async function fetchNetworkMintedBurned(
  key: NetworkKey,
  address: string
): Promise<{ mintedRaw: bigint; burnedRaw: bigint }> {
  const config = NETWORKS[key];
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, {
    staticNetwork: true,
  });
  const contract = new ethers.Contract(address, TFUSD_ABI, provider);

  const currentBlock = await withTimeout(provider.getBlockNumber(), RPC_TIMEOUT_MS);
  const minBlock = Math.max(0, currentBlock - MINTED_BURNED_LOOKBACK_BLOCKS);

  const mintFilter = contract.filters.Transfer(ZERO_ADDRESS, null);
  const burnFilter = contract.filters.Transfer(null, ZERO_ADDRESS);

  let mintedRaw = BigInt(0);
  let burnedRaw = BigInt(0);

  for (let from = minBlock; from <= currentBlock; from += MINTED_BURNED_CHUNK_SIZE) {
    const to = Math.min(currentBlock, from + MINTED_BURNED_CHUNK_SIZE - 1);
    const [mintEvents, burnEvents] = await withTimeout(
      Promise.all([
        contract.queryFilter(mintFilter, from, to),
        contract.queryFilter(burnFilter, from, to),
      ]),
      RPC_TIMEOUT_MS
    );
    for (const ev of mintEvents) {
      const amount = (ev as ethers.EventLog).args?.[2];
      if (amount) mintedRaw += BigInt(amount.toString());
    }
    for (const ev of burnEvents) {
      const amount = (ev as ethers.EventLog).args?.[2];
      if (amount) burnedRaw += BigInt(amount.toString());
    }
  }

  return { mintedRaw, burnedRaw };
}

export async function fetchCrossChainMintedBurned(
  tokenAddress?: string
): Promise<CrossChainMintedBurnedResult | null> {
  const address = tokenAddress || NETWORKS['bsc-mainnet'].contractAddress;
  const networkKeys = Object.keys(NETWORKS) as NetworkKey[];

  const results = await Promise.allSettled(
    networkKeys.map((key) => fetchNetworkMintedBurned(key, address))
  );

  let totalMintedRaw = BigInt(0);
  let totalBurnedRaw = BigInt(0);
  const perNetworkMinted: Partial<Record<NetworkKey, string>> = {};
  const perNetworkMintedRaw: Partial<Record<NetworkKey, bigint>> = {};
  const perNetworkBurned: Partial<Record<NetworkKey, string>> = {};
  const perNetworkBurnedRaw: Partial<Record<NetworkKey, bigint>> = {};
  const succeeded: NetworkKey[] = [];
  const errors: Partial<Record<NetworkKey, string>> = {};

  results.forEach((result, index) => {
    const key = networkKeys[index];
    if (result.status === 'fulfilled') {
      const { mintedRaw, burnedRaw } = result.value;
      totalMintedRaw += mintedRaw;
      totalBurnedRaw += burnedRaw;
      perNetworkMintedRaw[key] = mintedRaw;
      perNetworkBurnedRaw[key] = burnedRaw;
      perNetworkMinted[key] = ethers.formatUnits(mintedRaw, NETWORKS[key].decimals);
      perNetworkBurned[key] = ethers.formatUnits(burnedRaw, NETWORKS[key].decimals);
      succeeded.push(key);
    } else {
      const message =
        result.reason?.message || result.reason?.toString() || 'unknown error';
      errors[key] = message;
    }
  });

  // If we couldn't scan the main BSC network, the aggregated result is
  // incomplete, so treat it as a failure and let the caller fall back.
  if (!succeeded.includes('bsc-mainnet')) {
    return null;
  }

  return {
    minted: ethers.formatUnits(totalMintedRaw, 18),
    mintedRaw: totalMintedRaw,
    burned: ethers.formatUnits(totalBurnedRaw, 18),
    burnedRaw: totalBurnedRaw,
    perNetworkMinted,
    perNetworkMintedRaw,
    perNetworkBurned,
    perNetworkBurnedRaw,
    succeeded,
    errors,
  };
}
