/**
 * =============================================================================
 * TFUSD BSC Testnet E2E Test Suite
 * =============================================================================
 * Runs end-to-end tests against the deployed BSC testnet contracts.
 *
 * Required env vars (loaded via dotenv from hardhat.config.js):
 *   RPC_URL              BSC testnet RPC
 *   PRIVATE_KEY          Deployer key with tBNB and contract roles
 *   TFUSD_CONTRACT_ADDRESS
 *   TFUSD_DAO_ADDRESS
 *
 * Usage: node scripts/test-testnet.js
 * =============================================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TFUSD_CONTRACT_ADDRESS = process.env.TFUSD_CONTRACT_ADDRESS;
const TFUSD_DAO_ADDRESS = process.env.TFUSD_DAO_ADDRESS;

if (!RPC_URL || !PRIVATE_KEY || !TFUSD_CONTRACT_ADDRESS || !TFUSD_DAO_ADDRESS) {
  console.error('Missing required env vars: RPC_URL, PRIVATE_KEY, TFUSD_CONTRACT_ADDRESS, TFUSD_DAO_ADDRESS');
  process.exit(1);
}

const TFUSD_ABI = require('./contract-abi.json');

const DAO_ABI = [
  'function tfusd() view returns (address)',
  'function owner() view returns (address)',
  'function emergencyPaused() view returns (bool)',
  'function emergencyPausedAt() view returns (uint256)',
  'function proposalCount() view returns (uint256)',
  'function getProposal(uint256) view returns (uint256,address,string,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool)',
  'function createProposal(string,string,bytes) returns (uint256)',
  'function vote(uint256,uint8)',
  'function canExecute(uint256) view returns (bool)',
  'function executeProposal(uint256)',
  'function addGuardian(address)',
  'function getGuardianCount() view returns (uint256)',
  'function guardians(address) view returns (bool)',
  'function delegateMint(address,uint256)',
  'function delegateBurn(uint256)',
  'function emergencyPause()',
  'function emergencyUnpause()',
  'function params() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool,bool)',
  'function updateDepegThreshold(uint256)',
  'function updateVotingPeriod(uint256)',
  'function updateProposalTimelock(uint256)',
  'function updateMintPauseDuration(uint256)',
  'event ProposalCreated(uint256 indexed,address indexed,string,bytes,uint256,uint256)',
  'event ProposalExecuted(uint256 indexed,address indexed)',
  'event EmergencyPauseTriggered(address indexed)',
  'event EmergencyUnpauseTriggered(address indexed)',
];

// ── Test Harness ────────────────────────────────────────────────────────────
class TestRunner {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.provider = null;
    this.deployer = null;
    this.tfusd = null;
    this.dao = null;
    this.user = null;
    this.attacker = null;
  }

  async init() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.deployer = new ethers.Wallet(PRIVATE_KEY, this.provider);

    // Secondary wallets for access-control / transfer tests
    this.user = ethers.Wallet.createRandom(this.provider);
    this.attacker = ethers.Wallet.createRandom(this.provider);

    this.tfusd = new ethers.Contract(TFUSD_CONTRACT_ADDRESS, TFUSD_ABI, this.provider);
    this.dao = new ethers.Contract(TFUSD_DAO_ADDRESS, DAO_ABI, this.provider);

    // Fund secondary wallets with a small amount of tBNB for gas
    const fundAmount = ethers.parseEther('0.01');
    for (const wallet of [this.user, this.attacker]) {
      const tx = await this.deployer.sendTransaction({ to: wallet.address, value: fundAmount });
      await tx.wait();
    }

    console.log(`Connected to BSC testnet at ${RPC_URL}`);
    console.log(`Deployer: ${this.deployer.address}`);
    console.log(`TFUSD:    ${TFUSD_CONTRACT_ADDRESS}`);
    console.log(`DAO:      ${TFUSD_DAO_ADDRESS}`);
    console.log('');
  }

  async test(name, fn) {
    const start = Date.now();
    try {
      await fn();
      this.passed++;
      this.results.push({ name, status: 'PASS', durationMs: Date.now() - start });
      console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
    } catch (err) {
      this.failed++;
      this.results.push({ name, status: 'FAIL', durationMs: Date.now() - start, error: err.message });
      console.log(`  ✗ ${name} — ${err.message}`);
    }
  }

  async run() {
    await this.init();

    console.log('══════════════════════════════════════════════════════════════════');
    console.log('  TFUSD BSC Testnet E2E Test Suite');
    console.log('══════════════════════════════════════════════════════════════════');
    console.log('');

    // Ensure contracts are not paused from any previous run
    const daoCheck = this.dao.connect(this.deployer);
    if (await daoCheck.emergencyPaused()) {
      const params = await daoCheck.params();
      const pauseDuration = Number(params[6]);
      const pausedAt = await daoCheck.emergencyPausedAt().catch(() => 0);
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, pauseDuration - (now - Number(pausedAt)) + 5);
      console.log(`  Resuming from previous pause — waiting ${remaining}s before unpausing...`);
      await new Promise((r) => setTimeout(r, remaining * 1000));
      await (await daoCheck.emergencyUnpause()).wait();
      console.log('  Resumed');
    }

    // ── TEST 1: Login / Wallet Connection ───────────────────────────────────
    await this.test('Login — wallet connection and authentication', async () => {
      const balance = await this.provider.getBalance(this.deployer.address);
      if (balance <= 0n) throw new Error('Deployer has zero tBNB balance');
      const message = `TFUSD Login ${Date.now()}`;
      const signature = await this.deployer.signMessage(message);
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== this.deployer.address.toLowerCase()) {
        throw new Error('Signature verification failed');
      }
    });

    // ── TEST 2: DON Status ────────────────────────────────────────────────────
    await this.test('DON status — testnet node online and contracts responding', async () => {
      const block1 = await this.provider.getBlockNumber();
      await new Promise((r) => setTimeout(r, 2000));
      const block2 = await this.provider.getBlockNumber();
      if (block2 < block1) throw new Error('Block number not advancing');
      const totalSupply = await this.tfusd.totalSupply();
      if (totalSupply === undefined) throw new Error('Contract call failed');
    });

    // ── TEST 3: Mint TFUSD ────────────────────────────────────────────────────
    await this.test('Mint — deployer mints 1,000,000 TFUSD to user', async () => {
      const amount = ethers.parseUnits('1000000', 18);
      const tfusd = this.tfusd.connect(this.deployer);
      const before = await tfusd.balanceOf(this.user.address);
      const tx = await tfusd.mintByMaster(this.user.address, amount);
      await tx.wait();
      const after = await tfusd.balanceOf(this.user.address);
      if (after - before !== amount) throw new Error(`Mint amount mismatch`);

      // Also mint to deployer so burn/replenish tests have balance
      const deployerBefore = await tfusd.balanceOf(this.deployer.address);
      const tx2 = await tfusd.mintByMaster(this.deployer.address, ethers.parseUnits('600000', 18));
      await tx2.wait();
      const deployerAfter = await tfusd.balanceOf(this.deployer.address);
      if (deployerAfter - deployerBefore !== ethers.parseUnits('600000', 18)) throw new Error('Deployer mint mismatch');
    });

    // ── TEST 4: Transfer TFUSD ────────────────────────────────────────────────
    await this.test('Transfer — user sends 100 TFUSD to deployer', async () => {
      const amount = ethers.parseUnits('100', 18);
      const tfusd = this.tfusd.connect(this.user);
      const before = await tfusd.balanceOf(this.deployer.address);
      const tx = await tfusd.transfer(this.deployer.address, amount);
      await tx.wait();
      const after = await tfusd.balanceOf(this.deployer.address);
      if (after - before !== amount) throw new Error(`Transfer amount mismatch`);
    });

    // ── TEST 5: Burn TFUSD ────────────────────────────────────────────────────
    await this.test('Burn — deployer burns 500,000 TFUSD', async () => {
      const tfusd = this.tfusd.connect(this.deployer);
      const amount = ethers.parseUnits('500000', 18);
      const before = await tfusd.balanceOf(this.deployer.address);
      if (before < amount) throw new Error('Insufficient balance to burn');
      const tx = await tfusd.burn(amount);
      await tx.wait();
      const after = await tfusd.balanceOf(this.deployer.address);
      if (before - after !== amount) throw new Error(`Burn amount mismatch`);
    });

    // ── TEST 6: Blacklist ─────────────────────────────────────────────────────
    await this.test('Blacklist — blacklister adds and removes address', async () => {
      const target = this.attacker.address;
      const tfusd = this.tfusd.connect(this.deployer);
      const tx1 = await tfusd.addBlacklisted(target);
      await tx1.wait();
      const isBlacklisted1 = await tfusd.isBlacklisted(target);
      if (!isBlacklisted1) throw new Error('Failed to blacklist address');
      const tx2 = await tfusd.removeBlacklisted(target);
      await tx2.wait();
      const isBlacklisted2 = await tfusd.isBlacklisted(target);
      if (isBlacklisted2) throw new Error('Failed to remove address from blacklist');
    });

    // ── TEST 7: Trade Freeze ──────────────────────────────────────────────────
    await this.test('Trade Freeze — freezer adds and removes trade freeze', async () => {
      const target = this.user.address;
      const tfusd = this.tfusd.connect(this.deployer);
      const tx1 = await tfusd.addTradeFrozen(target);
      await tx1.wait();
      const isFrozen1 = await tfusd.isTradeFrozen(target);
      if (!isFrozen1) throw new Error('Failed to freeze address');
      const tx2 = await tfusd.removeTradeFrozen(target);
      await tx2.wait();
      const isFrozen2 = await tfusd.isTradeFrozen(target);
      if (isFrozen2) throw new Error('Failed to unfreeze address');
    });

    // ── TEST 8: DAO Proposal Lifecycle ────────────────────────────────────────
    await this.test('DAO Proposal — create and vote (execution requires 1h+ timelock)', async () => {
      const dao = this.dao.connect(this.deployer);

      // Ensure user is a guardian so quorum can be met
      let isUserGuardian = await dao.guardians(this.user.address);
      if (!isUserGuardian) {
        const tx = await dao.addGuardian(this.user.address);
        await tx.wait();
        isUserGuardian = await dao.guardians(this.user.address);
      }
      if (!isUserGuardian) throw new Error('User was not registered as guardian');

      // Create proposal: update depeg threshold to 990
      const newThreshold = 990;
      const callData = dao.interface.encodeFunctionData('updateDepegThreshold', [newThreshold]);
      const beforeCount = await dao.proposalCount();
      const txCreate = await dao.createProposal('Update Depeg Threshold', 'Lower threshold for tighter monitoring', callData);
      await txCreate.wait();
      const afterCount = await dao.proposalCount();
      const proposalId = Number(afterCount);
      if (proposalId !== Number(beforeCount) + 1) throw new Error('Proposal not created');

      // Deployer and user vote FOR
      await (await dao.vote(proposalId, 1)).wait();
      await (await dao.connect(this.user).vote(proposalId, 1)).wait();

      const proposal = await dao.getProposal(proposalId);
      if (Number(proposal[3]) < 2) throw new Error('Votes not recorded'); // votesFor
    });

    // ── TEST 9: Emergency Pause ───────────────────────────────────────────────
    await this.test('Emergency Pause — guardian triggers and resolves pause', async () => {
      const dao = this.dao.connect(this.deployer);

      // Shorten pause duration for testnet
      await (await dao.updateMintPauseDuration(60)).wait();

      const txPause = await dao.emergencyPause();
      await txPause.wait();
      const paused1 = await dao.emergencyPaused();
      const tfusdPaused1 = await this.tfusd.paused();
      if (!paused1) throw new Error('Emergency pause not triggered');
      if (!tfusdPaused1) throw new Error('TFUSD not paused after emergency pause');

      // Wait for pause duration + a buffer
      console.log('    Waiting 65s for pause duration on testnet...');
      await new Promise((r) => setTimeout(r, 65000));

      const txUnpause = await dao.emergencyUnpause();
      await txUnpause.wait();
      const paused2 = await dao.emergencyPaused();
      const tfusdPaused2 = await this.tfusd.paused();
      if (paused2) throw new Error('Emergency pause not resolved');
      if (tfusdPaused2) throw new Error('TFUSD still paused after emergency unpause');
    });

    // ── TEST 10: Access Control (negative) ────────────────────────────────────
    await this.test('Access Control — unauthorized user cannot mint', async () => {
      const tfusd = this.tfusd.connect(this.attacker);
      try {
        await tfusd.mintByMaster(this.attacker.address, ethers.parseUnits('1000', 18));
        throw new Error('Unauthorized mint succeeded (should have failed)');
      } catch (err) {
        if (err.message.includes('should have failed')) throw err;
        // Expected failure
      }
    });

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('');
    console.log('══════════════════════════════════════════════════════════════════');
    console.log('  Test Summary');
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(`  Total:  ${this.passed + this.failed}`);
    console.log(`  Passed: ${this.passed}`);
    console.log(`  Failed: ${this.failed}`);
    console.log('══════════════════════════════════════════════════════════════════');

    const report = {
      timestamp: new Date().toISOString(),
      rpcUrl: RPC_URL,
      tfusd: TFUSD_CONTRACT_ADDRESS,
      dao: TFUSD_DAO_ADDRESS,
      total: this.passed + this.failed,
      passed: this.passed,
      failed: this.failed,
      successRate: this.passed / (this.passed + this.failed),
      results: this.results,
    };

    const reportPath = path.join(__dirname, '..', 'data', 'testnet-test-report.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Test report saved to: ${reportPath}`);

    if (this.failed > 0) {
      process.exit(1);
    }
  }
}

const runner = new TestRunner();
runner.run().catch((err) => {
  console.error('Fatal test error:', err.message);
  process.exit(1);
});
