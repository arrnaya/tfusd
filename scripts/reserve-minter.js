#!/usr/bin/env node
/**
 * =============================================================================
 * TFUSD Reserve Minter Agent
 * =============================================================================
 * Automated, MAAL-balance-driven mint/burn agent for Treuhand Finanzgruppe USD.
 *
 * Runs continuously (default every 15 s) and keeps the total TFUSD minted supply
 * pegged to 70 % of the live USD value of the MAAL reserve wallet, capped at
 * 500 M TFUSD across all deployed chains.
 *
 * Rules
 * -----
 * 1. Monitor the MAAL reserve wallet native balance.
 * 2. Fetch the live MAAL/USD price from CoinGecko (cached 60 s by default).
 * 3. Target minted supply = min(0.70 × MAAL USD value, 500 000 000).
 * 4. Compare target against the cross-chain totalSupply() (BSC + Ethereum + Polygon).
 * 5. Mint the shortfall on BSC Mainnet via mintByMaster() (requires MASTERMINTER_ROLE).
 * 6. Burn the surplus from the signer wallet when MAAL value drops.
 *
 * Environment
 * -----------
 * PRIVATE_KEY                     – signer that holds MASTERMINTER_ROLE
 * TFUSD_CONTRACT_ADDRESS          – TFUSD token address (default: new redeployed)
 * TFUSD_RESERVE_MINT_RECIPIENT    – mint recipient (defaults to signer)
 * BSC_MAINNET_RPC                 – BSC mainnet RPC (defaults to publicnode)
 * MAAL_RPC / MAAL_WALLET          – MAAL node + reserve wallet
 * RESERVE_MINTER_INTERVAL_MS      – poll interval (default 15 000 ms)
 * RESERVE_MINTER_DRY_RUN=true     – simulate, do not send transactions
 * RESERVE_MINTER_DISABLED=true    – monitor only, never mint/burn
 *
 * Run:
 *   node scripts/reserve-minter.js
 * =============================================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// ── Configuration ────────────────────────────────────────────────────────────
const MAAL_RPC = process.env.MAAL_RPC || 'https://node1-mainnet-new.maalscan.io';
const MAAL_WALLET = process.env.MAAL_WALLET || '0xC57E89Dda471f142eA3bB140eb7E7dd4f81039eC';
const COINGECKO_URL =
  process.env.COINGECKO_URL ||
  'https://api.coingecko.com/api/v3/simple/price?ids=euro-coin,maal-chain&vs_currencies=usd';

const BSC_RPC_URL =
  process.env.BSC_MAINNET_RPC || process.env.RPC_URL || 'https://bsc-rpc.publicnode.com';
const TFUSD_ADDRESS =
  process.env.TFUSD_CONTRACT_ADDRESS || '0x1794F2bb542c28c4Cf14872c39C2E31f740dd102';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RECIPIENT = process.env.TFUSD_RESERVE_MINT_RECIPIENT;

const POLL_INTERVAL_MS = parseInt(process.env.RESERVE_MINTER_INTERVAL_MS || '15000', 10);
const MINT_RATIO = parseFloat(process.env.RESERVE_MINT_RATIO || '0.7');
const MAX_TOTAL_SUPPLY_USD = parseFloat(
  process.env.RESERVE_MINTER_MAX_SUPPLY_USD || '500000000'
);
const MIN_ACTION_AMOUNT_USD = parseFloat(
  process.env.RESERVE_MINTER_MIN_ACTION_USD || '1'
);
const REBALANCE_THRESHOLD = parseFloat(
  process.env.RESERVE_MINTER_REBALANCE_THRESHOLD || '0.01'
);
const PRICE_CACHE_TTL_MS = parseInt(
  process.env.RESERVE_MINTER_PRICE_CACHE_MS || '60000',
  10
);

const DATA_DIR = process.env.AGENT_DATA_DIR || path.join(__dirname, '..', 'data');
const LOGS_DIR = process.env.AGENT_LOGS_DIR || path.join(__dirname, '..', 'logs');
const DRY_RUN = process.env.RESERVE_MINTER_DRY_RUN === 'true';
const DISABLED = process.env.RESERVE_MINTER_DISABLED === 'true';

const CROSS_CHAIN_NETWORKS = [
  {
    name: 'bsc-mainnet',
    rpc: process.env.BSC_MAINNET_RPC || 'https://bsc-rpc.publicnode.com',
  },
  {
    name: 'ethereum',
    rpc: process.env.ETHEREUM_RPC || 'https://ethereum-rpc.publicnode.com',
  },
  {
    name: 'polygon',
    rpc: process.env.POLYGON_RPC || 'https://polygon-bor-rpc.publicnode.com',
  },
];

// ── Logger ───────────────────────────────────────────────────────────────────
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

const logger = winston.createLogger({
  level: process.env.RESERVE_MINTER_LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'reserve-minter.log'),
      maxsize: 5_000_000,
      maxFiles: 5,
    }),
  ],
});

// ── ABI ──────────────────────────────────────────────────────────────────────
// Minimal ABI for reserve-mint operations.
const TFUSD_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function mintByMaster(address to, uint256 amount) returns (bool)',
  'function burn(uint256 amount)',
  'function MASTERMINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
];

// ── State ────────────────────────────────────────────────────────────────────
let provider;
let signer;
let signerAddress;
let recipientAddress;
let tfusd;
let maalProvider;

let lastPrice = null;
let lastPriceAt = 0;
const lastKnownPerNetworkSupply = {};
let isActing = false;
let lastActionReserveUsd = null;

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(n, decimals = 2) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function sanitizeRpc(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/...`;
  } catch {
    return url;
  }
}

function usdToTokenAmount(usd) {
  // Keep 6 decimal USD precision → 18 decimal token precision.
  const rounded = Math.round(usd * 1_000_000) / 1_000_000;
  return ethers.parseUnits(rounded.toFixed(6), 18);
}

function saveState(state) {
  try {
    fs.writeFileSync(
      path.join(DATA_DIR, 'reserve-minter-state.json'),
      JSON.stringify(state, null, 2)
    );
  } catch (err) {
    logger.warn(`Failed to write reserve-minter-state.json: ${err.message}`);
  }
}

function loadState() {
  try {
    const file = path.join(DATA_DIR, 'reserve-minter-state.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (typeof data.lastActionReserveUsd === 'number') {
        lastActionReserveUsd = data.lastActionReserveUsd;
        logger.info(
          `Loaded last action reserve value: $${formatNumber(lastActionReserveUsd, 2)}`
        );
      }
    }
  } catch (err) {
    logger.warn(`Failed to load reserve-minter-state.json: ${err.message}`);
  }
}

async function fetchWithTimeout(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function fetchMaalBalance() {
  const raw = await maalProvider.getBalance(MAAL_WALLET);
  return Number(ethers.formatEther(raw));
}

async function fetchMaalPrice() {
  const now = Date.now();
  if (lastPrice !== null && now - lastPriceAt < PRICE_CACHE_TTL_MS) {
    return lastPrice;
  }

  try {
    const res = await fetchWithTimeout(COINGECKO_URL, 10_000);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json();
    const price = data?.['maal-chain']?.usd;
    if (typeof price !== 'number') {
      throw new Error('CoinGecko response missing maal-chain.usd');
    }
    lastPrice = price;
    lastPriceAt = now;
    return price;
  } catch (err) {
    if (lastPrice !== null) {
      logger.warn(
        `CoinGecko fetch failed (${err.message}); using stale price ${lastPrice}`
      );
      return lastPrice;
    }
    throw err;
  }
}

async function fetchCrossChainTotalSupply() {
  const results = await Promise.allSettled(
    CROSS_CHAIN_NETWORKS.map(async (net) => {
      const p = new ethers.JsonRpcProvider(net.rpc);
      const contract = new ethers.Contract(TFUSD_ADDRESS, TFUSD_ABI, p);
      const raw = await contract.totalSupply();
      return { name: net.name, raw };
    })
  );

  let total = 0n;
  const perNetwork = {};

  results.forEach((result, idx) => {
    const net = CROSS_CHAIN_NETWORKS[idx];
    if (result.status === 'fulfilled') {
      const { raw } = result.value;
      total += raw;
      perNetwork[net.name] = ethers.formatUnits(raw, 18);
      lastKnownPerNetworkSupply[net.name] = raw;
    } else {
      logger.warn(`Failed to read totalSupply on ${net.name}: ${result.reason.message}`);
      const cached = lastKnownPerNetworkSupply[net.name];
      if (cached !== undefined) {
        total += cached;
        perNetwork[net.name] = `${ethers.formatUnits(cached, 18)} (cached)`;
      } else {
        perNetwork[net.name] = 'unavailable';
      }
    }
  });

  return { total, perNetwork };
}

// ── Main cycle ───────────────────────────────────────────────────────────────
async function runCycle() {
  if (isActing) {
    logger.info('Previous action still in progress; skipping this cycle.');
    return;
  }

  const timestamp = new Date().toISOString();
  const state = {
    timestamp,
    maalWallet: MAAL_WALLET,
    maalBalance: null,
    maalPrice: null,
    maalUsd: null,
    targetUsd: null,
    totalSupply: null,
    perNetworkSupply: {},
    deltaUsd: null,
    rebalanceThreshold: REBALANCE_THRESHOLD,
    lastActionReserveUsd,
    action: 'none',
    txHash: null,
    error: null,
  };

  try {
    const [maalBalance, maalPrice] = await Promise.all([
      fetchMaalBalance(),
      fetchMaalPrice(),
    ]);

    const maalUsd = maalBalance * maalPrice;
    const targetUsd = Math.min(maalUsd * MINT_RATIO, MAX_TOTAL_SUPPLY_USD);

    const { total: totalRaw, perNetwork } = await fetchCrossChainTotalSupply();
    const totalSupply = Number(ethers.formatUnits(totalRaw, 18));
    const deltaUsd = targetUsd - totalSupply;

    state.maalBalance = maalBalance;
    state.maalPrice = maalPrice;
    state.maalUsd = maalUsd;
    state.targetUsd = targetUsd;
    state.totalSupply = totalSupply;
    state.perNetworkSupply = perNetwork;
    state.deltaUsd = deltaUsd;

    logger.info(
      `MAAL balance=${formatNumber(maalBalance, 4)} | price=$${formatNumber(
        maalPrice,
        6
      )} | value=$${formatNumber(maalUsd, 2)} | target=$${formatNumber(
        targetUsd,
        2
      )} | totalSupply=$${formatNumber(totalSupply, 2)} | delta=$${formatNumber(
        deltaUsd,
        2
      )}`
    );

    const reserveChangeRatio =
      lastActionReserveUsd === null
        ? Infinity
        : Math.abs(maalUsd - lastActionReserveUsd) / lastActionReserveUsd;

    if (reserveChangeRatio < REBALANCE_THRESHOLD) {
      logger.info(
        `Reserve value changed ${formatNumber(reserveChangeRatio * 100, 4)}% ` +
          `(threshold ${formatNumber(REBALANCE_THRESHOLD * 100, 4)}%); no action.`
      );
      saveState(state);
      return;
    }

    logger.info(
      `Reserve value moved ${formatNumber(reserveChangeRatio * 100, 2)}% since last action; rebalancing.`
    );

    if (Math.abs(deltaUsd) < MIN_ACTION_AMOUNT_USD) {
      logger.info(
        `Delta $${formatNumber(deltaUsd, 4)} below threshold ($${formatNumber(
          MIN_ACTION_AMOUNT_USD,
          4
        )}); no action.`
      );
      saveState(state);
      return;
    }

    if (deltaUsd > 0) {
      // Mint up to target without breaking the global cap.
      const maxMintUsd = Math.max(0, MAX_TOTAL_SUPPLY_USD - totalSupply);
      const mintUsd = Math.min(deltaUsd, maxMintUsd);
      if (mintUsd < MIN_ACTION_AMOUNT_USD) {
        logger.info('Mint target reached global cap; no action.');
        saveState(state);
        return;
      }

      const mintAmount = usdToTokenAmount(mintUsd);
      if (DISABLED || DRY_RUN) {
        logger.info(
          `[${DISABLED ? 'DISABLED' : 'DRY RUN'}] Would mint ${ethers.formatUnits(
            mintAmount,
            18
          )} TFUSD to ${recipientAddress}`
        );
        state.action = DISABLED ? 'disabled_mint' : 'dry_run_mint';
        if (!DISABLED) {
          lastActionReserveUsd = maalUsd;
          state.lastActionReserveUsd = maalUsd;
        }
      } else {
        isActing = true;
        try {
          const tx = await tfusd.connect(signer).mintByMaster(recipientAddress, mintAmount);
          logger.info(`Mint transaction submitted: ${tx.hash}`);
          const receipt = await tx.wait();
          if (receipt.status !== 1) throw new Error('Mint transaction reverted');
          logger.info(
            `Minted ${ethers.formatUnits(mintAmount, 18)} TFUSD to ${recipientAddress} in block ${receipt.blockNumber}`
          );
          state.action = 'mint';
          state.txHash = receipt.hash;
          lastActionReserveUsd = maalUsd;
          state.lastActionReserveUsd = maalUsd;
        } finally {
          isActing = false;
        }
      }
    } else {
      // Burn surplus, limited by what the signer actually holds.
      let burnUsd = -deltaUsd;
      const signerBalanceRaw = await tfusd.balanceOf(signerAddress);
      const signerBalanceUsd = Number(ethers.formatUnits(signerBalanceRaw, 18));

      if (burnUsd > signerBalanceUsd) {
        logger.warn(
          `Required burn $${formatNumber(burnUsd, 2)} exceeds signer balance $${formatNumber(
            signerBalanceUsd,
            2
          )}; limiting to available balance.`
        );
        burnUsd = signerBalanceUsd;
      }

      if (burnUsd < MIN_ACTION_AMOUNT_USD) {
        logger.info(
          `Burn amount $${formatNumber(burnUsd, 4)} below threshold or no tokens held; no action.`
        );
        saveState(state);
        return;
      }

      const burnAmount = usdToTokenAmount(burnUsd);
      if (DISABLED || DRY_RUN) {
        logger.info(
          `[${DISABLED ? 'DISABLED' : 'DRY RUN'}] Would burn ${ethers.formatUnits(
            burnAmount,
            18
          )} TFUSD from ${signerAddress}`
        );
        state.action = DISABLED ? 'disabled_burn' : 'dry_run_burn';
        if (!DISABLED) {
          lastActionReserveUsd = maalUsd;
          state.lastActionReserveUsd = maalUsd;
        }
      } else {
        isActing = true;
        try {
          const tx = await tfusd.connect(signer).burn(burnAmount);
          logger.info(`Burn transaction submitted: ${tx.hash}`);
          const receipt = await tx.wait();
          if (receipt.status !== 1) throw new Error('Burn transaction reverted');
          logger.info(
            `Burned ${ethers.formatUnits(burnAmount, 18)} TFUSD in block ${receipt.blockNumber}`
          );
          state.action = 'burn';
          state.txHash = receipt.hash;
          lastActionReserveUsd = maalUsd;
          state.lastActionReserveUsd = maalUsd;
        } finally {
          isActing = false;
        }
      }
    }
  } catch (err) {
    state.error = err.message;
    logger.error(`Reserve minter cycle failed: ${err.message}`);
  }

  saveState(state);
}

// ── Initialization ───────────────────────────────────────────────────────────
async function initialize() {
  provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
  maalProvider = new ethers.JsonRpcProvider(MAAL_RPC);
  tfusd = new ethers.Contract(TFUSD_ADDRESS, TFUSD_ABI, provider);

  if (!PRIVATE_KEY) {
    if (!DRY_RUN) {
      throw new Error(
        'PRIVATE_KEY is not set. Set RESERVE_MINTER_DRY_RUN=true to run in simulation mode.'
      );
    }
    logger.warn('No PRIVATE_KEY provided; running in dry-run / monitoring mode.');
    signerAddress = RECIPIENT ? ethers.getAddress(RECIPIENT) : null;
  } else {
    signer = new ethers.Wallet(PRIVATE_KEY, provider);
    signerAddress = await signer.getAddress();

    const role = await tfusd.MASTERMINTER_ROLE();
    const hasRole = await tfusd.hasRole(role, signerAddress);
    if (!hasRole) {
      throw new Error(
        `Signer ${signerAddress} does not have MASTERMINTER_ROLE on TFUSD at ${TFUSD_ADDRESS}`
      );
    }
    logger.info(`Signer ${signerAddress} verified with MASTERMINTER_ROLE.`);
  }

  recipientAddress = RECIPIENT
    ? ethers.getAddress(RECIPIENT)
    : signerAddress || '0x0000000000000000000000000000000000000000';

  if (recipientAddress !== signerAddress) {
    logger.warn(
      `Mint recipient (${recipientAddress}) differs from signer (${signerAddress}). ` +
        'Automatic burns will only use tokens held by the signer wallet.'
    );
  }

  // Load persisted state so we don't re-mint on restart unless reserves moved.
  loadState();

  // Warm up the BSC connection.
  const blockNumber = await provider.getBlockNumber();
  logger.info(`Connected to BSC Mainnet at block ${blockNumber}.`);
}

async function main() {
  logger.info('══════════════════════════════════════════════════════════════════');
  logger.info('  TFUSD Reserve Minter Agent Starting');
  logger.info('══════════════════════════════════════════════════════════════════');
  logger.info(`  TFUSD:        ${TFUSD_ADDRESS}`);
  logger.info(`  MAAL wallet:  ${MAAL_WALLET}`);
  logger.info(`  BSC RPC:      ${sanitizeRpc(BSC_RPC_URL)}`);
  logger.info(`  MAAL RPC:     ${sanitizeRpc(MAAL_RPC)}`);
  logger.info(`  Poll interval: ${POLL_INTERVAL_MS} ms`);
  logger.info(`  Target ratio:  ${MINT_RATIO * 100}%`);
  logger.info(`  Global cap:    $${formatNumber(MAX_TOTAL_SUPPLY_USD, 0)}`);
  logger.info(`  Min action:    $${formatNumber(MIN_ACTION_AMOUNT_USD, 4)}`);
  logger.info(`  Rebalance threshold: ${formatNumber(REBALANCE_THRESHOLD * 100, 2)}%`);
  logger.info(`  Mode:          ${DISABLED ? 'DISABLED' : DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  logger.info('──────────────────────────────────────────────────────────────────');

  await initialize();

  // Run immediately, then schedule the next cycle ~15 s after the previous one finishes.
  if (process.env.RESERVE_MINTER_ONE_SHOT === 'true') {
    await runCycle();
    logger.info('One-shot complete. Exiting.');
    process.exit(0);
  }

  let timeout;
  async function schedule() {
    await runCycle();
    timeout = setTimeout(schedule, POLL_INTERVAL_MS);
  }
  await schedule();

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    clearTimeout(timeout);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received. Shutting down gracefully...');
    clearTimeout(timeout);
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
