/**
 * Live reserve conversion utilities.
 *
 * Reads the Euro cash reserve from /blackScreen.xml and the MAAL native-token
 * balance from the configured MAAL wallet, fetches EURC and MAAL USD prices from
 * CoinGecko, and returns the total reserve value in USD.
 */

const MAAL_RPC = 'https://node1-mainnet-new.maalscan.io';
const MAAL_WALLET = '0xC57E89Dda471f142eA3bB140eb7E7dd4f81039eC';
const BLACKSCREEN_XML_URL = '/blackScreen.xml';
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=euro-coin,maal-chain&vs_currencies=usd';
const PRICE_CACHE_KEY = 'tfusd_reserve_prices';
const PRICE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — CoinGecko free-tier friendly

// Fallback prices if CoinGecko is unreachable/CORS-blocked.
const FALLBACK_PRICES = {
  'euro-coin': { usd: 1.14 },
  'maal-chain': { usd: 0.168 },
};

interface CachedPrices {
  prices: CoinGeckoPrices;
  timestamp: number;
}

function loadCachedPrices(): CachedPrices | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPrices;
    if (!parsed.prices || typeof parsed.timestamp !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedPrices(prices: CoinGeckoPrices) {
  if (typeof window === 'undefined') return;
  try {
    const payload: CachedPrices = { prices, timestamp: Date.now() };
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

export interface LiveReserveData {
  euroAmount: number;
  maalAmount: number;
  eurcUsd: number;
  maalUsd: number;
  totalUsd: number;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
}

function hexToDec(hex: string): number {
  return parseInt(hex, 16);
}

function weiToMaal(weiHex: string): number {
  return hexToDec(weiHex) / 1e18;
}

export async function fetchMaalBalance(): Promise<number | null> {
  try {
    const response = await fetch(MAAL_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [MAAL_WALLET, 'latest'],
        id: 1,
      }),
    });
    const data = await response.json();
    if (data.result) return weiToMaal(data.result);
    return null;
  } catch {
    return null;
  }
}

export async function fetchBlackScreenEuroAmount(): Promise<number | null> {
  try {
    const response = await fetch(BLACKSCREEN_XML_URL);
    const xmlText = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const raw =
      doc.querySelector('MessageHeader Amount')?.textContent?.trim() ||
      doc.querySelector('UploadStatus Amount')?.textContent?.trim() ||
      '';
    if (!raw) return null;
    return parseFloat(raw.replace(/,/g, ''));
  } catch {
    return null;
  }
}

export interface CoinGeckoPrices {
  'euro-coin': { usd: number };
  'maal-chain': { usd: number };
}

export async function fetchCoinGeckoPrices(): Promise<CoinGeckoPrices> {
  const cached = loadCachedPrices();
  if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS) {
    return cached.prices;
  }

  try {
    const response = await fetch(COINGECKO_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: CoinGeckoPrices = await response.json();
    const prices = {
      'euro-coin': { usd: data['euro-coin']?.usd ?? FALLBACK_PRICES['euro-coin'].usd },
      'maal-chain': { usd: data['maal-chain']?.usd ?? FALLBACK_PRICES['maal-chain'].usd },
    };
    saveCachedPrices(prices);
    return prices;
  } catch {
    // If we have a stale cache, use it; otherwise fall back to hardcoded values.
    if (cached) return cached.prices;
    return FALLBACK_PRICES;
  }
}

export async function fetchLiveReserves(): Promise<Omit<LiveReserveData, 'loading'>> {
  const [euroAmount, maalAmount, prices] = await Promise.all([
    fetchBlackScreenEuroAmount(),
    fetchMaalBalance(),
    fetchCoinGeckoPrices(),
  ]);

  const eurcUsd = prices['euro-coin'].usd;
  const maalUsd = prices['maal-chain'].usd;
  const euroUsd = (euroAmount ?? 0) * eurcUsd;
  const maalTotalUsd = (maalAmount ?? 0) * maalUsd;
  const totalUsd = euroUsd + maalTotalUsd;

  const error = euroAmount === null && maalAmount === null ? 'Unable to fetch reserve data' : null;

  return {
    euroAmount: euroAmount ?? 0,
    maalAmount: maalAmount ?? 0,
    eurcUsd,
    maalUsd,
    totalUsd,
    error,
    lastUpdated: new Date().toISOString(),
  };
}
