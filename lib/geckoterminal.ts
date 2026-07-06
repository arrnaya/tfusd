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
  };
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

    return {
      price: parseFloat(attrs.base_token_price_usd) || 0,
      priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
      marketCap: attrs.market_cap_usd ? parseFloat(attrs.market_cap_usd) : null,
      fdv: parseFloat(attrs.fdv_usd) || 0,
      volume24h: parseFloat(attrs.volume_usd?.h24) || 0,
      reserveUsd: parseFloat(attrs.reserve_in_usd) || 0,
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
  aggregate: number = 1
): Promise<PricePoint[] | null> {
  try {
    const url = `${GECKO_BASE}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=100`;
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
