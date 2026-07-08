// GeckoTerminal API client for Treuhand Finanzgruppe USD (TFUSD) market data
// Public API: https://api.geckoterminal.com/api/v2
// No API key required for basic endpoints

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

export interface GeckoPriceResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      token_prices: Record<string, string>;
    };
  };
}

export interface GeckoPoolInfo {
  data: {
    id: string;
    type: string;
    attributes: {
      base_token_price_usd: string;
      quote_token_price_usd: string;
      fdv_usd: string;
      market_cap_usd: string | null;
      reserve_in_usd: string;
      volume_usd: {
        h24: string;
      };
      price_change_percentage: {
        h24: string;
      };
      transactions: {
        h24: {
          buys: number;
          sells: number;
          buyers: number;
          sellers: number;
        };
      };
    };
    relationships: {
      base_token: {
        data: {
          id: string;
          type: string;
        };
      };
      quote_token: {
        data: {
          id: string;
          type: string;
        };
      };
    };
  };
  included?: {
    id: string;
    type: string;
    attributes: {
      address: string;
      symbol?: string;
      name?: string;
    };
  }[];
}

export interface GeckoOHLCV {
  data: {
    id: string;
    type: string;
    attributes: {
      ohlcv_list: [number, string, string, string, string, string][]; // [timestamp, open, high, low, close, volume]
    };
  };
}

export interface MarketData {
  price: number;
  priceChange24h: number;
  marketCap: number | null;
  fdv: number;
  volume24h: number;
  reserveUsd: number;
  reserveToken0: number | null;
  reserveToken1: number | null;
  token0Address: string | null;
  token1Address: string | null;
  token0Symbol: string | null;
  token1Symbol: string | null;
  buys24h: number;
  sells24h: number;
  timestamp: string;
}

export interface PricePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchTokenPrice(network: string, tokenAddress: string): Promise<Record<string, string> | null> {
  try {
    const url = `${GECKO_BASE}/simple/networks/${network}/token_price/${tokenAddress}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json: GeckoPriceResponse = await res.json();
    return json.data?.attributes?.token_prices || null;
  } catch {
    return null;
  }
}

export async function fetchPoolInfo(network: string, poolAddress: string): Promise<MarketData | null> {
  try {
    const url = `${GECKO_BASE}/networks/${network}/pools/${poolAddress}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json: GeckoPoolInfo = await res.json();
    const attrs = json.data?.attributes;
    if (!attrs) return null;

    const basePrice = parseFloat(attrs.base_token_price_usd) || 0;
    const quotePrice = parseFloat(attrs.quote_token_price_usd) || 0;
    const reserveUsd = parseFloat(attrs.reserve_in_usd) || 0;

    // Approximate reserves from USD reserves assuming 50/50 USD split.
    const reserveToken0 = basePrice > 0 ? reserveUsd / 2 / basePrice : null;
    const reserveToken1 = quotePrice > 0 ? reserveUsd / 2 / quotePrice : null;

    // Token addresses/symbols from included relationship data.
    const included = json.included || [];
    const baseTokenId = json.data?.relationships?.base_token?.data?.id;
    const quoteTokenId = json.data?.relationships?.quote_token?.data?.id;
    const baseToken = included.find((t) => t.id === baseTokenId);
    const quoteToken = included.find((t) => t.id === quoteTokenId);

    return {
      price: basePrice,
      priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
      marketCap: attrs.market_cap_usd ? parseFloat(attrs.market_cap_usd) : null,
      fdv: parseFloat(attrs.fdv_usd) || 0,
      volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
      reserveUsd,
      reserveToken0,
      reserveToken1,
      token0Address: baseToken?.attributes?.address ?? null,
      token1Address: quoteToken?.attributes?.address ?? null,
      token0Symbol: baseToken?.attributes?.symbol ?? null,
      token1Symbol: quoteToken?.attributes?.symbol ?? null,
      buys24h: attrs.transactions?.h24?.buys || 0,
      sells24h: attrs.transactions?.h24?.sells || 0,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function fetchPoolOHLCV(
  network: string,
  poolAddress: string,
  timeframe: 'minute' | 'hour' | 'day' = 'hour',
  aggregate: number = 1,
  limit: number = 100
): Promise<PricePoint[] | null> {
  try {
    const url = `${GECKO_BASE}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json: GeckoOHLCV = await res.json();
    const list = json.data?.attributes?.ohlcv_list;
    if (!list || !Array.isArray(list)) return null;

    return list.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: timestamp * 1000,
      open: parseFloat(open) || 0,
      high: parseFloat(high) || 0,
      low: parseFloat(low) || 0,
      close: parseFloat(close) || 0,
      volume: parseFloat(volume) || 0,
    }));
  } catch {
    return null;
  }
}

export type PriceTimeframe = '24h' | '7d' | '1m' | '1y' | 'max';

export async function fetchPoolPriceHistory(
  network: string,
  poolAddress: string,
  timeframe: PriceTimeframe
): Promise<PricePoint[] | null> {
  switch (timeframe) {
    case '24h':
      return fetchPoolOHLCV(network, poolAddress, 'hour', 1, 24);
    case '7d':
      return fetchPoolOHLCV(network, poolAddress, 'hour', 1, 168);
    case '1m':
      return fetchPoolOHLCV(network, poolAddress, 'day', 1, 30);
    case '1y':
      return fetchPoolOHLCV(network, poolAddress, 'day', 1, 365);
    case 'max':
      return fetchPoolOHLCV(network, poolAddress, 'day', 1, 1000);
    default:
      return fetchPoolOHLCV(network, poolAddress, 'hour', 1, 24);
  }
}

export async function fetchTopPools(network: string, limit: number = 5): Promise<any[] | null> {
  try {
    const url = `${GECKO_BASE}/networks/${network}/pools?page=1&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

// Demo market data for fallback when GeckoTerminal is unavailable
export function getDemoMarketData(): MarketData {
  return {
    price: 1.0 + (Math.random() - 0.5) * 0.01,
    priceChange24h: (Math.random() - 0.5) * 2,
    marketCap: 500000000 + Math.random() * 100000000,
    fdv: 1000000000,
    volume24h: 5000000 + Math.random() * 5000000,
    reserveUsd: 80000000 + Math.random() * 20000000,
    reserveToken0: 40000000 + Math.random() * 10000000,
    reserveToken1: 40000000 + Math.random() * 10000000,
    token0Address: null,
    token1Address: null,
    token0Symbol: 'TFUSD',
    token1Symbol: 'USDC',
    buys24h: Math.floor(Math.random() * 500),
    sells24h: Math.floor(Math.random() * 500),
    timestamp: new Date().toISOString(),
  };
}

export function getDemoOHLCV(count: number = 50): PricePoint[] {
  const points: PricePoint[] = [];
  let price = 1.0;
  const now = Date.now();
  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.5) * 0.004;
    price += change;
    price = Math.max(0.98, Math.min(1.02, price)); // keep near peg
    const open = price - change;
    const high = Math.max(open, price) + Math.random() * 0.001;
    const low = Math.min(open, price) - Math.random() * 0.001;
    points.push({
      timestamp: now - i * 3600000,
      open,
      high,
      low,
      close: price,
      volume: 100000 + Math.random() * 500000,
    });
  }
  return points;
}
