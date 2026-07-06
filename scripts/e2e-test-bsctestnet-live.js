/**
 * Live smoke test against the deployed BSC Testnet contracts.
 *
 * This does not cover timelocked proposal execution (that would require
 * waiting days on a live network), but it validates that the fixed DAO is
 * deployed, the owner/delegation wiring is correct, and core TFUSD operations
 * work on the actual testnet state.
 *
 * Run: npx hardhat run scripts/e2e-test-bsctestnet-live.js --network bscTestnet
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

const DEPLOYMENT_FILE = path.join(__dirname, '..', 'deployments', 'bscTestnet', 'deploy-addresses.json');

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function waitFor(getter, timeoutMs = 30000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await getter();
    if (value) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timeout');
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('  TFUSD / DAO live smoke test — BSC Testnet');
  console.log('══════════════════════════════════════════════════════════════════');

  const [deployer] = await ethers.getSigners();
  const testWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const guardianWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  for (const w of [testWallet, guardianWallet]) {
    await (await deployer.sendTransaction({ to: w.address, value: ethers.parseEther('0.01') })).wait();
  }

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  const tfusdAddress = deployment.contracts.TreuhandFinanzgruppeUSD.address;
  const daoAddress = deployment.contracts.TreuhandFinanzgruppeUSDDAO.address;

  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  TFUSD:    ${tfusdAddress}`);
  console.log(`  DAO:      ${daoAddress}`);

  // BSC testnet currently requires a 1 gwei minimum priority fee.
  const txOpts = {
    maxFeePerGas: ethers.parseUnits('2', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
  };

  const tfusd = await ethers.getContractAt('TreuhandFinanzgruppeUSD', tfusdAddress, deployer);
  const dao = await ethers.getContractAt('TreuhandFinanzgruppeUSDDAO', daoAddress, deployer);

  // Clean up from any previous aborted run: unpause if paused.
  if (await tfusd.paused()) {
    await (await tfusd.unpause(txOpts)).wait();
  }

  // 1. Ownership & wiring
  assert((await tfusd.owner()) === deployer.address, 'TFUSD owner');
  assert((await dao.owner()) === deployer.address, 'DAO owner');
  assert(await tfusd.isMinter(daoAddress), 'DAO is TFUSD minter');
  assert(await tfusd.hasRole(await tfusd.MASTERMINTER_ROLE(), daoAddress), 'DAO has MASTERMINTER_ROLE');
  assert(await tfusd.hasRole(await tfusd.RESCUER_ROLE(), daoAddress), 'DAO has RESCUER_ROLE');
  console.log('  ✓ ownership and role wiring correct');

  // 2. DAO direct delegation (owner calls delegateMint)
  const mintAmount = ethers.parseUnits('1', 18);
  const balanceBefore = await tfusd.balanceOf(deployer.address);
  const mintTx = await (await dao.delegateMint(deployer.address, mintAmount, txOpts)).wait();
  // Public testnet RPCs are load-balanced; poll until the state propagates.
  await waitFor(async () => {
    const after = await tfusd.balanceOf(deployer.address);
    return after - balanceBefore >= mintAmount;
  });
  console.log('  ✓ DAO delegateMint works on live testnet (tx', mintTx.hash.slice(0, 14) + '...)');

  // 3. TFUSD direct operations
  await (await tfusd.configureMinter(testWallet.address, ethers.parseUnits('100', 18), txOpts)).wait();
  assert(await tfusd.isMinter(testWallet.address), 'testWallet minter');
  const twBalBefore = await tfusd.balanceOf(testWallet.address);
  await (await tfusd.connect(testWallet).mint(testWallet.address, ethers.parseUnits('10', 18), txOpts)).wait();
  await waitFor(async () => (await tfusd.balanceOf(testWallet.address)) - twBalBefore >= ethers.parseUnits('10', 18));
  await (await tfusd.removeMinter(testWallet.address, txOpts)).wait();
  assert(!(await tfusd.isMinter(testWallet.address)), 'testWallet minter removed');
  console.log('  ✓ TFUSD minter config/mint/remove works');

  await (await tfusd.pause(txOpts)).wait();
  await waitFor(async () => await tfusd.paused());
  await (await tfusd.unpause(txOpts)).wait();
  await waitFor(async () => !(await tfusd.paused()));
  console.log('  ✓ TFUSD pause/unpause works');

  const dummy = '0x00000000000000000000000000000000000000d1';
  await (await tfusd.addBlacklisted(dummy, txOpts)).wait();
  assert(await tfusd.isBlacklisted(dummy), 'dummy blacklisted');
  await (await tfusd.removeBlacklisted(dummy, txOpts)).wait();
  assert(!(await tfusd.isBlacklisted(dummy)), 'dummy unblacklisted');
  console.log('  ✓ TFUSD blacklist works');

  await (await tfusd.addDexAddress(dummy, txOpts)).wait();
  assert(await tfusd.isDexAddress(dummy), 'dummy dex');
  await (await tfusd.addTradeFrozen(dummy, txOpts)).wait();
  assert(await tfusd.isTradeFrozen(dummy), 'dummy trade frozen');
  await (await tfusd.removeTradeFrozen(dummy, txOpts)).wait();
  await (await tfusd.removeDexAddress(dummy, txOpts)).wait();
  console.log('  ✓ TFUSD DEX registry and trade freeze work');

  // 4. DAO non-timelocked governance paths
  await (await dao.addGuardian(guardianWallet.address, txOpts)).wait();
  assert(await dao.isGuardian(guardianWallet.address), 'guardianWallet guardian');
  const guardianCount = await dao.getGuardianCount();
  assert(guardianCount >= 2n, 'at least 2 guardians');

  const callData = dao.interface.encodeFunctionData('delegateBlacklist', [dummy, true]);
  const tx = await dao.createGuardianAction(callData, 'blacklist', txOpts);
  await tx.wait();
  const actionId = await dao.guardianActionCount();
  await (await dao.connect(guardianWallet).approveGuardianAction(actionId, txOpts)).wait();
  await (await dao.executeGuardianAction(actionId, txOpts)).wait();
  assert(await tfusd.isBlacklisted(dummy), 'guardian action blacklisted dummy');
  console.log('  ✓ DAO guardian multi-sig action works');

  // Clean up: remove dummy from blacklist and guardianWallet from guardians
  await (await tfusd.removeBlacklisted(dummy, txOpts)).wait();
  await (await dao.removeGuardian(guardianWallet.address, txOpts)).wait();

  // 5. Emergency pause/unpause is covered in the local e2e suite because the
  //    mintPauseDuration (1 hour) cannot be advanced on a live public RPC.
  //    We avoid leaving the testnet contracts paused.
  console.log('  (emergency pause/unpause validated in local e2e suite)');

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  Live BSC Testnet smoke tests passed ✓');
  console.log('══════════════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nLive smoke test failed:', err);
    process.exit(1);
  });
