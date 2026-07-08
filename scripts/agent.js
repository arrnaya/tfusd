/**
 * =============================================================================
 * TFUSD Agent — Background Monitoring, Audit & Transfer Alert Process
 * =============================================================================
 * Connects to the configured EVM RPC via ethers.js.
 * Every 30 seconds, checks:
 *   - Contract health (TFUSD + DAO)
 *   - Peg status (mocked price feed or on-chain derived)
 *   - Pool / reserve balance
 *   - DON (Digital Oracle Node) status
 *   - Wallet security (blacklist, trade freeze)
 *
 * Calculates an audit score (0-100) across 8 categories:
 *   1. Contract Health       2. Peg Stability
 *   3. Pool Sufficiency      4. DAO Governance Health
 *   5. Minter Allowance      6. Pause Status
 *   7. Blacklist Hygiene     8. DON Connectivity
 *
 * Additionally listens for on-chain TFUSD Transfer events and sends Telegram
 * alerts whenever a transfer exceeds the configured USD threshold.
 *
 * Results are saved to /app/data/audit-results.json and logged to console.
 * =============================================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const https = require('https');
const path = require('path');
const winston = require('winston');

// ── Configuration ────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const POLL_INTERVAL_MS = parseInt(process.env.AGENT_POLL_INTERVAL_MS || '30000', 10);
const DATA_DIR = process.env.AGENT_DATA_DIR || path.join(__dirname, '..', 'data');
const LOGS_DIR = process.env.AGENT_LOGS_DIR || path.join(__dirname, '..', 'logs');
const LOG_LEVEL = process.env.AGENT_LOG_LEVEL || 'info';

// ── Telegram alerting ────────────────────────────────────────────────────────
const TELEGRAM_ALERT_ENABLED = process.env.TELEGRAM_ALERT_ENABLED === 'true';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_ALERT_SEVERITY = process.env.TELEGRAM_ALERT_SEVERITY || 'warning';
const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };
let lastAlertHash = null;

// ── Transfer alerting ────────────────────────────────────────────────────────
const TRANSFER_ALERT_ENABLED = process.env.TRANSFER_ALERT_ENABLED !== 'false';
const TRANSFER_USD_THRESHOLD = parseFloat(process.env.TRANSFER_USD_THRESHOLD || '5000');
const GECKO_NETWORK = process.env.GECKO_NETWORK || 'bsc';
const GECKO_POOL_ADDRESS =
  process.env.GECKO_POOL_ADDRESS ||
  '0x92e6f8a2a99a86c44d44461693231d091084c7b1ec4f2372c352893caeb4aa84';
const EXPLORER_URL = process.env.EXPLORER_URL;

// Load ABI from local JSON (CommonJS-compatible)
const TFUSD_ABI = require('./contract-abi.json');

// DAO minimal ABI (just what we need for monitoring)
const DAO_ABI = [
  'function tfusd() view returns (address)',
  'function owner() view returns (address)',
  'function params() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool,bool)',
  'function emergencyPaused() view returns (bool)',
  'function proposalCount() view returns (uint256)',
  'function getGuardianCount() view returns (uint256)',
  'function guardians(address) view returns (bool)',
  'function isGuardian(address) view returns (bool)',
  'function getProposal(uint256) view returns (uint256,address,string,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool)',
  'event ProposalCreated(uint256 indexed,address indexed,string,bytes,uint256,uint256)',
  'event EmergencyPauseTriggered(address indexed)',
  'event EmergencyUnpauseTriggered(address indexed)',
];

// ── Logger ─────────────────────────────────────────────────────────────────
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(LOGS_DIR, 'agent.log'), maxsize: 5_000_000, maxFiles: 5 }),
  ],
});

// ── State ──────────────────────────────────────────────────────────────────
let provider;
let tfusd;
let dao;
let tfusdAddress = process.env.TFUSD_CONTRACT_ADDRESS;
let daoAddress = process.env.TFUSD_DAO_ADDRESS;

let lastAuditResult = null;
let consecutiveFailures = 0;
let tfusdDecimals = 18;
let chainId = null;
let explorerBaseUrl = null;
const lastTransferAlertTxs = new Set();
let geckoPoolData = null;

// ── Helpers ──────────────────────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizeRpc(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/...`;
  } catch {
    return url;
  }
}

function hashAlerts(alerts) {
  return alerts.map((a) => `${a.severity}:${a.message}`).sort().join('|');
}

function rank(severity) {
  const map = { info: 0, warning: 1, critical: 2 };
  return map[severity] ?? 0;
}

function getGrade(score) {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 60) return 'D';
  return 'F';
}

function shortenAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUSD(num, digits = 2) {
  if (num == null || Number.isNaN(num)) return '--';
  return `$${Number(num).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return reject(new Error('Telegram token/chat ID not configured'));
    }

    const payload = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_notification: false,
    });

    const url = new URL(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10_000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Telegram API returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Telegram request timeout')));
    req.write(payload);
    req.end();
  });
}

async function fetchGeckoPoolData() {
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${GECKO_NETWORK}/pools/${GECKO_POOL_ADDRESS}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const attrs = json.data?.attributes;
    if (!attrs) return null;

    const basePrice = parseFloat(attrs.base_token_price_usd) || 0;
    const quotePrice = parseFloat(attrs.quote_token_price_usd) || 0;
    const reserveUsd = parseFloat(attrs.reserve_in_usd) || 0;

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
      reserveToken0: basePrice > 0 ? reserveUsd / 2 / basePrice : null,
      reserveToken1: quotePrice > 0 ? reserveUsd / 2 / quotePrice : null,
      token0Symbol: baseToken?.attributes?.symbol || 'TFUSD',
      token1Symbol: quoteToken?.attributes?.symbol || 'USDC',
      buys24h: attrs.transactions?.h24?.buys || 0,
      sells24h: attrs.transactions?.h24?.sells || 0,
      timestamp: nowIso(),
    };
  } catch (err) {
    logger.warn(`GeckoTerminal pool fetch failed: ${err.message}`);
    return null;
  }
}

async function resolveExplorerUrl() {
  if (EXPLORER_URL) {
    explorerBaseUrl = EXPLORER_URL.replace(/\/+$/, '');
    return;
  }
  try {
    const network = await provider.getNetwork();
    chainId = Number(network.chainId);
    const map = {
      56: 'https://bscscan.com',
      97: 'https://testnet.bscscan.com',
      1: 'https://etherscan.io',
      11155111: 'https://sepolia.etherscan.io',
    };
    explorerBaseUrl = map[chainId] || null;
  } catch (err) {
    logger.warn(`Could not resolve explorer URL: ${err.message}`);
    explorerBaseUrl = null;
  }
}

async function sendLargeTransferAlert(from, to, value, txHash) {
  if (!TELEGRAM_ALERT_ENABLED || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const amount = parseFloat(ethers.formatUnits(value, tfusdDecimals));
  const amountStr = amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const txUrl = explorerBaseUrl ? `${explorerBaseUrl}/tx/${txHash}` : null;

  const lines = [
    '💸 *Large TFUSD Transfer*',
    '',
    `*Amount:* ${amountStr} TFUSD (~$${amountStr})`,
    `*From:* \`${from}\` (${shortenAddress(from)})`,
    `*To:* \`${to}\` (${shortenAddress(to)})`,
  ];
  if (txUrl) {
    lines.push('', `[View Transaction on Explorer](${txUrl})`);
  }

  try {
    await sendTelegramMessage(lines.join('\n'));
    logger.info(`Transfer alert sent for tx ${txHash} (${amountStr} TFUSD)`);
  } catch (err) {
    logger.error(`Failed to send transfer alert: ${err.message}`);
  }
}

async function scanRecentLargeTransfers(blocksBack = 50) {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - blocksBack);
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const logs = await provider.getLogs({
      address: tfusdAddress,
      topics: [transferTopic],
      fromBlock,
      toBlock: currentBlock,
    });
    logger.info(`Scanned ${logs.length} Transfer logs from last ${blocksBack} blocks`);

    const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    for (const log of logs) {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      const value = parsed.args.value;
      const amount = parseFloat(ethers.formatUnits(value, tfusdDecimals));
      if (amount >= TRANSFER_USD_THRESHOLD && !lastTransferAlertTxs.has(log.transactionHash)) {
        await sendLargeTransferAlert(parsed.args.from, parsed.args.to, value, log.transactionHash);
        lastTransferAlertTxs.add(log.transactionHash);
      }
    }
  } catch (err) {
    logger.error(`Recent transfer scan failed: ${err.message}`);
  }
}

async function startTransferMonitoring() {
  if (!TRANSFER_ALERT_ENABLED) return;

  try {
    tfusdDecimals = await tfusd.decimals();
  } catch (err) {
    logger.warn(`Could not read TFUSD decimals, assuming 18: ${err.message}`);
  }

  await resolveExplorerUrl();

  const eventAbi = [...TFUSD_ABI, 'event Transfer(address indexed from, address indexed to, uint256 value)'];
  const tfusdEvents = new ethers.Contract(tfusdAddress, eventAbi, provider);

  tfusdEvents.on('Transfer', async (from, to, value, event) => {
    const amount = parseFloat(ethers.formatUnits(value, tfusdDecimals));
    if (amount < TRANSFER_USD_THRESHOLD) return;

    const txHash = event.log.transactionHash;
    if (lastTransferAlertTxs.has(txHash)) return;
    lastTransferAlertTxs.add(txHash);

    // Bound the dedup set size
    if (lastTransferAlertTxs.size > 200) {
      const first = lastTransferAlertTxs.values().next().value;
      lastTransferAlertTxs.delete(first);
    }

    await sendLargeTransferAlert(from, to, value, txHash);
  });

  logger.info(`Transfer monitoring started (threshold: $${TRANSFER_USD_THRESHOLD})`);
  await scanRecentLargeTransfers(50);
}

async function notifyTelegram(result) {
  if (!TELEGRAM_ALERT_ENABLED) return;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    logger.warn('Telegram alerts enabled but token/chat ID missing');
    return;
  }

  const threshold = rank(TELEGRAM_ALERT_SEVERITY);
  const relevant = (result.alerts || []).filter((a) => rank(a.severity) >= threshold);
  if (relevant.length === 0) return;

  const currentHash = hashAlerts(relevant);
  if (currentHash === lastAlertHash) return; // deduplicate identical alerts
  lastAlertHash = currentHash;

  const grade = result.grade || getGrade(result.overallScore);
  const alertLines = relevant.map((a) => `*[${a.severity.toUpperCase()}]* ${a.message}`);

  const poolLines = [];
  if (geckoPoolData) {
    const priceChangeStr = `${geckoPoolData.priceChange24h >= 0 ? '+' : ''}${geckoPoolData.priceChange24h.toFixed(2)}%`;
    const health = geckoPoolData.reserveUsd >= 10000 ? 'healthy' : geckoPoolData.reserveUsd > 0 ? 'low' : 'critical';
    poolLines.push(
      '',
      '*Pool Status*',
      `• Price: ${formatUSD(geckoPoolData.price, 4)} (${priceChangeStr})`,
      `• Liquidity: ${formatUSD(geckoPoolData.reserveUsd, 0)}`,
      `• ${geckoPoolData.token0Symbol} Reserve: ${geckoPoolData.reserveToken0 != null ? geckoPoolData.reserveToken0.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '--'}`,
      `• ${geckoPoolData.token1Symbol} Reserve: ${geckoPoolData.reserveToken1 != null ? geckoPoolData.reserveToken1.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '--'}`,
      `• 24h Volume: ${formatUSD(geckoPoolData.volume24h, 0)}`,
      `• 24h Trades: ${geckoPoolData.buys24h} buys / ${geckoPoolData.sells24h} sells`,
      `• Health: ${health}`
    );
  }

  const text = [
    '🚨 *TFUSD Auditor Alert*',
    `Score: ${result.overallScore}/100 | Grade: ${grade}`,
    '',
    ...alertLines,
    ...poolLines,
  ].join('\n');

  try {
    await sendTelegramMessage(text);
    logger.info('Telegram audit alert sent');
  } catch (err) {
    logger.error(`Failed to send Telegram audit alert: ${err.message}`);
  }
}

async function discoverAddresses() {
  // Try multiple possible paths (local dev vs Docker container)
  const possiblePaths = [
    path.join(__dirname, 'deployments', 'local', 'deploy-addresses.json'),
    path.join(__dirname, '..', 'deployments', 'local', 'deploy-addresses.json'),
  ];

  for (const deployPath of possiblePaths) {
    if (fs.existsSync(deployPath)) {
      const data = JSON.parse(fs.readFileSync(deployPath, 'utf-8'));
      tfusdAddress = data.contracts.TreuhandFinanzgruppeUSD.address;
      daoAddress = data.contracts.TreuhandFinanzgruppeUSDDAO.address;
      logger.info(`Discovered addresses from: ${deployPath}`);
      logger.info(`  TFUSD: ${tfusdAddress}`);
      logger.info(`  DAO:   ${daoAddress}`);
      return;
    }
  }

  // Fallback: try env again
  if (!tfusdAddress || !daoAddress) {
    throw new Error(
      'Contract addresses not found. Set TFUSD_CONTRACT_ADDRESS and TFUSD_DAO_ADDRESS in .env, or run deploy.js first.'
    );
  }
}

function saveAuditResult(result) {
  const outPath = path.join(DATA_DIR, 'audit-results.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  // Also append to history
  const historyPath = path.join(DATA_DIR, 'audit-history.jsonl');
  fs.appendFileSync(historyPath, JSON.stringify(result) + '\n');

  // Write a ping file for the Docker healthcheck
  const pingPath = path.join(DATA_DIR, 'last-ping.json');
  fs.writeFileSync(pingPath, JSON.stringify({ timestamp: result.timestamp, score: result.overallScore }));
}

// ── Audit Score Calculation ─────────────────────────────────────────────────
function calculateAuditScore(checks) {
  // 8 categories, each 0-100, weighted equally
  const scores = {
    contractHealth: checks.tfusdResponding && checks.daoResponding ? 100 : 0,
    pegStability: checks.pegDeviationBps <= 50 ? 100 : checks.pegDeviationBps <= 100 ? 80 : checks.pegDeviationBps <= 200 ? 50 : 0,
    poolSufficiency: checks.poolRatio >= 0.8 ? 100 : checks.poolRatio >= 0.5 ? 80 : checks.poolRatio >= 0.3 ? 50 : 0,
    daoGovernanceHealth: checks.daoGuardianCount >= 2 ? 100 : checks.daoGuardianCount >= 1 ? 70 : 0,
    minterAllowance: checks.minterAllowance > 0 ? 100 : 0,
    pauseStatus: !checks.paused ? 100 : 0,
    blacklistHygiene: checks.blacklistCount < 5 ? 100 : checks.blacklistCount < 20 ? 80 : 50,
    donConnectivity: checks.donOnline ? 100 : 0,
  };

  const values = Object.values(scores);
  const overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return { categories: scores, overall };
}

// ── Monitoring Routines ───────────────────────────────────────────────────
async function checkTFUSDHealth() {
  try {
    const name = await tfusd.name();
    const symbol = await tfusd.symbol();
    const totalSupply = await tfusd.totalSupply();
    const paused = await tfusd.paused();
    const currency = await tfusd.currency();
    const owner = await tfusd.owner();

    return {
      responding: true,
      name,
      symbol,
      currency,
      totalSupply: ethers.formatUnits(totalSupply, 18),
      paused,
      owner,
    };
  } catch (err) {
    logger.error(`TFUSD health check failed: ${err.message}`);
    return { responding: false, error: err.message };
  }
}

async function checkDAOHealth() {
  try {
    const owner = await dao.owner();
    const guardianCount = await dao.getGuardianCount();
    const proposalCount = await dao.proposalCount();
    const emergencyPaused = await dao.emergencyPaused();
    const params = await dao.params();

    return {
      responding: true,
      owner,
      guardianCount: Number(guardianCount),
      proposalCount: Number(proposalCount),
      emergencyPaused,
      params: {
        depegThreshold: Number(params[0]),
        positiveDepegThreshold: Number(params[1]),
        criticalDepegThreshold: Number(params[2]),
        poolReplenishThreshold: Number(params[3]),
        maxAutoMintAmount: ethers.formatUnits(params[4], 18),
        maxAutoBurnAmount: ethers.formatUnits(params[5], 18),
        mintPauseDuration: Number(params[6]),
        guardianQuorum: Number(params[7]),
        proposalTimelock: Number(params[8]),
        votingPeriod: Number(params[9]),
        autoMintOnDepeg: params[10],
        autoBurnOnPositiveDepeg: params[11],
        autoReplenishPool: params[12],
      },
    };
  } catch (err) {
    logger.error(`DAO health check failed: ${err.message}`);
    return { responding: false, error: err.message };
  }
}

async function checkPegStatus() {
  // In a real setup, this would query a price oracle (Chainlink, Uniswap TWAP, etc.)
  // For local/testnet, we simulate a peg check by reading from contract state
  // or assuming a mock price feed. Here we compute a synthetic deviation.
  try {
    const totalSupply = await tfusd.totalSupply();
    // Mock: assume target market cap equals total supply (1:1 peg)
    // In production, replace with actual oracle price query
    const mockPrice = geckoPoolData?.price || 1.0;
    const deviation = Math.abs(mockPrice - 1.0);
    const deviationBps = Math.round(deviation * 10_000);

    return {
      price: mockPrice,
      deviationBps,
      stable: deviationBps <= 50, // within 0.5%
    };
  } catch (err) {
    logger.error(`Peg check failed: ${err.message}`);
    return { price: 0, deviationBps: 10_000, stable: false, error: err.message };
  }
}

async function checkPoolBalance() {
  try {
    const poolAddress = process.env.POOL_ADDRESS || ethers.ZeroAddress;
    if (poolAddress === ethers.ZeroAddress) {
      return { balance: '0', target: '1000000000', ratio: 0, healthy: false };
    }
    const balance = await tfusd.balanceOf(poolAddress);
    const target = ethers.parseUnits('1000000000', 18); // 1B
    const ratio = Number(ethers.formatUnits(balance, 18)) / Number(ethers.formatUnits(target, 18));
    return {
      balance: ethers.formatUnits(balance, 18),
      target: ethers.formatUnits(target, 18),
      ratio,
      healthy: ratio >= 0.5,
    };
  } catch (err) {
    logger.error(`Pool check failed: ${err.message}`);
    return { balance: '0', target: '1000000000', ratio: 0, healthy: false, error: err.message };
  }
}

async function checkDONStatus() {
  // DON = Digital Oracle Node status
  // In production, this would query the actual oracle endpoints.
  // For local dev, we simulate based on provider connectivity.
  try {
    const blockNumber = await provider.getBlockNumber();
    const isOnline = blockNumber > 0;
    return {
      online: isOnline,
      lastBlock: blockNumber,
      timestamp: nowIso(),
    };
  } catch (err) {
    return { online: false, lastBlock: 0, error: err.message };
  }
}

async function checkMinterAllowance() {
  try {
    const allowance = await tfusd.minterAllowanceOf(daoAddress);
    return {
      allowance: ethers.formatUnits(allowance, 18),
      active: allowance > 0n,
    };
  } catch (err) {
    return { allowance: '0', active: false, error: err.message };
  }
}

async function checkBlacklist() {
  try {
    // In production, maintain an indexed list of blacklisted addresses.
    // For local dev, we return a mock count (no API to enumerate mapping).
    return { count: 0, healthy: true };
  } catch (err) {
    return { count: 0, healthy: false, error: err.message };
  }
}

async function checkWalletSecurity() {
  try {
    // Check for any suspicious patterns: e.g., paused, emergencyPaused, etc.
    const paused = await tfusd.paused();
    const emergencyPaused = await dao.emergencyPaused();
    return {
      paused,
      emergencyPaused,
      secure: !paused && !emergencyPaused,
    };
  } catch (err) {
    return { paused: false, emergencyPaused: false, secure: false, error: err.message };
  }
}

// ── Main Monitoring Loop ────────────────────────────────────────────────────
async function runAuditCycle() {
  const cycleStart = Date.now();
  const timestamp = nowIso();

  try {
    logger.info('Starting audit cycle...');

    // Refresh live market data for richer alerts and peg checks
    geckoPoolData = await fetchGeckoPoolData();

    const tfusdHealth = await checkTFUSDHealth();
    const daoHealth = await checkDAOHealth();
    const pegStatus = await checkPegStatus();
    const poolStatus = await checkPoolBalance();
    const donStatus = await checkDONStatus();
    const minterStatus = await checkMinterAllowance();
    const blacklistStatus = await checkBlacklist();
    const walletSecurity = await checkWalletSecurity();

    const checks = {
      tfusdResponding: tfusdHealth.responding,
      daoResponding: daoHealth.responding,
      pegDeviationBps: pegStatus.deviationBps,
      poolRatio: poolStatus.ratio ?? 0,
      daoGuardianCount: daoHealth.guardianCount ?? 0,
      minterAllowance: minterStatus.active ? 1 : 0,
      paused: tfusdHealth.paused || walletSecurity.emergencyPaused,
      blacklistCount: blacklistStatus.count,
      donOnline: donStatus.online,
    };

    const score = calculateAuditScore(checks);
    const grade = getGrade(score.overall);

    const result = {
      timestamp,
      cycleDurationMs: Date.now() - cycleStart,
      overallScore: score.overall,
      grade,
      categoryScores: score.categories,
      checks: {
        tfusd: tfusdHealth,
        dao: daoHealth,
        peg: pegStatus,
        pool: poolStatus,
        don: donStatus,
        minter: minterStatus,
        blacklist: blacklistStatus,
        walletSecurity,
      },
      alerts: [],
    };

    // Generate alerts based on thresholds
    if (score.overall < 50) {
      result.alerts.push({ severity: 'critical', message: `Overall audit score critically low: ${score.overall}` });
    } else if (score.overall < 80) {
      result.alerts.push({ severity: 'warning', message: `Audit score below target: ${score.overall}` });
    }
    if (!pegStatus.stable) {
      result.alerts.push({ severity: 'warning', message: `Peg deviation ${pegStatus.deviationBps} bps exceeds threshold` });
    }
    if (!poolStatus.healthy) {
      result.alerts.push({ severity: 'warning', message: `Pool ratio low: ${(poolStatus.ratio * 100).toFixed(2)}%` });
    }
    if (tfusdHealth.paused) {
      result.alerts.push({ severity: 'info', message: 'TFUSD contract is currently paused' });
    }
    if (walletSecurity.emergencyPaused) {
      result.alerts.push({ severity: 'critical', message: 'DAO emergency pause is active' });
    }

    saveAuditResult(result);
    lastAuditResult = result;
    consecutiveFailures = 0;
    await notifyTelegram(result);

    // Console status update
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  TFUSD Audit Report                                              ║');
    console.log(`║  ${timestamp.padEnd(63)}║`);
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log(`║  Overall Score: ${String(score.overall).padStart(3)} / 100  |  Grade: ${grade.padEnd(5)}                    ║`);
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    Object.entries(score.categories).forEach(([cat, val]) => {
      const line = `  ${cat}: ${String(val).padStart(3)}`;
      console.log(`║${line.padEnd(66)}║`);
    });
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log(`║  TFUSD: ${tfusdHealth.responding ? 'OK' : 'FAIL'}  |  DAO: ${daoHealth.responding ? 'OK' : 'FAIL'}  |  Peg: ${pegStatus.stable ? 'STABLE' : 'UNSTABLE'}                    ║`);
    console.log(`║  Pool: ${poolStatus.healthy ? 'HEALTHY' : 'LOW'}  |  DON: ${donStatus.online ? 'ONLINE' : 'OFFLINE'}  |  Minter: ${minterStatus.active ? 'ACTIVE' : 'INACTIVE'}              ║`);
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    if (result.alerts.length > 0) {
      console.log('  ⚠ Alerts:');
      result.alerts.forEach((a) => console.log(`    [${a.severity.toUpperCase()}] ${a.message}`));
    }
  } catch (err) {
    consecutiveFailures++;
    logger.error(`Audit cycle failed: ${err.message}`);
    console.error(`[ERROR] Audit cycle failed (${consecutiveFailures} consecutive): ${err.message}`);

    const failureResult = {
      timestamp,
      cycleDurationMs: Date.now() - cycleStart,
      overallScore: 0,
      grade: 'F',
      categoryScores: {},
      error: err.message,
      consecutiveFailures,
    };
    saveAuditResult(failureResult);
    await notifyTelegram(failureResult);
  }
}

async function main() {
  logger.info('══════════════════════════════════════════════════════════════════');
  logger.info('  TFUSD Agent Starting');
  logger.info('══════════════════════════════════════════════════════════════════');
  logger.info(`  RPC URL: ${sanitizeRpc(RPC_URL)}`);
  logger.info(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
  logger.info(`  Data dir: ${DATA_DIR}`);
  logger.info(`  Logs dir: ${LOGS_DIR}`);
  logger.info('──────────────────────────────────────────────────────────────────');

  provider = new ethers.JsonRpcProvider(RPC_URL);

  // Wait for the node to be reachable
  let connected = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await provider.getBlockNumber();
      connected = true;
      logger.info(`Connected to node on attempt ${attempt}`);
      break;
    } catch (err) {
      logger.warn(`Connection attempt ${attempt}/10 failed: ${err.message}`);
      await sleep(3000);
    }
  }

  if (!connected) {
    logger.error('Failed to connect to RPC node after 10 attempts. Exiting.');
    process.exit(1);
  }

  await discoverAddresses();

  tfusd = new ethers.Contract(tfusdAddress, TFUSD_ABI, provider);
  dao = new ethers.Contract(daoAddress, DAO_ABI, provider);

  logger.info(`Monitoring TFUSD:  ${tfusdAddress}`);
  logger.info(`Monitoring DAO:    ${daoAddress}`);
  logger.info('──────────────────────────────────────────────────────────────────');

  // Start real-time transfer monitoring (also scans recent history)
  await startTransferMonitoring();

  // Run immediately, then on interval
  await runAuditCycle();
  const interval = setInterval(runAuditCycle, POLL_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    clearInterval(interval);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received. Shutting down gracefully...');
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(`Fatal agent error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
