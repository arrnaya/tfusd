// Agentic Wallet for Treuhand Finanzgruppe USD (TFUSD) Platform
// Strict security gates: transaction approval, daily limits, whitelist, multi-sig simulation

import { ethers } from 'ethers';

// ── Configuration (from environment) ──
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://bsc-rpc.publicnode.com';
const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '56'); // BSC Mainnet

// ── Security Gate Configuration ──
export interface SecurityConfig {
  dailyLimitWei: string;           // Max daily spending
  txThresholdWei: string;          // Threshold for requiring guardian approval
  whitelistEnabled: boolean;       // Only send to whitelisted addresses
  whitelistedAddresses: string[];  // Approved destinations
  requireGuardianApproval: boolean; // Multi-sig simulation for large txs
  guardianQuorum: number;          // Approvers needed for large txs
  maxGasPriceGwei: number;         // Max gas price
  cooldownSeconds: number;         // Cooldown between transactions
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  dailyLimitWei: '10000000000000000000', // 10 BNB / 10 ETH
  txThresholdWei: '1000000000000000000',  // 1 BNB / 1 ETH
  whitelistEnabled: true,
  whitelistedAddresses: [],
  requireGuardianApproval: true,
  guardianQuorum: 2,
  maxGasPriceGwei: 100,
  cooldownSeconds: 30,
};

// ── Transaction Types ──
export interface QueuedTransaction {
  id: string;
  to: string;
  value: string;
  data: string;
  gasLimit: number;
  gasPrice: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  createdAt: string;
  approvals: string[]; // guardian addresses who approved
  rejections: string[]; // guardian addresses who rejected
  executedAt: string | null;
  txHash: string | null;
  error: string | null;
}

// ── Wallet State ──
export interface AgenticWalletState {
  address: string;
  balance: string;
  nonce: number;
  chainId: number;
  network: string;
  dailySpent: string;
  dailyLimit: string;
  lastTxAt: string | null;
  transactions: QueuedTransaction[];
  security: SecurityConfig;
  isLocked: boolean;
  lockReason: string | null;
}

// ── Storage Keys ──
const STORAGE_KEYS = {
  walletState: 'tfusd_wallet_state',
  securityConfig: 'tfusd_wallet_security',
  privateKey: 'tfusd_wallet_key_enc', // encrypted
  txQueue: 'tfusd_wallet_tx_queue',
  dailySpent: 'tfusd_wallet_daily_spent',
  dailyResetAt: 'tfusd_wallet_daily_reset',
};

// ── Helper Functions ──
function generateId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Security Gates ──
export function checkSecurityGate(
  tx: { to: string; value: string; gasPrice: string },
  security: SecurityConfig,
  dailySpent: string,
  lastTxAt: string | null
): { allowed: boolean; reason: string | null; requiresApproval: boolean } {
  // 1. Whitelist check
  if (security.whitelistEnabled) {
    const toLower = tx.to.toLowerCase();
    const isWhitelisted = security.whitelistedAddresses.some(
      (a) => a.toLowerCase() === toLower
    );
    if (!isWhitelisted) {
      return { allowed: false, reason: 'Destination not whitelisted', requiresApproval: false };
    }
  }

  // 2. Gas price check
  const gasPriceGwei = parseFloat(tx.gasPrice) / 1e9;
  if (gasPriceGwei > security.maxGasPriceGwei) {
    return { allowed: false, reason: `Gas price too high: ${gasPriceGwei.toFixed(2)} Gwei > ${security.maxGasPriceGwei}`, requiresApproval: false };
  }

  // 3. Daily limit check
  const totalDaily = (BigInt(dailySpent) + BigInt(tx.value)).toString();
  if (BigInt(totalDaily) > BigInt(security.dailyLimitWei)) {
    return { allowed: false, reason: 'Daily spending limit exceeded', requiresApproval: false };
  }

  // 4. Transaction threshold check (requires guardian approval)
  const requiresApproval = BigInt(tx.value) > BigInt(security.txThresholdWei);
  if (requiresApproval && security.requireGuardianApproval) {
    return { allowed: true, reason: null, requiresApproval: true };
  }

  // 5. Cooldown check
  if (security.cooldownSeconds > 0 && lastTxAt) {
    const lastTx = new Date(lastTxAt).getTime();
    const now = Date.now();
    if (now - lastTx < security.cooldownSeconds * 1000) {
      return { allowed: false, reason: `Cooldown active: wait ${security.cooldownSeconds}s between transactions`, requiresApproval: false };
    }
  }

  return { allowed: true, reason: null, requiresApproval: false };
}

// ── Wallet Factory ──
export class AgenticWallet {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | null = null;
  private state: AgenticWalletState;

  constructor(privateKey?: string) {
    this.provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    this.state = this.loadState();

    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.state.address = this.wallet.address;
    } else if (this.state.address) {
      // Wallet exists but no key provided (view-only mode)
    }
  }

  static generate(): { address: string; privateKey: string } {
    const wallet = ethers.Wallet.createRandom();
    return { address: wallet.address, privateKey: wallet.privateKey };
  }

  static fromPrivateKey(key: string): AgenticWallet {
    return new AgenticWallet(key);
  }

  // ── State Management ──
  private loadState(): AgenticWalletState {
    if (typeof window === 'undefined') {
      return this.getDefaultState();
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.walletState);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...this.getDefaultState(), ...parsed };
      }
    } catch {}
    return this.getDefaultState();
  }

  private saveState() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEYS.walletState, JSON.stringify(this.state));
    } catch {}
  }

  private getDefaultState(): AgenticWalletState {
    return {
      address: '',
      balance: '0',
      nonce: 0,
      chainId: CHAIN_ID,
      network: 'bsc-mainnet',
      dailySpent: '0',
      dailyLimit: DEFAULT_SECURITY_CONFIG.dailyLimitWei,
      lastTxAt: null,
      transactions: [],
      security: { ...DEFAULT_SECURITY_CONFIG },
      isLocked: false,
      lockReason: null,
    };
  }

  // ── Getters ──
  getAddress(): string {
    return this.state.address;
  }

  getState(): AgenticWalletState {
    return { ...this.state };
  }

  async getBalance(): Promise<string> {
    if (!this.state.address) return '0';
    try {
      const bal = await this.provider.getBalance(this.state.address);
      this.state.balance = bal.toString();
      this.saveState();
      return this.state.balance;
    } catch {
      return this.state.balance;
    }
  }

  // ── Daily Spending ──
  private resetDailyIfNeeded() {
    const today = getTodayKey();
    const lastReset = localStorage.getItem(STORAGE_KEYS.dailyResetAt);
    if (lastReset !== today) {
      this.state.dailySpent = '0';
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.dailyResetAt, today);
      }
    }
  }

  private addDailySpent(amount: string) {
    this.resetDailyIfNeeded();
    this.state.dailySpent = (BigInt(this.state.dailySpent) + BigInt(amount)).toString();
    this.saveState();
  }

  // ── Security Config ──
  updateSecurityConfig(config: Partial<SecurityConfig>) {
    this.state.security = { ...this.state.security, ...config };
    this.saveState();
  }

  addWhitelist(address: string) {
    if (!this.state.security.whitelistedAddresses.includes(address)) {
      this.state.security.whitelistedAddresses.push(address);
      this.saveState();
    }
  }

  removeWhitelist(address: string) {
    this.state.security.whitelistedAddresses = this.state.security.whitelistedAddresses.filter(
      (a) => a.toLowerCase() !== address.toLowerCase()
    );
    this.saveState();
  }

  // ── Transaction Queue ──
  queueTransaction(
    to: string,
    value: string,
    data: string = '0x',
    gasLimit: number = 21000
  ): { id: string; requiresApproval: boolean } {
    this.resetDailyIfNeeded();

    const gasPrice = '20000000000'; // 20 gwei default
    const gate = checkSecurityGate(
      { to, value, gasPrice },
      this.state.security,
      this.state.dailySpent,
      this.state.lastTxAt
    );

    if (!gate.allowed) {
      throw new Error(gate.reason || 'Transaction rejected by security gate');
    }

    const tx: QueuedTransaction = {
      id: generateId(),
      to,
      value,
      data,
      gasLimit,
      gasPrice,
      status: gate.requiresApproval ? 'pending' : 'approved',
      createdAt: new Date().toISOString(),
      approvals: [],
      rejections: [],
      executedAt: null,
      txHash: null,
      error: null,
    };

    this.state.transactions.push(tx);
    this.saveState();

    // If no approval needed, auto-execute
    if (!gate.requiresApproval) {
      this.executeTransaction(tx.id).catch(() => {});
    }

    return { id: tx.id, requiresApproval: gate.requiresApproval };
  }

  // ── Guardian Approval (Multi-sig Simulation) ──
  approveTransaction(txId: string, guardianAddress: string): boolean {
    const tx = this.state.transactions.find((t) => t.id === txId);
    if (!tx) return false;
    if (tx.status !== 'pending') return false;
    if (tx.approvals.includes(guardianAddress)) return false;

    tx.approvals.push(guardianAddress);

    if (tx.approvals.length >= this.state.security.guardianQuorum) {
      tx.status = 'approved';
      this.executeTransaction(tx.id).catch(() => {});
    }

    this.saveState();
    return true;
  }

  rejectTransaction(txId: string, guardianAddress: string): boolean {
    const tx = this.state.transactions.find((t) => t.id === txId);
    if (!tx) return false;
    if (tx.status !== 'pending') return false;

    tx.rejections.push(guardianAddress);
    tx.status = 'rejected';
    this.saveState();
    return true;
  }

  // ── Execution ──
  async executeTransaction(txId: string): Promise<string | null> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized with private key');
    }

    const tx = this.state.transactions.find((t) => t.id === txId);
    if (!tx) throw new Error('Transaction not found');
    if (tx.status !== 'approved') throw new Error('Transaction not approved');

    try {
      const signedTx = await this.wallet.sendTransaction({
        to: tx.to,
        value: BigInt(tx.value),
        data: tx.data as `0x${string}`,
        gasLimit: BigInt(tx.gasLimit),
      });

      tx.txHash = signedTx.hash;
      tx.status = 'executed';
      tx.executedAt = new Date().toISOString();
      this.state.lastTxAt = new Date().toISOString();
      this.addDailySpent(tx.value);
      this.state.nonce++;
      this.saveState();

      return signedTx.hash;
    } catch (err: any) {
      tx.status = 'failed';
      tx.error = err?.message || 'Execution failed';
      this.saveState();
      throw err;
    }
  }

  // ── Contract Interaction ──
  async executeContract(
    contractAddress: string,
    abi: any[],
    functionName: string,
    args: any[]
  ): Promise<string | null> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized with private key');
    }

    const contract = new ethers.Contract(contractAddress, abi, this.wallet);
    const tx = await (contract as any)[functionName](...args);
    await tx.wait();
    return tx.hash;
  }

  // ── Lock / Unlock ──
  lock(reason: string) {
    this.state.isLocked = true;
    this.state.lockReason = reason;
    this.saveState();
  }

  unlock() {
    this.state.isLocked = false;
    this.state.lockReason = null;
    this.saveState();
  }

  // ── Emergency ──
  async emergencyDrain(recipient: string) {
    if (!this.wallet) throw new Error('Wallet not initialized');
    const balance = await this.provider.getBalance(this.state.address);
    const gasPrice = await this.provider.getFeeData();
    const gasCost = BigInt(21000) * (gasPrice.gasPrice || BigInt(0));
    const sendAmount = balance > gasCost ? balance - gasCost : BigInt(0);

    if (sendAmount > 0) {
      const tx = await this.wallet.sendTransaction({
        to: recipient,
        value: sendAmount,
        gasLimit: 21000,
      });
      return tx.hash;
    }
    return null;
  }

  // ── History ──
  getTransactions(): QueuedTransaction[] {
    return [...this.state.transactions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getPendingTransactions(): QueuedTransaction[] {
    return this.state.transactions.filter((t) => t.status === 'pending');
  }
}

// ── Singleton for React Context ──
let walletInstance: AgenticWallet | null = null;

export function getWallet(privateKey?: string): AgenticWallet {
  if (!walletInstance) {
    walletInstance = new AgenticWallet(privateKey);
  }
  return walletInstance;
}

export function resetWallet() {
  walletInstance = null;
}

// ── Demo Wallet (for testing) ──
export function createDemoWallet(): AgenticWallet {
  const { privateKey } = AgenticWallet.generate();
  const wallet = AgenticWallet.fromPrivateKey(privateKey);
  // Add some demo whitelisted addresses
  wallet.addWhitelist('0xC57E89Dda471f142eA3bB140eb7E7dd4f81039eC');
  wallet.addWhitelist('0x0000000000000000000000000000000000000000');
  return wallet;
}
